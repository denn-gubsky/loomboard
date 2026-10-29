fn main() {
  // Declaring the app's own commands puts them under the capability ACL: a
  // window may call only the ones capabilities/default.json grants it (without
  // a manifest every app command is callable from every webview).
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
    tauri_build::AppManifest::new().commands(&[
      "oauth_loopback_start",
      "oauth_loopback_wait",
      "oauth_loopback_cancel",
      "oauth_open_browser",
      "sign_in_secret_get",
      "sign_in_secret_set",
      "sign_in_secret_delete",
    ]),
  ))
  .expect("failed to run tauri-build");
}
