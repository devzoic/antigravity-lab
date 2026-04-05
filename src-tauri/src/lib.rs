use serde::{Deserialize, Serialize};
use tauri::{
    Manager, RunEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use std::sync::Arc;
use tokio::sync::Mutex;

mod antigravity;
mod gemini_sync;
mod proxy_server;

#[derive(Serialize)]
struct HwidResult {
    hardware_id: String,
    os: String,
    device_name: String,
}

#[tauri::command]
fn get_hardware_id() -> Result<HwidResult, String> {
    let hwid = machine_uid::get().map_err(|e| format!("Failed to get HWID: {}", e))?;
    let os = std::env::consts::OS.to_string();
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    Ok(HwidResult {
        hardware_id: hwid,
        os,
        device_name,
    })
}

#[derive(Serialize)]
struct DbStatusResult {
    found: bool,
    path: String,
}

/// Check if Antigravity database exists
#[tauri::command]
fn check_antigravity_db() -> Result<DbStatusResult, String> {
    let db_path = antigravity::get_db_path()?;
    let path_str = db_path.to_string_lossy().to_string();
    Ok(DbStatusResult {
        found: db_path.exists(),
        path: path_str,
    })
}

#[derive(Serialize)]
struct RestartResult {
    success: bool,
    message: String,
}

// ─── Proxy Server Commands ────────────────────────────────────────

struct ProxyHandle(Mutex<Option<proxy_server::ProxyServer>>);
struct ProxyStateHandle(Arc<tokio::sync::RwLock<Option<proxy_server::ActiveAccount>>>);

#[derive(Serialize)]
struct ProxyStatus {
    running: bool,
    port: u16,
    active_email: Option<String>,
}

#[tauri::command]
async fn start_proxy(
    port: u16,
    handle: tauri::State<'_, ProxyHandle>,
    state_handle: tauri::State<'_, ProxyStateHandle>,
) -> Result<String, String> {
    let mut guard = handle.0.lock().await;
    if guard.is_some() {
        return Ok("Proxy already running".to_string());
    }

    let (server, _join) = proxy_server::ProxyServer::start(port).await?;

    // Share the active account state
    {
        let mut shared = state_handle.0.write().await;
        *shared = server.state.active_account.read().await.clone();
    }

    *guard = Some(server);
    Ok(format!("MITM Proxy started on port {}", port))
}

#[tauri::command]
async fn stop_proxy(handle: tauri::State<'_, ProxyHandle>) -> Result<String, String> {
    let mut guard = handle.0.lock().await;
    if let Some(server) = guard.take() {
        server.stop();
        Ok("Proxy stopped".to_string())
    } else {
        Ok("Proxy was not running".to_string())
    }
}

#[tauri::command]
async fn get_proxy_status(
    handle: tauri::State<'_, ProxyHandle>,
) -> Result<ProxyStatus, String> {
    let guard = handle.0.lock().await;
    match guard.as_ref() {
        Some(server) => {
            let acc = server.state.active_account.read().await;
            Ok(ProxyStatus {
                running: true,
                port: 4000,
                active_email: acc.as_ref().map(|a| a.email.clone()),
            })
        }
        None => Ok(ProxyStatus {
            running: false,
            port: 4000,
            active_email: None,
        }),
    }
}

#[tauri::command]
async fn set_active_proxy_account(
    access_token: String,
    refresh_token: String,
    email: String,
    project_id: Option<String>,
    expires_at: Option<i64>,
    handle: tauri::State<'_, ProxyHandle>,
) -> Result<String, String> {
    let guard = handle.0.lock().await;
    let server = guard.as_ref().ok_or("Proxy is not running")?;

    let account = proxy_server::ActiveAccount {
        access_token,
        refresh_token,
        email: email.clone(),
        project_id: project_id.unwrap_or_else(|| "bamboo-precept-lgxtn".to_string()),
        expires_at: expires_at.unwrap_or_else(|| chrono::Utc::now().timestamp() + 3600),
    };

    let mut acc_guard = server.state.active_account.write().await;
    *acc_guard = Some(account);

    Ok(format!("Active proxy account set to: {}", email))
}

#[tauri::command]
async fn inject_session_uuid(user_id: u64, hwid: String) -> Result<String, String> {
    let db_path = antigravity::get_db_path().map_err(|e| e.to_string())?;
    let fake_access_token = format!("ya29.USER-{}-HWID-{}", user_id, hwid);
    let fake_refresh = "proxy-managed".to_string();
    let expiry = 2051222400; // 2035
    
    antigravity::inject_token(&db_path, &fake_access_token, &fake_refresh, expiry)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_proxy_version(
    version: String,
    handle: tauri::State<'_, ProxyHandle>,
) -> Result<String, String> {
    let guard = handle.0.lock().await;
    let server = guard.as_ref().ok_or("Proxy is not running")?;
    let mut v = server.state.spoofed_version.write().await;
    *v = version.clone();
    Ok(format!("Proxy User-Agent set to: antigravity/{}", version))
}

#[tauri::command]
async fn get_proxy_logs(
    handle: tauri::State<'_, ProxyHandle>,
) -> Result<Vec<proxy_server::ProxyLogEntry>, String> {
    let guard = handle.0.lock().await;
    match guard.as_ref() {
        Some(server) => {
            let logs = server.state.logs.lock().await;
            Ok(logs.clone())
        }
        None => Ok(vec![]),
    }
}

#[derive(Serialize)]
struct WrapperStatus {
    wrapped: bool,
}

#[tauri::command]
fn wrap_lang_server(app: tauri::AppHandle, proxy_url: String) -> Result<String, String> {
    proxy_server::wrap_language_server(&app, &proxy_url)
}

#[tauri::command]
fn unwrap_lang_server() -> Result<String, String> {
    proxy_server::unwrap_language_server()
}

#[tauri::command]
fn get_wrapper_status() -> Result<WrapperStatus, String> {
    Ok(WrapperStatus {
        wrapped: proxy_server::is_language_server_wrapped(),
    })
}



/// Wipe OAuth tokens from Antigravity's local database
#[tauri::command]
fn wipe_antigravity_tokens() -> Result<String, String> {
    let db_path = antigravity::get_db_path()?;
    if !db_path.exists() {
        return Ok("Antigravity DB not found — nothing to wipe".to_string());
    }
    antigravity::wipe_tokens(&db_path)
}

/// Kill all Antigravity processes
#[tauri::command]
async fn kill_antigravity() -> Result<String, String> {
    use sysinfo::System;

    let mut system = System::new_all();
    system.refresh_all();
    let our_pid = std::process::id();
    let mut killed = 0;

    for (pid, process) in system.processes() {
        if pid.as_u32() == our_pid {
            continue;
        }

        if let Some(exe) = process.exe() {
            let exe_str = exe.to_string_lossy().to_lowercase();
            let name = process.name().to_string_lossy().to_lowercase();

            let is_antigravity = {
                #[cfg(target_os = "macos")]
                { exe_str.contains("antigravity.app/contents/macos") }
                #[cfg(target_os = "windows")]
                { exe_str.contains("antigravity") && exe_str.ends_with(".exe") }
                #[cfg(target_os = "linux")]
                { exe_str.ends_with("/antigravity") }
            };

            let is_helper = name.contains("helper")
                || name.contains("renderer")
                || name.contains("gpu")
                || name.contains("plugin")
                || name.contains("crashpad")
                || name.contains("utility");

            if is_antigravity && !is_helper {
                process.kill();
                killed += 1;
            }
        }
    }

    Ok(format!("Killed {} Antigravity processes", killed))
}

/// Kill and relaunch Antigravity so it reads updated config
#[tauri::command]
async fn restart_antigravity() -> Result<String, String> {
    let kill_result = kill_antigravity().await?;
    
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("Antigravity")
            .spawn()
            .map_err(|e| format!("Failed to relaunch Antigravity: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA not set".to_string())?;
        let programs = std::path::PathBuf::from(&appdata).join("Programs");

        // Try known folder names for the Antigravity IDE installation
        let candidates = [
            ("Antigravity", "Antigravity.exe"),
            ("Antigravity Lab", "Antigravity Lab.exe"),
            ("antigravity", "Antigravity.exe"),
            ("antigravity-lab", "Antigravity Lab.exe"),
        ];

        let mut exe_path = None;
        for (folder, exe_name) in &candidates {
            let p = programs.join(folder).join(exe_name);
            if p.exists() {
                exe_path = Some(p);
                break;
            }
        }

        let exe = exe_path.ok_or_else(|| {
            format!("Could not find Antigravity IDE executable in {}", programs.display())
        })?;

        std::process::Command::new(&exe)
            .spawn()
            .map_err(|e| format!("Failed to relaunch Antigravity: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("antigravity")
            .spawn()
            .map_err(|e| format!("Failed to relaunch Antigravity: {}", e))?;
    }
    
    Ok(format!("{} — relaunched Antigravity", kill_result))
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(ProxyHandle(Mutex::new(None)))
        .manage(ProxyStateHandle(Arc::new(tokio::sync::RwLock::new(None))))
        .invoke_handler(tauri::generate_handler![
            get_hardware_id,
            check_antigravity_db,
            wipe_antigravity_tokens,
            kill_antigravity,
            restart_antigravity,
            // Proxy commands
            start_proxy,
            stop_proxy,
            get_proxy_status,
            set_active_proxy_account,
            set_proxy_version,
            get_proxy_logs,
            inject_session_uuid,
            // Language server wrapper commands
            wrap_lang_server,
            unwrap_lang_server,
            get_wrapper_status,
            // Settings sync commands
            gemini_sync::sync_gemini_config,
            gemini_sync::restore_gemini_config,
            gemini_sync::get_gemini_sync_status,
        ])
        .setup(|app| {
            // ── System Tray Menu ──
            let show_i = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            if let Some(tray) = app.tray_by_id("main-tray") {
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                        "quit" => {
                            // Wipe tokens from Antigravity DB before exiting
                            if let Ok(db_path) = antigravity::get_db_path() {
                                let _ = antigravity::wipe_tokens(&db_path);
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                });
                tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
