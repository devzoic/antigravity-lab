use serde::{Deserialize, Serialize};
use tauri::{
    Manager, RunEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

mod antigravity;

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

#[derive(Deserialize)]
struct InjectRequest {
    access_token: String,
    refresh_token: String,
    expiry: i64,
    email: String,
}

#[derive(Serialize)]
struct InjectResult {
    success: bool,
    message: String,
    db_path: String,
}

/// Inject Google account tokens into Antigravity's local SQLite database
#[tauri::command]
fn inject_antigravity_token(request: InjectRequest) -> Result<InjectResult, String> {
    let db_path = antigravity::get_db_path()?;
    let db_path_str = db_path.to_string_lossy().to_string();

    if !db_path.exists() {
        return Err(format!(
            "Antigravity database not found at: {}. Please make sure Antigravity is installed and has been launched at least once.",
            db_path_str
        ));
    }

    let message = antigravity::inject_token(
        &db_path,
        &request.access_token,
        &request.refresh_token,
        request.expiry,
        &request.email,
    )?;

    Ok(InjectResult {
        success: true,
        message,
        db_path: db_path_str,
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

/// Combined: kill Antigravity → inject tokens → relaunch.
#[tauri::command]
async fn switch_and_restart_antigravity(request: InjectRequest) -> Result<RestartResult, String> {
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
                { exe_str.ends_with("antigravity.exe") }
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

    std::thread::sleep(std::time::Duration::from_millis(2500));

    let db_path = antigravity::get_db_path()?;
    if !db_path.exists() {
        return Err(format!(
            "Antigravity database not found at: {}. Please make sure Antigravity is installed.",
            db_path.to_string_lossy()
        ));
    }

    antigravity::inject_token(
        &db_path,
        &request.access_token,
        &request.refresh_token,
        request.expiry,
        &request.email,
    )?;

    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("open")
            .args(["-a", "Antigravity"])
            .output();

        match result {
            Ok(output) if output.status.success() => Ok(RestartResult {
                success: true,
                message: format!("Account switched & Antigravity restarted (killed {} processes)", killed),
            }),
            Ok(output) => {
                let err = String::from_utf8_lossy(&output.stderr);
                Ok(RestartResult {
                    success: false,
                    message: format!("Tokens injected but failed to launch: {}", err),
                })
            }
            Err(e) => Ok(RestartResult {
                success: false,
                message: format!("Tokens injected but failed to launch: {}", e),
            }),
        }
    }

    #[cfg(target_os = "windows")]
    {
        let result = std::process::Command::new("cmd")
            .args(["/C", "start", "antigravity://"])
            .spawn();

        match result {
            Ok(_) => Ok(RestartResult {
                success: true,
                message: format!("Account switched & Antigravity restarted (killed {} processes)", killed),
            }),
            Err(e) => Ok(RestartResult {
                success: false,
                message: format!("Tokens injected but failed to launch: {}", e),
            }),
        }
    }

    #[cfg(target_os = "linux")]
    {
        let result = std::process::Command::new("antigravity")
            .spawn()
            .or_else(|_| std::process::Command::new("flatpak")
                .args(["run", "com.antigravity.Antigravity"])
                .spawn());

        match result {
            Ok(_) => Ok(RestartResult {
                success: true,
                message: format!("Account switched & Antigravity restarted (killed {} processes)", killed),
            }),
            Err(e) => Ok(RestartResult {
                success: false,
                message: format!("Tokens injected but failed to launch: {}", e),
            }),
        }
    }
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
                { exe_str.ends_with("antigravity.exe") }
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
            inject_antigravity_token,
            check_antigravity_db,
            switch_and_restart_antigravity,
            wipe_antigravity_tokens,
            kill_antigravity,
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

            // ── Auto-start is enabled by the autostart plugin init above ──

            Ok(())
        })
        .on_window_event(|window, event| {
            // ── Close to tray instead of quitting ──
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Re-show window when dock icon is clicked on macOS
            if let RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
