// "Sign in with loomcycle" for the desktop app (RFC FL P2): the native half.
//
// The authorize page opens in the person's own browser — never an embedded
// webview, which would put their password inside this app — and loomcycle
// redirects back to a one-shot listener on a random 127.0.0.1 port (RFC 8252
// §7.3, the loopback redirect the `loomboard` preset registers). The webview
// gets back the redirect's path + query and finishes the exchange itself with
// @loomcycle/client; this side relays the code and never exchanges it.
//
// Anything on this machine can connect to the listener, so it answers only a
// GET of the callback path carrying the state this sign-in sent, gives each
// connection a few seconds in total, serves connections on their own threads
// (one slow client cannot hold the sign-in), and stops at once on cancel or
// after five minutes.
//
// The sign-in is kept in the OS keychain (Keychain / Credential Manager /
// Secret Service) under ONE fixed entry, so the webview can read and write that
// entry and nothing else in the keychain; what it writes is checked to be a
// sign-in record.
//
// Deferred: holding the refresh token and the refresh call in Rust only, so
// the webview never sees the refresh token at all.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{State, Url};
use tauri_plugin_opener::OpenerExt;

const CALLBACK_PATH: &str = "/auth/callback";
const AUTHORIZE_PATH: &str = "/v1/_oauth/authorize";
/// How long a sign-in waits for the browser before giving up.
const CALLBACK_WAIT: Duration = Duration::from_secs(300);
/// How long one connection may take, in total, to send its request line.
const CONNECTION_DEADLINE: Duration = Duration::from_secs(5);
/// Connections served at once; more are closed unanswered.
const MAX_CONNECTIONS: usize = 16;
/// The longest request line read from the browser; a redirect carrying a code,
/// a state and an issuer is far shorter.
const MAX_REQUEST_LINE: usize = 8 * 1024;
/// The error a command returns once its sign-in was cancelled or replaced.
/// The frontend reads exactly this text as a cancel (src/lib/tauriSignIn.ts
/// NOT_IN_PROGRESS).
const NOT_IN_PROGRESS: &str = "no sign-in is in progress";
const KEYCHAIN_SERVICE: &str = "com.loomboard.app";
const KEYCHAIN_ACCOUNT: &str = "loomcycle-sign-in";
/// Bounds on a stored sign-in record (src/state/signInStore.ts STORED_LIMITS).
const MAX_BASE_URL: usize = 2048;
const MAX_ID: usize = 64;
const MAX_TOKEN: usize = 4096;

/// The sign-in in progress: its listener, the origin of the Base URL it is
/// for, and a generation that a new sign-in or a cancel bumps so a superseded
/// wait stops.
#[derive(Default)]
pub struct Loopback {
    listener: Mutex<Option<TcpListener>>,
    origin: Mutex<Option<String>>,
    generation: Arc<AtomicU64>,
}

/// Bind the loopback listener for a new sign-in to `base_url`; returns its
/// port. Replaces (and so ends) any sign-in still waiting.
#[tauri::command]
pub fn oauth_loopback_start(state: State<'_, Loopback>, base_url: String) -> Result<u16, String> {
    let origin = web_origin(&base_url).ok_or("the Base URL is not an http(s) address")?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.listener.lock().map_err(|_| "sign-in state is poisoned")? = Some(listener);
    *state.origin.lock().map_err(|_| "sign-in state is poisoned")? = Some(origin);
    Ok(port)
}

/// Wait for the browser's redirect to the callback with `expected_state`.
/// Returns its path + query ("/auth/callback?code=…&state=…&iss=…"), or None
/// when the sign-in timed out, was cancelled or was replaced by a newer one.
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: State<'_, Loopback>,
    expected_state: String,
) -> Result<Option<String>, String> {
    if expected_state.is_empty() || expected_state.len() > 1024 {
        return Err("invalid sign-in state".into());
    }
    let listener = state
        .listener
        .lock()
        .map_err(|_| "sign-in state is poisoned")?
        .take()
        .ok_or(NOT_IN_PROGRESS)?;
    let mine = state.generation.load(Ordering::SeqCst);
    let current = Arc::clone(&state.generation);
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listener, &expected_state, Instant::now() + CALLBACK_WAIT, move || {
            current.load(Ordering::SeqCst) != mine
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop a sign-in: a wait in progress returns None, a listener nobody is
/// waiting on yet is closed, and the browser can no longer be opened for it
/// (a cancel during discovery must not still open the sign-in page).
#[tauri::command]
pub fn oauth_loopback_cancel(state: State<'_, Loopback>) {
    cancel(&state);
}

fn cancel(lb: &Loopback) {
    lb.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut l) = lb.listener.lock() {
        *l = None;
    }
    if let Ok(mut o) = lb.origin.lock() {
        *o = None;
    }
}

/// Open the authorize page in the system browser. Only loomcycle's authorize
/// endpoint on the Base URL this sign-in started for, and only while its
/// listener is still bound: the URL comes from the webview, and the OS would
/// otherwise open whatever a URL names.
#[tauri::command]
pub fn oauth_open_browser(app: tauri::AppHandle, state: State<'_, Loopback>, url: String) -> Result<(), String> {
    may_open(&state, &url)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn may_open(lb: &Loopback, url: &str) -> Result<(), String> {
    let origin = lb
        .origin
        .lock()
        .map_err(|_| "sign-in state is poisoned")?
        .clone()
        .ok_or(NOT_IN_PROGRESS)?;
    if lb.listener.lock().map_err(|_| "sign-in state is poisoned")?.is_none() {
        return Err(NOT_IN_PROGRESS.into());
    }
    if !authorize_url_allowed(url, &origin) {
        return Err("sign-in can only open loomcycle's sign-in page for this Base URL".into());
    }
    Ok(())
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
    validate_stored(&value)?;
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

/// scheme://host[:port] of an http(s) URL.
fn web_origin(url: &str) -> Option<String> {
    let u = Url::parse(url).ok()?;
    match u.scheme() {
        "https" | "http" => Some(u.origin().ascii_serialization()),
        _ => None,
    }
}

/// Whether plain http may be used to this host: only an IP literal on this
/// machine or a private network (a LAN loomcycle such as the TrueNAS app).
/// Never a name — a name can resolve anywhere, so names stay https-only —
/// and never a public address.
fn plain_http_host(u: &Url) -> bool {
    use std::net::IpAddr;
    let Some(host) = u.host_str() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            let first = ip.segments()[0];
            ip.is_loopback()
                || (first & 0xfe00) == 0xfc00 // fc00::/7, unique local
                || (first & 0xffc0) == 0xfe80 // fe80::/10, link local
        }
        Err(_) => false,
    }
}

/// An https URL — or http to this machine or a private-network address — of
/// loomcycle's authorize endpoint, on `origin`.
fn authorize_url_allowed(url: &str, origin: &str) -> bool {
    let Ok(u) = Url::parse(url) else { return false };
    let secure = u.scheme() == "https" || (u.scheme() == "http" && plain_http_host(&u));
    secure
        && u.username().is_empty()
        && u.password().is_none()
        && u.fragment().is_none()
        && u.path().ends_with(AUTHORIZE_PATH)
        && u.origin().ascii_serialization() == origin
}

/// A stored sign-in record as the webview writes it: a JSON object with
/// exactly baseUrl, id, refreshToken, accessToken and expiresAt, in bounds.
fn validate_stored(value: &str) -> Result<(), String> {
    if value.len() > MAX_BASE_URL + MAX_ID + 2 * MAX_TOKEN + 256 {
        return Err("sign-in record too large".into());
    }
    let v: serde_json::Value = serde_json::from_str(value).map_err(|_| "sign-in record is not JSON")?;
    let obj = v.as_object().ok_or("sign-in record is not an object")?;
    let allowed = ["baseUrl", "id", "refreshToken", "accessToken", "expiresAt"];
    if obj.len() != allowed.len() || !obj.keys().all(|k| allowed.contains(&k.as_str())) {
        return Err("sign-in record has unexpected fields".into());
    }
    let text = |k: &str, max: usize, empty_ok: bool| -> Result<(), String> {
        let s = obj.get(k).and_then(|v| v.as_str()).ok_or(format!("{k} is not a string"))?;
        if (!empty_ok && s.is_empty()) || s.len() > max || s.chars().any(|c| c.is_control()) {
            return Err(format!("{k} is out of bounds"));
        }
        Ok(())
    };
    text("baseUrl", MAX_BASE_URL, true)?;
    text("id", MAX_ID, false)?;
    text("refreshToken", MAX_TOKEN, false)?;
    text("accessToken", MAX_TOKEN, true)?;
    let base = obj["baseUrl"].as_str().unwrap_or_default();
    if !base.is_empty() && web_origin(base).is_none() {
        return Err("baseUrl is not an http(s) address".into());
    }
    if !obj["expiresAt"].as_f64().is_some_and(f64::is_finite) {
        return Err("expiresAt is not a number".into());
    }
    Ok(())
}

/// Accept connections until one is the callback with `expected_state`, the
/// deadline passes, or `stopped` says the sign-in is over. Each connection is
/// served on a thread of its own with its own short deadline, so a client
/// that connects and stalls holds nothing up.
fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
    deadline: Instant,
    stopped: impl Fn() -> bool,
) -> Result<Option<String>, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let (found_tx, found) = mpsc::channel::<String>();
    let expected = Arc::new(expected_state.to_string());
    let open = Arc::new(AtomicUsize::new(0));
    loop {
        if let Ok(target) = found.try_recv() {
            return Ok(Some(target));
        }
        if stopped() || Instant::now() >= deadline {
            return Ok(None);
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if open.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    continue; // dropped: closes the connection unanswered
                }
                open.fetch_add(1, Ordering::SeqCst);
                let (tx, expected, open) = (found_tx.clone(), Arc::clone(&expected), Arc::clone(&open));
                std::thread::spawn(move || {
                    if let Some(target) = serve(stream, &expected, Instant::now() + CONNECTION_DEADLINE) {
                        let _ = tx.send(target);
                    }
                    open.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Answer one connection; the request target if it was the callback with the
/// expected state.
fn serve(mut stream: TcpStream, expected_state: &str, deadline: Instant) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let target = read_request_line(&mut stream, deadline).and_then(|line| callback_target(&line));
    let (status, body, found) = match target {
        Some(t) if state_matches(&t, expected_state) => (
            "200 OK",
            // Neutral: the redirect may carry an error, and the exchange has
            // not happened yet — the app reports how it went.
            "<!doctype html><meta charset=utf-8><title>loomboard</title>\
             <p style=\"font-family:system-ui;margin:3em\">You can return to loomboard.</p>",
            Some(t),
        ),
        Some(_) => (
            "400 Bad Request",
            "<!doctype html><meta charset=utf-8><title>loomboard</title>\
             <p style=\"font-family:system-ui;margin:3em\">This is not the sign-in loomboard is waiting for.</p>",
            None,
        ),
        None => ("404 Not Found", "not found", None),
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
    found
}

/// The first line of the request, without its CRLF, if it arrives before
/// `deadline` (the whole connection's, not per read) and fits.
fn read_request_line(stream: &mut TcpStream, deadline: Instant) -> Option<String> {
    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 512];
    loop {
        let left = deadline.checked_duration_since(Instant::now())?;
        if left.is_zero() {
            return None;
        }
        stream.set_read_timeout(Some(left)).ok()?;
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = buf.iter().position(|&b| b == b'\n') {
            let mut line = buf[..end].to_vec();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return String::from_utf8(line).ok();
        }
        if buf.len() >= MAX_REQUEST_LINE {
            return None;
        }
    }
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

/// Whether the target carries exactly one `state`, equal to `expected`
/// (compared in time that depends only on the lengths).
fn state_matches(target: &str, expected: &str) -> bool {
    let Ok(u) = Url::parse(&format!("http://127.0.0.1{target}")) else { return false };
    let states: Vec<_> = u.query_pairs().filter(|(k, _)| k == "state").map(|(_, v)| v.into_owned()).collect();
    if states.len() != 1 {
        return false;
    }
    let (a, b) = (states[0].as_bytes(), expected.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).unwrap();
        let mut resp = String::new();
        let _ = s.read_to_string(&mut resp);
        resp
    }

    fn listener() -> (TcpListener, u16) {
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let p = l.local_addr().unwrap().port();
        (l, p)
    }

    #[test]
    fn callback_target_accepts_only_a_get_of_the_callback_path() {
        assert_eq!(
            callback_target("GET /auth/callback?code=c&state=s HTTP/1.1"),
            Some("/auth/callback?code=c&state=s".to_string())
        );
        assert_eq!(callback_target("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(callback_target("POST /auth/callback?code=c HTTP/1.1"), None);
        assert_eq!(callback_target("GET /auth/callbackx?code=c HTTP/1.1"), None);
        assert_eq!(callback_target("GET /auth/callback?code=c HTTP/1.1 extra"), None);
        assert_eq!(callback_target("garbage"), None);
    }

    #[test]
    fn wait_answers_a_wrong_or_missing_state_400_and_keeps_waiting() {
        let (l, port) = listener();
        let client = std::thread::spawn(move || {
            assert!(get(port, "/favicon.ico").starts_with("HTTP/1.1 404"));
            assert!(get(port, "/auth/callback?code=stolen&state=guess").starts_with("HTTP/1.1 400"));
            assert!(get(port, "/auth/callback?code=c0").starts_with("HTTP/1.1 400"));
            assert!(get(port, "/auth/callback?code=c0&state=s1&state=s1").starts_with("HTTP/1.1 400"));
            let ok = get(port, "/auth/callback?code=c1&state=s1");
            assert!(ok.starts_with("HTTP/1.1 200"));
            assert!(ok.contains("Referrer-Policy: no-referrer"));
            assert!(ok.contains("You can return to loomboard"));
            assert!(!ok.contains("signed in"));
        });
        let got = wait_for_callback(l, "s1", Instant::now() + Duration::from_secs(10), || false).unwrap();
        client.join().unwrap();
        assert_eq!(got, Some("/auth/callback?code=c1&state=s1".to_string()));
    }

    #[test]
    fn wait_shows_the_same_neutral_page_for_an_error_redirect() {
        let (l, port) = listener();
        let client = std::thread::spawn(move || get(port, "/auth/callback?error=access_denied&state=s1"));
        let got = wait_for_callback(l, "s1", Instant::now() + Duration::from_secs(10), || false).unwrap();
        let page = client.join().unwrap();
        assert_eq!(got.as_deref(), Some("/auth/callback?error=access_denied&state=s1"));
        assert!(page.contains("You can return to loomboard"));
    }

    #[test]
    fn a_stalled_client_does_not_hold_up_the_callback() {
        let (l, port) = listener();
        let client = std::thread::spawn(move || {
            // Connects and sends nothing, then the browser's redirect arrives.
            let _idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
            std::thread::sleep(Duration::from_millis(100));
            get(port, "/auth/callback?code=c1&state=s1")
        });
        let started = Instant::now();
        let got = wait_for_callback(l, "s1", Instant::now() + Duration::from_secs(30), || false).unwrap();
        assert_eq!(got.as_deref(), Some("/auth/callback?code=c1&state=s1"));
        assert!(started.elapsed() < Duration::from_secs(3), "waited {:?}", started.elapsed());
        client.join().unwrap();
    }

    #[test]
    fn cancel_ends_the_wait_even_with_a_stalled_client_connected() {
        let (l, port) = listener();
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = Arc::clone(&stop);
        let client = std::thread::spawn(move || {
            let idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            s2.store(true, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(3000));
            drop(idle);
        });
        let started = Instant::now();
        let got = wait_for_callback(l, "s1", Instant::now() + Duration::from_secs(30), || stop.load(Ordering::SeqCst)).unwrap();
        assert_eq!(got, None);
        assert!(started.elapsed() < Duration::from_secs(2), "waited {:?}", started.elapsed());
        client.join().unwrap();
    }

    #[test]
    fn a_connection_gets_one_deadline_not_one_per_read() {
        let (l, port) = listener();
        let client = std::thread::spawn(move || {
            // Drips a byte every 300 ms: within any per-read timeout, but not
            // within the connection's whole deadline.
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            for b in b"GET /auth/callback?code=c1&state=s1 HTTP/1.1\r\n" {
                if s.write_all(&[*b]).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        });
        let (stream, _) = l.accept().unwrap();
        let started = Instant::now();
        let got = serve(stream, "s1", Instant::now() + Duration::from_secs(1));
        assert_eq!(got, None);
        assert!(started.elapsed() < Duration::from_secs(3), "served for {:?}", started.elapsed());
        client.join().unwrap();
    }

    #[test]
    fn wait_gives_up_at_the_deadline() {
        let (l, _) = listener();
        assert_eq!(wait_for_callback(l, "s1", Instant::now(), || false).unwrap(), None);
    }

    #[test]
    fn a_cancelled_sign_in_cannot_open_the_browser() {
        // Cancel pressed while the frontend is still reading the server's
        // metadata: the browser must not open on the sign-in page afterwards.
        let lb = Loopback::default();
        let (l, _) = listener();
        *lb.listener.lock().unwrap() = Some(l);
        *lb.origin.lock().unwrap() = Some("https://lc.example".into());
        let url = "https://lc.example/v1/_oauth/authorize?client_id=loomboard";
        assert_eq!(may_open(&lb, url), Ok(()));
        cancel(&lb);
        assert_eq!(may_open(&lb, url), Err(NOT_IN_PROGRESS.to_string()));
    }

    #[test]
    fn opens_only_the_authorize_endpoint_on_the_base_url() {
        let o = "https://lc.example";
        assert!(authorize_url_allowed("https://lc.example/v1/_oauth/authorize?client_id=loomboard", o));
        assert!(authorize_url_allowed("https://lc.example/loom/v1/_oauth/authorize?x=1", o));
        assert!(!authorize_url_allowed("https://evil.example/v1/_oauth/authorize", o));
        assert!(!authorize_url_allowed("https://lc.example/ui/login", o));
        assert!(!authorize_url_allowed("https://user@lc.example/v1/_oauth/authorize", o));
        assert!(!authorize_url_allowed("file:///etc/passwd", o));
        assert!(!authorize_url_allowed("http://lc.example/v1/_oauth/authorize", "http://lc.example"));
        assert!(authorize_url_allowed("http://127.0.0.1:8787/v1/_oauth/authorize", "http://127.0.0.1:8787"));
    }

    #[test]
    fn opens_plain_http_only_to_a_private_network_ip_literal() {
        let ok = |url: &str| authorize_url_allowed(url, &web_origin(url).unwrap());
        // A plain-HTTP loomcycle on the LAN (the TrueNAS app) or this machine.
        for url in [
            "http://192.168.0.77:8787/v1/_oauth/authorize",
            "http://10.1.2.3/v1/_oauth/authorize",
            "http://172.16.0.9:8787/v1/_oauth/authorize",
            "http://172.31.255.1/v1/_oauth/authorize",
            "http://169.254.10.20/v1/_oauth/authorize",
            "http://[fd12:3456::1]:8787/v1/_oauth/authorize",
            "http://[fe80::1]/v1/_oauth/authorize",
            "http://127.0.0.1:8787/v1/_oauth/authorize",
            "http://[::1]:8787/v1/_oauth/authorize",
        ] {
            assert!(ok(url), "{url} should be allowed");
        }
        // Public addresses and any name — a name can resolve anywhere — stay https-only.
        for url in [
            "http://8.8.8.8/v1/_oauth/authorize",
            "http://172.32.0.1/v1/_oauth/authorize",
            "http://[2001:4860::8888]/v1/_oauth/authorize",
            "http://evil.example/v1/_oauth/authorize",
            "http://localhost:8787/v1/_oauth/authorize",
            "http://loomcycle.local/v1/_oauth/authorize",
        ] {
            assert!(!ok(url), "{url} should be refused");
        }
        let lan = "http://192.168.0.77:8787";
        assert!(!authorize_url_allowed("http://192.168.0.77:8787/ui/login", lan));
        assert!(!authorize_url_allowed("http://192.168.0.78:8787/v1/_oauth/authorize", lan));
        assert!(!authorize_url_allowed("http://192.168.0.77:9999/v1/_oauth/authorize", lan));
    }

    #[test]
    fn stores_only_a_sign_in_record() {
        let ok = r#"{"baseUrl":"https://lc.example","id":"s1","refreshToken":"rt","accessToken":"at","expiresAt":1900000000000}"#;
        assert!(validate_stored(ok).is_ok());
        assert!(validate_stored("not json").is_err());
        assert!(validate_stored(r#"{"baseUrl":"https://lc.example","refreshToken":"rt"}"#).is_err());
        assert!(validate_stored(&ok.replace("\"id\":\"s1\"", "\"id\":\"s1\",\"extra\":1")).is_err());
        assert!(validate_stored(&ok.replace("\"rt\"", &format!("\"{}\"", "x".repeat(5000)))).is_err());
        assert!(validate_stored(&ok.replace("https://lc.example", "javascript:alert(1)")).is_err());
        assert!(validate_stored(&ok.replace("\"at\"", "\"a\\nb\"")).is_err());
        assert!(validate_stored(&ok.replace("1900000000000", "\"soon\"")).is_err());
    }
}
