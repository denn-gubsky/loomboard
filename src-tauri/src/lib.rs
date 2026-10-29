mod sign_in;

// Mobile-ready entry point (the #[cfg_attr(mobile, ...)] keeps Phase-2 Android/
// iOS working without restructuring). Registers the HTTP plugin so the webview's
// injected fetch (@tauri-apps/plugin-http) is routed through Rust — that is what
// lets the SPA reach a CORS-less loomcycle directly, with no Node proxy. The
// opener plugin is used from Rust only (sign_in::oauth_open_browser), so the
// webview is granted no opener permission of its own.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(sign_in::Loopback::default())
        .invoke_handler(tauri::generate_handler![
            sign_in::oauth_loopback_start,
            sign_in::oauth_loopback_wait,
            sign_in::oauth_loopback_cancel,
            sign_in::oauth_open_browser,
            sign_in::sign_in_secret_get,
            sign_in::sign_in_secret_set,
            sign_in::sign_in_secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
