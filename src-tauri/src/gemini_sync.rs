use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Antigravity settings.json path (cross-platform)
fn settings_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;

    #[cfg(target_os = "macos")]
    let path = home.join("Library/Application Support/Antigravity/User/settings.json");

    #[cfg(target_os = "windows")]
    let path = {
        let appdata = std::env::var("APPDATA")
            .map_err(|_| "Failed to get APPDATA".to_string())?;
        PathBuf::from(appdata).join("Antigravity/User/settings.json")
    };

    #[cfg(target_os = "linux")]
    let path = home.join(".config/Antigravity/User/settings.json");

    Ok(path)
}

/// The proxy keys we manage in settings.json
const PROXY_KEYS: [&str; 5] = [
    "jetski.cloudCodeUrl",
    "geminicodeassist.endpoint",
    "http.proxy",
    "http.proxyStrictSSL",
    "http.proxySupport",
];

/// Read settings.json as a serde_json::Value (or empty object if missing)
/// Strip JSONC features (trailing commas, // comments) so serde_json can parse it
fn sanitize_jsonc(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escape_next = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if escape_next {
            result.push(c);
            escape_next = false;
            continue;
        }
        if c == '\\' && in_string {
            result.push(c);
            escape_next = true;
            continue;
        }
        if c == '"' {
            in_string = !in_string;
            result.push(c);
            continue;
        }
        if !in_string {
            // Strip // line comments
            if c == '/' && chars.peek() == Some(&'/') {
                while let Some(nc) = chars.next() {
                    if nc == '\n' { result.push('\n'); break; }
                }
                continue;
            }
        }
        result.push(c);
    }

    // Strip trailing commas before } or ]
    let re_obj = regex_lite::Regex::new(r",(\s*[}\]])").unwrap();
    re_obj.replace_all(&result, "$1").to_string()
}

/// Read settings.json as a serde_json::Value (or empty object if missing)
fn read_settings() -> Result<(PathBuf, Value), String> {
    let path = settings_json_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
        return Ok((path, serde_json::json!({})));
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    let sanitized = sanitize_jsonc(&content);
    let json: Value = serde_json::from_str(&sanitized)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;
    Ok((path, json))
}

/// Write settings.json back to disk (pretty-printed)
fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(path, content)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;
    Ok(())
}

/// Inject proxy settings into Antigravity's settings.json
#[tauri::command]
pub async fn sync_gemini_config(proxy_url: String) -> Result<String, String> {
    let (path, mut settings) = read_settings()?;

    let obj = settings.as_object_mut()
        .ok_or("settings.json is not a JSON object")?;

    obj.insert("jetski.cloudCodeUrl".to_string(), Value::String(proxy_url.clone()));
    obj.insert("geminicodeassist.endpoint".to_string(), Value::String(proxy_url.clone()));
    obj.insert("http.proxyStrictSSL".to_string(), Value::Bool(false));
    obj.insert("http.proxySupport".to_string(), Value::String("override".to_string()));

    write_settings(&path, &settings)?;

    Ok(format!("Proxy settings injected → {} — restart Antigravity to apply", proxy_url))
}

/// Remove proxy settings from Antigravity's settings.json
#[tauri::command]
pub async fn restore_gemini_config() -> Result<String, String> {
    let (path, mut settings) = read_settings()?;

    let obj = settings.as_object_mut()
        .ok_or("settings.json is not a JSON object")?;

    for key in &PROXY_KEYS {
        obj.remove(*key);
    }

    write_settings(&path, &settings)?;

    Ok("Proxy settings removed — restart Antigravity to apply".to_string())
}

/// Check if proxy settings are currently active in settings.json
#[tauri::command]
pub async fn get_gemini_sync_status(proxy_url: String) -> Result<GeminiSyncStatus, String> {
    let (path, settings) = read_settings()?;

    let current_url = settings.get("geminicodeassist.endpoint")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let is_synced = current_url.as_deref() == Some(proxy_url.as_str());
    let strict_ssl_off = settings.get("http.proxyStrictSSL")
        .and_then(|v| v.as_bool())
        == Some(false);

    Ok(GeminiSyncStatus {
        is_synced: is_synced && strict_ssl_off,
        has_backup: false, // No longer relevant — no binary backup
        current_url,
    })
}

#[derive(serde::Serialize)]
pub struct GeminiSyncStatus {
    pub is_synced: bool,
    pub has_backup: bool,
    pub current_url: Option<String>,
}
