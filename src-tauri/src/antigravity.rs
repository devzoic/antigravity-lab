use base64::{engine::general_purpose, Engine as _};
use rusqlite::Connection;
use std::path::PathBuf;

/// Get Antigravity database path (cross-platform)
/// Checks portable mode first, then standard OS-specific paths
pub fn get_db_path() -> Result<PathBuf, String> {
    // Standard mode: use system default path
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let path = home.join("Library/Application Support/Antigravity/User/globalStorage/state.vscdb");
        if path.exists() {
            return Ok(path);
        }
        // Also check Cursor-style path
        let alt_path = home.join("Library/Application Support/Antigravity/globalStorage/state.vscdb");
        if alt_path.exists() {
            return Ok(alt_path);
        }
        Ok(path) // Return default even if not found yet
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA")
            .map_err(|_| "Failed to get APPDATA environment variable".to_string())?;
        let path = PathBuf::from(&appdata)
            .join("Antigravity")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb");
        if path.exists() {
            return Ok(path);
        }
        // Alternate
        let alt_path = PathBuf::from(&appdata)
            .join("Antigravity")
            .join("globalStorage")
            .join("state.vscdb");
        if alt_path.exists() {
            return Ok(alt_path);
        }
        Ok(path)
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        let path = home.join(".config/Antigravity/User/globalStorage/state.vscdb");
        if path.exists() {
            return Ok(path);
        }
        let alt_path = home.join(".config/Antigravity/globalStorage/state.vscdb");
        if alt_path.exists() {
            return Ok(alt_path);
        }
        Ok(path)
    }
}

/// Inject OAuth token into Antigravity's SQLite database
/// Supports both new format (≥1.16.5) and old format
pub fn inject_token(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
) -> Result<String, String> {
    // Try new format first, then old format
    let new_result = inject_new_format(db_path, access_token, refresh_token, expiry);
    let old_result = inject_old_format(db_path, access_token, refresh_token, expiry);

    if new_result.is_ok() || old_result.is_ok() {
        Ok("Token injection successful — restart Antigravity to apply changes".to_string())
    } else {
        Err(format!(
            "Both injection formats failed. New: {:?}, Old: {:?}",
            new_result.err(),
            old_result.err()
        ))
    }
}

// ─── Protobuf Helpers (simplified) ──────────────────────────────────────────

/// Encode a varint (variable-length integer)
fn encode_varint(mut value: u64) -> Vec<u8> {
    let mut buf = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
    buf
}

/// Encode a string field (wire type 2 = length-delimited)
fn encode_string_field(field_number: u32, value: &str) -> Vec<u8> {
    let tag = encode_varint(((field_number as u64) << 3) | 2);
    let len = encode_varint(value.len() as u64);
    let mut result = tag;
    result.extend(len);
    result.extend(value.as_bytes());
    result
}

/// Encode a length-delimited field (wire type 2 = length-delimited, bytes)
fn encode_len_delim_field(field_number: u32, data: &[u8]) -> Vec<u8> {
    let tag = encode_varint(((field_number as u64) << 3) | 2);
    let len = encode_varint(data.len() as u64);
    let mut result = tag;
    result.extend(len);
    result.extend(data);
    result
}

/// Encode a varint field (wire type 0)
fn encode_varint_field(field_number: u32, value: u64) -> Vec<u8> {
    let tag = encode_varint(((field_number as u64) << 3) | 0);
    let val = encode_varint(value);
    let mut result = tag;
    result.extend(val);
    result
}

/// Create OAuthTokenInfo protobuf binary (matching Antigravity Manager's format):
/// message OAuthTokenInfo {
///     optional string access_token = 1;
///     optional string token_type = 2;   // "Bearer"
///     optional string refresh_token = 3;
///     optional Timestamp expiry = 4;    // nested: { int64 seconds = 1; }
/// }
fn create_oauth_info(access_token: &str, refresh_token: &str, expiry: i64) -> Vec<u8> {
    // Field 1: access_token
    let field1 = encode_string_field(1, access_token);

    // Field 2: token_type = "Bearer"
    let field2 = encode_string_field(2, "Bearer");

    // Field 3: refresh_token
    let field3 = encode_string_field(3, refresh_token);

    // Field 4: expiry as nested Timestamp message { field 1 = seconds (varint) }
    let timestamp_inner = encode_varint_field(1, expiry as u64);
    let field4 = encode_len_delim_field(4, &timestamp_inner);

    [field1, field2, field3, field4].concat()
}

// ─── Injection Formats ─────────────────────────────────────────────────────

/// New format injection (Antigravity ≥ 1.16.5)
/// Key: antigravityUnifiedStateSync.oauthToken
fn inject_new_format(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
) -> Result<String, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    // Create OAuthTokenInfo (binary protobuf)
    let oauth_info = create_oauth_info(access_token, refresh_token, expiry);
    let oauth_info_b64 = general_purpose::STANDARD.encode(&oauth_info);

    // InnerMessage2: field 1 = base64(oauth_info)
    let inner2 = encode_string_field(1, &oauth_info_b64);

    // InnerMessage: field 1 = sentinel key, field 2 = inner2
    let inner1 = encode_string_field(1, "oauthTokenInfoSentinelKey");
    let inner = [inner1, encode_len_delim_field(2, &inner2)].concat();

    // OuterMessage: field 1 = inner
    let outer = encode_len_delim_field(1, &inner);
    let outer_b64 = general_purpose::STANDARD.encode(&outer);

    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        ["antigravityUnifiedStateSync.oauthToken", &outer_b64],
    )
    .map_err(|e| format!("Failed to write new format: {}", e))?;

    // Inject Onboarding flag
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        ["antigravityOnboarding", "true"],
    )
    .map_err(|e| format!("Failed to write onboarding flag: {}", e))?;

    Ok("Token injection successful (new format)".to_string())
}

/// Old format injection (Antigravity < 1.16.5)
/// Key: jetskiStateSync.agentManagerInitState
fn inject_old_format(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
) -> Result<String, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    // Check if old format key exists
    let current_data: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?",
        ["jetskiStateSync.agentManagerInitState"],
        |row| row.get(0),
    );

    match current_data {
        Ok(existing) => {
            // Decode existing data, replace OAuth fields
            let blob = general_purpose::STANDARD
                .decode(&existing)
                .map_err(|e| format!("Base64 decoding failed: {}", e))?;

            // Build new OAuth token field only — preserve existing identity fields
            let oauth_info = create_oauth_info(access_token, refresh_token, expiry);
            let oauth_field = encode_len_delim_field(6, &oauth_info);

            // Only remove field 6 (OAuth token) — keep fields 1,2 (identity/email) intact
            let clean = remove_protobuf_fields(&blob, &[6]);
            let final_data = [clean, oauth_field].concat();
            let final_b64 = general_purpose::STANDARD.encode(&final_data);

            conn.execute(
                "UPDATE ItemTable SET value = ? WHERE key = ?",
                [&final_b64, "jetskiStateSync.agentManagerInitState"],
            )
            .map_err(|e| format!("Failed to write data: {}", e))?;

            // Inject Onboarding flag
            conn.execute(
                "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
                ["antigravityOnboarding", "true"],
            )
            .map_err(|e| format!("Failed to write onboarding flag: {}", e))?;

            Ok("Token injection successful (old format)".to_string())
        }
        Err(_) => Err("Old format key not found — likely newer Antigravity version".to_string()),
    }
}

/// Remove specific protobuf fields by field number
fn remove_protobuf_fields(data: &[u8], fields_to_remove: &[u32]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut i = 0;

    while i < data.len() {
        let start = i;
        // Parse tag
        let (tag, bytes_read) = decode_varint(&data[i..]);
        if bytes_read == 0 {
            break;
        }
        i += bytes_read;

        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 0x07) as u8;

        // Skip field based on wire type
        match wire_type {
            0 => {
                // Varint
                let (_, vr) = decode_varint(&data[i..]);
                i += vr;
            }
            1 => {
                // 64-bit
                i += 8;
            }
            2 => {
                // Length-delimited
                let (len, vr) = decode_varint(&data[i..]);
                i += vr + len as usize;
            }
            5 => {
                // 32-bit
                i += 4;
            }
            _ => break,
        }

        // If not in remove list, keep the field
        if !fields_to_remove.contains(&field_number) {
            result.extend_from_slice(&data[start..i]);
        }
    }

    result
}

/// Decode a protobuf varint, returns (value, bytes_consumed)
fn decode_varint(data: &[u8]) -> (u64, usize) {
    let mut value: u64 = 0;
    let mut shift = 0;
    for (i, &byte) in data.iter().enumerate() {
        value |= ((byte & 0x7F) as u64) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            return (value, i + 1);
        }
        if i >= 9 {
            break; // Max 10 bytes for u64
        }
    }
    (value, 0)
}

/// Wipe OAuth tokens from Antigravity's database.
/// Removes both new-format and old-format token entries.
pub fn wipe_tokens(db_path: &PathBuf) -> Result<String, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    // Delete token entries (both formats)
    let keys = [
        "antigravityUnifiedStateSync.oauthToken",
        "jetskiStateSync.agentManagerInitState",
        "antigravityOnboarding",
    ];

    let mut deleted = 0;
    for key in &keys {
        let result = conn.execute("DELETE FROM ItemTable WHERE key = ?", [key]);
        if let Ok(count) = result {
            deleted += count;
        }
    }

    Ok(format!("Wiped {} token entries from Antigravity DB", deleted))
}
