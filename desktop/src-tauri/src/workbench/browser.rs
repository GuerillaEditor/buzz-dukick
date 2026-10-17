use serde::Serialize;
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};
use uuid::Uuid;

use super::profiles::{default_profile_root, profile_directory};

#[derive(Debug, Serialize)]
pub struct BrowserWebviewInfo {
    pub label: String,
    pub profile: String,
    pub url: String,
}

pub fn validate_cdp_bind_host(host: &str) -> Result<(), String> {
    match host {
        "127.0.0.1" => Ok(()),
        _ => Err("CDP must bind to loopback".to_string()),
    }
}

fn is_workbench_browser_label(label: &str) -> bool {
    label.starts_with("workbench-browser-")
}

fn validate_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|_| "invalid browser URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("browser URL must use http or https".to_string()),
    }
}

/// Create an isolated native child webview attached to the main window.
#[tauri::command]
pub async fn workbench_browser_open(
    app: tauri::AppHandle,
    profile: String,
    url: String,
) -> Result<BrowserWebviewInfo, String> {
    let parsed = validate_url(&url)?;
    validate_cdp_bind_host("127.0.0.1")?;
    let root = default_profile_root()?;
    let data_directory = profile_directory(&root, &profile)?;
    std::fs::create_dir_all(&data_directory).map_err(|error| error.to_string())?;
    let label = format!("workbench-browser-{}", Uuid::new_v4());
    let window = app.get_window("main").ok_or("main window unavailable")?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let width = 380.0_f64;
    let scale = window.scale_factor().unwrap_or(1.0);
    let logical = size.to_logical::<f64>(scale);
    // Leave the dock's browser tab strip and navigation controls visible above
    // the native child webview. The workbench layout owns this inset.
    let toolbar_inset = 150.0_f64;
    let position = LogicalPosition::new((logical.width - width).max(0.0), toolbar_inset);
    let child_size = LogicalSize::new(width, (logical.height - toolbar_inset).max(1.0));
    let port = 9300 + (Uuid::new_v4().as_u128() % 600) as u16;
    let browser = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
        .data_directory(data_directory)
        .additional_browser_args(&format!(
            "--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"
        ));
    window
        .add_child(browser, position, child_size)
        .map_err(|error| error.to_string())?;
    Ok(BrowserWebviewInfo {
        label,
        profile,
        url,
    })
}

#[tauri::command]
pub async fn workbench_browser_activate(
    app: tauri::AppHandle,
    label: Option<String>,
) -> Result<(), String> {
    if let Some(target) = label.as_deref() {
        if !is_workbench_browser_label(target) {
            return Err("invalid workbench browser label".to_string());
        }
    }

    for (candidate, webview) in app.webviews() {
        if !is_workbench_browser_label(&candidate) {
            continue;
        }
        if label.as_deref() == Some(candidate.as_str()) {
            webview.show().map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn workbench_browser_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    if !is_workbench_browser_label(&label) {
        return Err("invalid workbench browser label".to_string());
    }
    let parsed = validate_url(&url)?;
    let webview = app.get_webview(&label).ok_or("browser tab not found")?;
    webview.navigate(parsed).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workbench_browser_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if !is_workbench_browser_label(&label) {
        return Err("invalid workbench browser label".to_string());
    }
    let webview = app.get_webview(&label).ok_or("browser tab not found")?;
    webview.reload().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workbench_browser_history(
    app: tauri::AppHandle,
    label: String,
    direction: String,
) -> Result<(), String> {
    if !is_workbench_browser_label(&label) {
        return Err("invalid workbench browser label".to_string());
    }
    let script = match direction.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        _ => return Err("history direction must be back or forward".to_string()),
    };
    let webview = app.get_webview(&label).ok_or("browser tab not found")?;
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workbench_browser_close(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if !is_workbench_browser_label(&label) {
        return Err("invalid workbench browser label".to_string());
    }
    let webview = app.get_webview(&label).ok_or("browser tab not found")?;
    webview.close().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_loopback_cdp_hosts() {
        assert!(validate_cdp_bind_host("127.0.0.1").is_ok());
        assert!(validate_cdp_bind_host("localhost").is_err());
        assert!(validate_cdp_bind_host("0.0.0.0").is_err());
        assert!(validate_cdp_bind_host("192.168.1.10").is_err());
    }

    #[test]
    fn only_workbench_browser_labels_are_managed() {
        assert!(is_workbench_browser_label("workbench-browser-123"));
        assert!(!is_workbench_browser_label("main"));
        assert!(!is_workbench_browser_label("huddle-room"));
    }
}
