use tauri::Manager;
use std::process::Command;

fn main() {
    let backend_handle = Command::new("node")
        .arg("server.js")
        .current_dir("backend")
        .spawn();

    match backend_handle {
        Ok(mut child) => {
            println!("[TAURI] Backend process started, PID: {}", child.id());
        }
        Err(e) => {
            eprintln!("[TAURI] Failed to start backend: {}", e);
            eprintln!("[TAURI] Make sure Node.js is installed and backend dependencies are installed.");
        }
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_config,
            switch_mode,
            toggle_strategy,
            close_trade
        ])
        .setup(|_app| {
            println!("[TAURI] Underdog Quant Terminal initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_app_status() -> String {
    serde_json::json!({
        "status": "running",
        "version": "1.0.0",
        "name": "Underdog Quant Terminal"
    }).to_string()
}

#[tauri::command]
fn get_config() -> String {
    std::fs::read_to_string("backend/config.json")
        .unwrap_or_else(|_| "{}".to_string())
}

#[tauri::command]
fn switch_mode(mode: String) -> Result<String, String> {
    if mode != "DEMO" && mode != "REAL" {
        return Err("Invalid mode".to_string());
    }
    Ok(serde_json::json!({"status": "ok", "mode": mode}).to_string())
}

#[tauri::command]
fn toggle_strategy(name: String, enabled: bool) -> Result<String, String> {
    Ok(serde_json::json!({"status": "ok", "name": name, "enabled": enabled}).to_string())
}

#[tauri::command]
fn close_trade(ticket: u32) -> Result<String, String> {
    Ok(serde_json::json!({"status": "ok", "ticket": ticket}).to_string())
}
