use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::{browser, files};

#[derive(Debug, Deserialize)]
pub struct ToolCall {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}
#[derive(Debug, Serialize)]
pub struct ToolResult {
    pub content: Vec<serde_json::Value>,
    pub is_error: bool,
}

#[derive(Clone, Default)]
pub struct McpBridge {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>,
}

impl McpBridge {
    pub fn register(&self, request_id: &str) -> oneshot::Receiver<serde_json::Value> {
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(request_id.to_string(), sender);
        }
        receiver
    }

    pub fn resolve(&self, payload: serde_json::Value) {
        let Some(request_id) = payload.get("requestId").and_then(|value| value.as_str()) else {
            return;
        };
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(sender) = pending.remove(request_id) {
                let _ = sender.send(payload);
            }
        }
    }
}

async fn wait_bridge(
    receiver: oneshot::Receiver<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    tokio::time::timeout(std::time::Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "workbench bridge timed out".to_string())?
        .map_err(|_| "workbench bridge closed".to_string())
}
fn text(value: impl Into<String>) -> ToolResult {
    ToolResult {
        content: vec![serde_json::json!({"type":"text","text":value.into()})],
        is_error: false,
    }
}
fn error(value: impl Into<String>) -> ToolResult {
    ToolResult {
        content: vec![serde_json::json!({"type":"text","text":value.into()})],
        is_error: true,
    }
}

pub const TOOL_NAMES: [&str; 12] = [
    "browser_open",
    "browser_navigate",
    "browser_read_text",
    "browser_screenshot",
    "browser_click",
    "browser_type",
    "browser_tabs",
    "terminal_run",
    "terminal_read",
    "terminal_stop",
    "files_reveal",
    "files_preview",
];

pub async fn call(app: &AppHandle, call: ToolCall) -> ToolResult {
    let _ = app.emit(
        "workbench-agent-activity",
        serde_json::json!({"tool": call.name}),
    );
    match call.name.as_str() {
        "browser_open" => {
            let profile = call
                .arguments
                .get("profile")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();
            let url = call
                .arguments
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://example.com")
                .to_string();
            let registry = app.state::<browser::BrowserRegistry>();
            match browser::open_browser(app, &registry, profile, url).await {
                Ok(info) => ToolResult {
                    content: vec![serde_json::to_value(info).unwrap_or_default()],
                    is_error: false,
                },
                Err(e) => error(e),
            }
        }
        "browser_navigate" => {
            let label = call
                .arguments
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let url = call
                .arguments
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if label.is_empty() {
                let registry = app.state::<browser::BrowserRegistry>();
                match browser::open_browser(app, &registry, "default".to_string(), url).await {
                    Ok(info) => ToolResult {
                        content: vec![serde_json::to_value(info).unwrap_or_default()],
                        is_error: false,
                    },
                    Err(e) => error(e),
                }
            } else {
                match browser::workbench_browser_navigate(app.clone(), label, url).await {
                    Ok(()) => text("browser navigated"),
                    Err(e) => error(e),
                }
            }
        }
        "browser_tabs" => {
            let registry = app.state::<browser::BrowserRegistry>();
            let tabs: Vec<_> = app
                .webviews()
                .into_iter()
                .filter(|(label, _)| label.starts_with("workbench-browser-"))
                .map(|(label, view)| {
                    serde_json::json!({
                        "label":label,
                        "url":view.url().ok().map(|u|u.to_string()),
                        "cdpRegistered":registry.port_for(&label).is_some()
                    })
                })
                .collect();
            ToolResult {
                content: vec![serde_json::json!({"type":"json","json":tabs})],
                is_error: false,
            }
        }
        "browser_read_text" => {
            let label = call
                .arguments
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            match browser::cdp_read_text(&app.state::<browser::BrowserRegistry>(), label).await {
                Ok(value) => text(value),
                Err(e) => error(e),
            }
        }
        "browser_screenshot" => {
            let label = call
                .arguments
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            match browser::cdp_screenshot(&app.state::<browser::BrowserRegistry>(), label).await {
                Ok(data) => ToolResult {
                    content: vec![
                        serde_json::json!({"type":"image","mimeType":"image/png","data":data}),
                    ],
                    is_error: false,
                },
                Err(e) => error(e),
            }
        }
        "browser_click" => {
            let label = call
                .arguments
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let selector = call.arguments.get("selector").and_then(|v| v.as_str());
            let x = call.arguments.get("x").and_then(|v| v.as_f64());
            let y = call.arguments.get("y").and_then(|v| v.as_f64());
            match browser::cdp_click(
                &app.state::<browser::BrowserRegistry>(),
                label,
                selector,
                x,
                y,
            )
            .await
            {
                Ok(()) => text("browser clicked"),
                Err(e) => error(e),
            }
        }
        "browser_type" => {
            let label = call
                .arguments
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let selector = call
                .arguments
                .get("selector")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let value = call
                .arguments
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            match browser::cdp_type(
                &app.state::<browser::BrowserRegistry>(),
                label,
                selector,
                value,
            )
            .await
            {
                Ok(()) => text("browser typed"),
                Err(e) => error(e),
            }
        }
        "terminal_run" => {
            let command = call
                .arguments
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let request_id = uuid::Uuid::new_v4().to_string();
            let receiver = app.state::<McpBridge>().register(&request_id);
            let _ = app.emit(
                "workbench-mcp-terminal-run",
                serde_json::json!({"requestId":request_id,"command":command}),
            );
            match wait_bridge(receiver).await {
                Ok(value) if value.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                    ToolResult {
                        content: vec![serde_json::json!({"type":"json","json":value})],
                        is_error: false,
                    }
                }
                Ok(value) => error(
                    value
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("terminal run failed"),
                ),
                Err(e) => error(e),
            }
        }
        "terminal_read" | "terminal_stop" => {
            let session_id = call
                .arguments
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if session_id.is_empty() {
                return error("sessionId is required");
            }
            let request_id = uuid::Uuid::new_v4().to_string();
            let receiver = app.state::<McpBridge>().register(&request_id);
            let event = if call.name == "terminal_read" {
                "workbench-mcp-terminal-read"
            } else {
                "workbench-mcp-terminal-stop"
            };
            let _ = app.emit(
                event,
                serde_json::json!({"requestId":request_id,"sessionId":session_id}),
            );
            match wait_bridge(receiver).await {
                Ok(value) if value.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                    ToolResult {
                        content: vec![serde_json::json!({"type":"json","json":value})],
                        is_error: false,
                    }
                }
                Ok(value) => error(
                    value
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("terminal operation failed"),
                ),
                Err(e) => error(e),
            }
        }
        "files_preview" => {
            let path = call
                .arguments
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            match files::workbench_files_preview(path) {
                Ok(value) => ToolResult {
                    content: vec![serde_json::to_value(value).unwrap_or_default()],
                    is_error: false,
                },
                Err(e) => error(e),
            }
        }
        "files_reveal" => {
            let path = call
                .arguments
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            match files::workbench_files_reveal(app.clone(), path) {
                Ok(()) => text("file revealed"),
                Err(e) => error(e),
            }
        }
        _ => error("unknown MCP tool"),
    }
}
