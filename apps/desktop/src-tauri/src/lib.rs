/// Returns the control-plane base URL the webview should talk to.
///
/// The control plane is a Node process (see `packages/server/src/cli.ts`)
/// exposing HTTP + WebSocket on loopback. In dev it is started separately with
/// `npm run dev:server`; in production it is bundled as a Tauri sidecar and
/// spawned here. The webview reads this value via `invoke("get_control_url")`.
#[tauri::command]
fn get_control_url() -> String {
    std::env::var("CONTROL_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_control_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
