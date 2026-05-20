use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Get all Antigravity settings.json paths (cross-platform).
/// Returns paths for both Antigravity IDE (primary) and classic Antigravity.
fn all_settings_json_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return paths,
    };

    #[cfg(target_os = "macos")]
    {
        // Antigravity IDE (primary)
        let ide_path = home.join("Library/Application Support/Antigravity IDE/User/settings.json");
        paths.push(ide_path);
        // Classic Antigravity
        let classic_path = home.join("Library/Application Support/Antigravity/User/settings.json");
        paths.push(classic_path);
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            // Antigravity IDE (primary)
            paths.push(PathBuf::from(&appdata).join("Antigravity IDE/User/settings.json"));
            // Legacy Antigravity (secondary)
            paths.push(PathBuf::from(&appdata).join("Antigravity/User/settings.json"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        paths.push(home.join(".config/Antigravity IDE/User/settings.json"));
        paths.push(home.join(".config/Antigravity/User/settings.json"));
    }

    paths
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
fn read_settings(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    let sanitized = sanitize_jsonc(&content);
    let json: Value = serde_json::from_str(&sanitized)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;
    Ok(json)
}

/// Write settings.json back to disk (pretty-printed)
fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(path, content)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;
    Ok(())
}


/// Remove proxy settings from all Antigravity settings.json files (IDE + classic)
#[tauri::command]
pub async fn restore_gemini_config() -> Result<String, String> {
    let paths = all_settings_json_paths();
    let mut updated = 0;

    for path in &paths {
        if !path.exists() {
            continue;
        }
        match read_settings(path) {
            Ok(mut settings) => {
                if let Some(obj) = settings.as_object_mut() {
                    for key in &PROXY_KEYS {
                        obj.remove(*key);
                    }
                    if write_settings(path, &settings).is_ok() {
                        updated += 1;
                    }
                }
            }
            Err(_) => continue,
        }
    }

    Ok(format!("Proxy settings removed from {} config(s) — restart IDE to apply", updated))
}

