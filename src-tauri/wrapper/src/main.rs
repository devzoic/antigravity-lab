use std::env;
use std::process::{Command, exit};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Signature to prevent the proxy_server from double-wrapping the wrapper itself
pub const ANTIGRAVITY_SIG: &[u8] = b"ANTIGRAVITY_RUST_WRAPPER_V1";

fn main() {
    let mut args: Vec<String> = env::args().collect();
    
    // We expect the original binary name to be passed as the 0th arg
    // But since Windows calls this wrapper directly, args[0] is the wrapper itself.
    // The real binary is named language_server_windows_amd64.real.exe in the same folder.
    let current_exe = env::current_exe().expect("Failed to get current executable path");
    let real_exe = current_exe.with_extension("real.exe");

    let mut new_args = Vec::new();
    let mut next_is_endpoint = false;

    // Start from args[1] onwards
    for arg in args.into_iter().skip(1) {
        if next_is_endpoint {
            new_args.push("https://proxy.devzoic.com".to_string());
            next_is_endpoint = false;
        } else if arg == "--cloud_code_endpoint" {
            new_args.push(arg);
            next_is_endpoint = true;
        } else {
            new_args.push(arg);
        }
    }

    let mut child = Command::new(&real_exe);
    child.args(new_args);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        child.creation_flags(CREATE_NO_WINDOW);
    }

    let status = child
        .status()
        .unwrap_or_else(|e| {
            eprintln!("Failed to execute real language server binary: {}", e);
            exit(1);
        });

    exit(status.code().unwrap_or(1));
}
