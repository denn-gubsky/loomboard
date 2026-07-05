// Mobile-ready entry point (the #[cfg_attr(mobile, ...)] keeps Phase-2 Android/
// iOS working without restructuring). Registers the HTTP plugin so the webview's
// injected fetch (@tauri-apps/plugin-http) is routed through Rust — that is what
// lets the SPA reach a CORS-less loomcycle directly, with no Node proxy.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
