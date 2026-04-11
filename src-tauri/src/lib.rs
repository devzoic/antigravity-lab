use serde::{Serialize};
use tauri::{
    Manager, RunEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

mod antigravity;
mod gemini_sync;

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



/// Check if the Antigravity IDE process is currently running
#[tauri::command]
fn is_antigravity_running() -> bool {
    use std::process::Command;
    
    #[cfg(target_os = "macos")]
    {
        Command::new("pgrep")
            .args(["-f", "Antigravity.app"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq Antigravity.exe"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("Antigravity"))
            .unwrap_or(false)
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("pgrep")
            .args(["-f", "antigravity"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

#[tauri::command]
async fn inject_real_token(access_token: String, refresh_token: Option<String>) -> Result<String, String> {
    let db_path = antigravity::get_db_path().map_err(|e| e.to_string())?;
    // Tier 1 users get the real refresh token so the IDE can self-refresh.
    // Tier 2 users get "proxy-managed" — the Tauri heartbeat handles refresh.
    let refresh = refresh_token.unwrap_or_else(|| "proxy-managed".to_string());
    let expiry = 2051222400; // 2035
    
    antigravity::inject_token(&db_path, &access_token, &refresh, expiry)
        .map_err(|e| e.to_string())
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

/// Kill and relaunch Antigravity so it reads the freshly injected token.
#[tauri::command]
async fn restart_antigravity() -> Result<String, String> {
    let kill_result = kill_antigravity().await?;
    
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    
    #[cfg(target_os = "macos")]
    {
        // Standard macOS app launch — clean, no custom env vars
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
        .invoke_handler(tauri::generate_handler![
            get_hardware_id,
            check_antigravity_db,
            is_antigravity_running,
            wipe_antigravity_tokens,
            kill_antigravity,
            restart_antigravity,
            inject_real_token,
            // Settings sync
            gemini_sync::restore_gemini_config,
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
