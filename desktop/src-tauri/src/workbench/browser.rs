use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, TcpListener};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewBuilder, WebviewUrl};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use super::profiles::{default_profile_root, profile_directory};

#[derive(Debug, Serialize)]
pub struct BrowserWebviewInfo {
    pub label: String,
    pub profile: String,
    pub url: String,
}

/// Rectangle (logical px, relative to the main window) owned by the
/// Browser pane placeholder in the React layout. Every workbench webview is
/// laid out here; only the active one is shown.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct BrowserViewport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

#[derive(Default)]
pub struct BrowserRegistry {
    ports: Mutex<HashMap<String, u16>>,
    viewport: Mutex<BrowserViewport>,
    active: Mutex<Option<String>>,
}

impl BrowserRegistry {
    pub fn reserve(&self, label: &str) -> Result<u16, String> {
        let listener = TcpListener::bind(SocketAddr::new(
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            0,
        ))
        .map_err(|error| format!("reserve CDP port: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("read reserved CDP port: {error}"))?
            .port();
        self.ports
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string(), port);
        Ok(port)
    }

    pub fn port_for(&self, label: &str) -> Option<u16> {
        self.ports.lock().ok()?.get(label).copied()
    }

    pub fn remove(&self, label: &str) {
        if let Ok(mut ports) = self.ports.lock() {
            ports.remove(label);
        }
        if let Ok(mut active) = self.active.lock() {
            if active.as_deref() == Some(label) {
                *active = None;
            }
        }
    }

    fn viewport(&self) -> BrowserViewport {
        self.viewport.lock().map(|v| *v).unwrap_or_default()
    }

    fn set_viewport(&self, viewport: BrowserViewport) {
        if let Ok(mut current) = self.viewport.lock() {
            *current = viewport;
        }
    }

    fn active(&self) -> Option<String> {
        self.active.lock().ok().and_then(|a| a.clone())
    }

    fn set_active(&self, label: Option<String>) {
        if let Ok(mut active) = self.active.lock() {
            *active = label;
        }
    }
}

/// Position the active workbench webview over the Browser pane placeholder
/// and hide every other one (or all of them when the pane is hidden).
fn apply_layout(app: &tauri::AppHandle, registry: &BrowserRegistry) -> Result<(), String> {
    let viewport = registry.viewport();
    let active = registry.active();
    let showable = viewport.visible && viewport.width >= 2.0 && viewport.height >= 2.0;
    for (label, webview) in app.webviews() {
        if !is_workbench_browser_label(&label) {
            continue;
        }
        if showable && active.as_deref() == Some(label.as_str()) {
            webview
                .set_position(LogicalPosition::new(
                    viewport.x.max(0.0),
                    viewport.y.max(0.0),
                ))
                .map_err(|error| error.to_string())?;
            webview
                .set_size(LogicalSize::new(viewport.width, viewport.height))
                .map_err(|error| error.to_string())?;
            webview.show().map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn workbench_browser_set_viewport(
    app: tauri::AppHandle,
    viewport: BrowserViewport,
    registry: State<'_, BrowserRegistry>,
) -> Result<(), String> {
    if !(viewport.x.is_finite()
        && viewport.y.is_finite()
        && viewport.width.is_finite()
        && viewport.height.is_finite())
    {
        return Err("browser viewport must be finite".to_string());
    }
    registry.set_viewport(viewport);
    apply_layout(&app, &registry)
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
    tab_id: Option<String>,
    registry: State<'_, BrowserRegistry>,
) -> Result<BrowserWebviewInfo, String> {
    open_browser_for_tab(&app, &registry, profile, url, tab_id).await
}

pub async fn open_browser(
    app: &tauri::AppHandle,
    registry: &BrowserRegistry,
    profile: String,
    url: String,
) -> Result<BrowserWebviewInfo, String> {
    open_browser_for_tab(app, registry, profile, url, None).await
}

async fn open_browser_for_tab(
    app: &tauri::AppHandle,
    registry: &BrowserRegistry,
    profile: String,
    url: String,
    tab_id: Option<String>,
) -> Result<BrowserWebviewInfo, String> {
    let parsed = validate_url(&url)?;
    validate_cdp_bind_host("127.0.0.1")?;
    let root = default_profile_root()?;
    let data_directory = profile_directory(&root, &profile)?;
    std::fs::create_dir_all(&data_directory).map_err(|error| error.to_string())?;
    let label = format!("workbench-browser-{}", Uuid::new_v4());
    let window = app.get_window("main").ok_or("main window unavailable")?;
    let viewport = registry.viewport();
    let (position, child_size) = if viewport.visible && viewport.width >= 2.0 {
        (
            LogicalPosition::new(viewport.x.max(0.0), viewport.y.max(0.0)),
            LogicalSize::new(viewport.width, viewport.height.max(1.0)),
        )
    } else {
        (LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0))
    };
    let port = registry.reserve(&label)?;
    let title_app = app.clone();
    let load_app = app.clone();
    let popup_app = app.clone();
    let popup_profile = profile.clone();
    let browser = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
        .data_directory(data_directory)
        .additional_browser_args(&format!(
            "--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"
        ))
        .on_document_title_changed(move |webview, title| {
            let _ = title_app.emit(
                "workbench-browser-state",
                json!({"label": webview.label(), "title": title}),
            );
        })
        .on_page_load(move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let _ = load_app.emit(
                "workbench-browser-state",
                json!({"label": webview.label(), "url": payload.url().to_string(), "loading": loading}),
            );
        })
        .on_new_window(move |url, _features| {
            // target=_blank / window.open land in a new workbench tab instead
            // of a detached native window.
            let _ = popup_app.emit(
                "workbench-browser-new-tab",
                json!({"url": url.to_string(), "profile": popup_profile}),
            );
            NewWindowResponse::Deny
        });
    if let Err(error) = window.add_child(browser, position, child_size) {
        registry.remove(&label);
        return Err(error.to_string());
    }
    registry.set_active(Some(label.clone()));
    let _ = apply_layout(app, registry);
    let _ = app.emit(
        "workbench-browser-opened",
        json!({"label": label, "profile": profile, "url": url, "tabId": tab_id}),
    );
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
    registry: State<'_, BrowserRegistry>,
) -> Result<(), String> {
    if let Some(target) = label.as_deref() {
        if !is_workbench_browser_label(target) {
            return Err("invalid workbench browser label".to_string());
        }
    }
    registry.set_active(label);
    apply_layout(&app, &registry)
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
    let result = webview.close().map_err(|error| error.to_string());
    if result.is_ok() {
        if let Some(registry) = app.try_state::<BrowserRegistry>() {
            registry.remove(&label);
        }
    }
    result
}

#[derive(Debug, Deserialize)]
struct CdpTarget {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    websocket_url: Option<String>,
}

async fn cdp_target(port: u16) -> Result<CdpTarget, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..20 {
        if let Ok(response) = client
            .get(format!("http://127.0.0.1:{port}/json/list"))
            .send()
            .await
        {
            if let Ok(targets) = response.json::<Vec<CdpTarget>>().await {
                if let Some(target) = targets
                    .into_iter()
                    .find(|target| target.kind == "page" && target.websocket_url.is_some())
                {
                    return Ok(target);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("browser CDP target unavailable".to_string())
}

pub async fn cdp_call(
    registry: &BrowserRegistry,
    label: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if !is_workbench_browser_label(label) {
        return Err("invalid workbench browser label".to_string());
    }
    let port = registry
        .port_for(label)
        .ok_or_else(|| "browser CDP session not found".to_string())?;
    let target = cdp_target(port).await?;
    let websocket_url = target
        .websocket_url
        .ok_or_else(|| "browser CDP websocket unavailable".to_string())?;
    let (mut socket, _) =
        tokio::time::timeout(Duration::from_secs(3), connect_async(websocket_url))
            .await
            .map_err(|_| "browser CDP connection timed out".to_string())?
            .map_err(|error| error.to_string())?;
    let request_id = 1_u64;
    socket
        .send(Message::Text(
            json!({"id": request_id, "method": method, "params": params})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|error| error.to_string())?;
    while let Some(message) = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .map_err(|_| "browser CDP command timed out".to_string())?
        .transpose()
        .map_err(|error| error.to_string())?
    {
        let Message::Text(text) = message else {
            continue;
        };
        let value: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
        if value.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(error.to_string());
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err("browser CDP closed before returning a result".to_string())
}

pub async fn cdp_read_text(registry: &BrowserRegistry, label: &str) -> Result<String, String> {
    let result = cdp_call(
        registry,
        label,
        "Runtime.evaluate",
        json!({"expression":"document.body ? document.body.innerText : ''","returnByValue":true}),
    )
    .await?;
    let text = result
        .pointer("/result/value")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(text.chars().take(256 * 1024).collect())
}

pub async fn cdp_screenshot(registry: &BrowserRegistry, label: &str) -> Result<String, String> {
    let result = cdp_call(
        registry,
        label,
        "Page.captureScreenshot",
        json!({"format":"png"}),
    )
    .await?;
    let data = result
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "browser screenshot returned no PNG".to_string())?;
    if data.len() > 8 * 1024 * 1024 {
        return Err("browser screenshot exceeds 8 MiB".to_string());
    }
    Ok(data.to_string())
}

pub async fn cdp_click(
    registry: &BrowserRegistry,
    label: &str,
    selector: Option<&str>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    match (selector, x, y) {
        (Some(selector), None, None) => {
            let selector = serde_json::to_string(selector).map_err(|error| error.to_string())?;
            let result = cdp_call(
                registry,
                label,
                "Runtime.evaluate",
                json!({"expression":format!("(()=>{{const e=document.querySelector({selector});if(!e)return {{ok:false,error:'not found'}};e.click();return {{ok:true}};}})()"),"returnByValue":true}),
            )
            .await?;
            if result.pointer("/result/value/ok").and_then(Value::as_bool) != Some(true) {
                return Err(result
                    .pointer("/result/value/error")
                    .and_then(Value::as_str)
                    .unwrap_or("browser selector click failed")
                    .to_string());
            }
            Ok(())
        }
        (None, Some(x), Some(y)) if x.is_finite() && y.is_finite() && x >= 0.0 && y >= 0.0 => {
            cdp_call(
                registry,
                label,
                "Input.dispatchMouseEvent",
                json!({"type":"mousePressed","x":x,"y":y,"button":"left","clickCount":1}),
            )
            .await?;
            cdp_call(
                registry,
                label,
                "Input.dispatchMouseEvent",
                json!({"type":"mouseReleased","x":x,"y":y,"button":"left","clickCount":1}),
            )
            .await?;
            Ok(())
        }
        _ => Err("browser_click requires selector or non-negative x/y".to_string()),
    }
}

pub async fn cdp_type(
    registry: &BrowserRegistry,
    label: &str,
    selector: &str,
    text: &str,
) -> Result<(), String> {
    if text.len() > 64 * 1024 {
        return Err("browser_type text exceeds 64 KiB".to_string());
    }
    let selector_json = serde_json::to_string(selector).map_err(|error| error.to_string())?;
    let result = cdp_call(
        registry,
        label,
        "Runtime.evaluate",
        json!({"expression":format!("(()=>{{const e=document.querySelector({selector_json});if(!e)return {{ok:false,error:'not found'}};e.focus();return {{ok:true}};}})()"),"returnByValue":true}),
    )
    .await?;
    if result.pointer("/result/value/ok").and_then(Value::as_bool) != Some(true) {
        return Err("browser_type selector not found".to_string());
    }
    cdp_call(registry, label, "Input.insertText", json!({"text":text})).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_registry_assigns_loopback_ports_per_tab() {
        let registry = BrowserRegistry::default();
        let first = registry.reserve("workbench-browser-a").unwrap();
        let second = registry.reserve("workbench-browser-b").unwrap();
        assert_ne!(first, second);
        assert!(registry.port_for("workbench-browser-a").is_some());
        assert!(registry.port_for("workbench-browser-b").is_some());
        registry.remove("workbench-browser-a");
        assert!(registry.port_for("workbench-browser-a").is_none());
    }

    #[tokio::test]
    async fn browser_click_rejects_unbounded_input_before_connecting() {
        let registry = BrowserRegistry::default();
        let result = cdp_click(
            &registry,
            "workbench-browser-a",
            None,
            Some(-1.0),
            Some(2.0),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn browser_type_rejects_oversized_text_before_connecting() {
        let registry = BrowserRegistry::default();
        let result = cdp_type(
            &registry,
            "workbench-browser-a",
            "input",
            &"x".repeat(64 * 1024 + 1),
        )
        .await;
        assert!(result.is_err());
    }

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
