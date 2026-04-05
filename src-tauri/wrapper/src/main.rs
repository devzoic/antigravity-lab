use std::env;
use std::process::{Command, exit};

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

    let status = Command::new(real_exe)
        .args(new_args)
        .status()
        .expect("Failed to execute real language server binary");

    exit(status.code().unwrap_or(1));
}
