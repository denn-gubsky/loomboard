// "Sign in with loomcycle" for the desktop app (RFC FL P2): the native half.
//
// The authorize page opens in the person's own browser — never an embedded
// webview, which would put their password inside this app — and loomcycle
// redirects back to a one-shot listener on a random 127.0.0.1 port (RFC 8252
// §7.3, the loopback redirect the `loomboard` preset registers). The webview
// gets back the redirect's path + query and finishes the exchange itself with
// @loomcycle/client; this side never sees a token, only the code it relays.
//
// The refresh token is kept in the OS keychain (Keychain / Credential Manager /
// Secret Service) under ONE fixed entry, so the webview can read and write that
// entry and nothing else in the keychain.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::State;
use tauri_plugin_opener::OpenerExt;

const CALLBACK_PATH: &str = "/auth/callback";
/// How long a sign-in waits for the browser before giving up.
const CALLBACK_WAIT: Duration = Duration::from_secs(300);
/// The longest request line read from the browser; a redirect carrying a code,
/// a state and an issuer is far shorter.
const MAX_REQUEST_LINE: usize = 8 * 1024;
const KEYCHAIN_SERVICE: &str = "com.loomboard.app";
const KEYCHAIN_ACCOUNT: &str = "loomcycle-sign-in";

/// The listener of the sign-in in progress, and a generation that a new
/// sign-in or a cancel bumps so a superseded wait stops.
#[derive(Default)]
pub struct Loopback {
    listener: Mutex<Option<TcpListener>>,
    generation: Arc<AtomicU64>,
}

/// Bind the loopback listener for a new sign-in; returns its port. Replaces
/// (and so ends) any sign-in still waiting.
#[tauri::command]
pub fn oauth_loopback_start(state: State<'_, Loopback>) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.listener.lock().map_err(|_| "sign-in state is poisoned")? = Some(listener);
    Ok(port)
}

/// Wait for the browser's redirect to the callback. Returns its path + query
/// ("/auth/callback?code=…&state=…&iss=…"), or None when the sign-in timed out,
/// was cancelled or was replaced by a newer one.
#[tauri::command]
pub async fn oauth_loopback_wait(state: State<'_, Loopback>) -> Result<Option<String>, String> {
    let listener = state
        .listener
        .lock()
        .map_err(|_| "sign-in state is poisoned")?
        .take()
        .ok_or("no sign-in is in progress")?;
    let mine = state.generation.load(Ordering::SeqCst);
    let current = Arc::clone(&state.generation);
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listener, Instant::now() + CALLBACK_WAIT, || {
            current.load(Ordering::SeqCst) != mine
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop a sign-in waiting for the browser.
#[tauri::command]
pub fn oauth_loopback_cancel(state: State<'_, Loopback>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
}

/// Open the authorize page in the system browser. Only a web address: the URL
/// comes from the webview, and the OS would otherwise open whatever handler a
/// scheme names.
#[tauri::command]
pub fn oauth_open_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("sign-in can only open an http(s) address".into());
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sign_in_secret_get() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn sign_in_secret_set(value: String) -> Result<(), String> {
    keychain_entry()?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sign_in_secret_delete() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// Accept connections until one is the callback, the deadline passes, or
/// `stopped` says the sign-in is over. Anything else (a favicon request, a
/// stray probe) gets a 404 and the wait goes on.
fn wait_for_callback(
    listener: TcpListener,
    deadline: Instant,
    stopped: impl Fn() -> bool,
) -> Result<Option<String>, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    loop {
        if stopped() || Instant::now() >= deadline {
            return Ok(None);
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(target) = serve(stream) {
                    return Ok(Some(target));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Answer one connection; the request target if it was the callback.
fn serve(mut stream: TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let target = read_request_line(&mut stream).and_then(|line| callback_target(&line));
    let (status, body) = match target {
        Some(_) => (
            "200 OK",
            "<!doctype html><meta charset=utf-8><title>loomboard</title>\
             <p style=\"font-family:system-ui;margin:3em\">You are signed in. \
             You can close this tab and return to loomboard.</p>",
        ),
        None => ("404 Not Found", "not found"),
    };
    // The page's own URL carries the code: no-referrer and no subresources, so
    // nothing re-sends it; no-store so it is not cached.
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    target
}

/// The first line of the request, without its CRLF, if it arrives in time and
/// fits.
fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    while buf.len() < MAX_REQUEST_LINE {
        match stream.read(&mut byte) {
            Ok(1) => {
                if byte[0] == b'\n' {
                    if buf.last() == Some(&b'\r') {
                        buf.pop();
                    }
                    return String::from_utf8(buf).ok();
                }
                buf.push(byte[0]);
            }
            _ => return None,
        }
    }
    None
}

/// "GET /auth/callback?… HTTP/1.1" → "/auth/callback?…"; None for any other
/// method or path.
fn callback_target(line: &str) -> Option<String> {
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    if method != "GET" || !version.starts_with("HTTP/") || parts.next().is_some() {
        return None;
    }
    let path = target.split('?').next()?;
    (path == CALLBACK_PATH).then(|| target.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_target_accepts_only_a_get_of_the_callback_path() {
        assert_eq!(
            callback_target("GET /auth/callback?code=c&state=s HTTP/1.1"),
            Some("/auth/callback?code=c&state=s".to_string())
        );
        assert_eq!(callback_target("GET /auth/callback HTTP/1.1"), Some("/auth/callback".into()));
        assert_eq!(callback_target("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(callback_target("POST /auth/callback?code=c HTTP/1.1"), None);
        assert_eq!(callback_target("GET /auth/callbackx?code=c HTTP/1.1"), None);
        assert_eq!(callback_target("GET /auth/callback?code=c HTTP/1.1 extra"), None);
        assert_eq!(callback_target("garbage"), None);
    }

    #[test]
    fn wait_returns_the_callback_and_ignores_other_requests() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut resp = String::new();
            let _ = s.read_to_string(&mut resp);
            assert!(resp.starts_with("HTTP/1.1 404"));
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /auth/callback?code=c1&state=s1 HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut resp = String::new();
            let _ = s.read_to_string(&mut resp);
            assert!(resp.starts_with("HTTP/1.1 200"));
            assert!(resp.contains("Referrer-Policy: no-referrer"));
        });
        let got = wait_for_callback(listener, Instant::now() + Duration::from_secs(10), || false).unwrap();
        client.join().unwrap();
        assert_eq!(got, Some("/auth/callback?code=c1&state=s1".to_string()));
    }

    #[test]
    fn wait_gives_up_when_stopped() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let got = wait_for_callback(listener, Instant::now() + Duration::from_secs(10), || true).unwrap();
        assert_eq!(got, None);
    }

    #[test]
    fn wait_gives_up_at_the_deadline() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let got = wait_for_callback(listener, Instant::now(), || false).unwrap();
        assert_eq!(got, None);
    }
}
