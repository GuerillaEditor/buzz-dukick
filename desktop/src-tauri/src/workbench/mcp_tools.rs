use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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
            match browser::workbench_browser_navigate(app.clone(), label, url).await {
                Ok(()) => text("browser navigated"),
                Err(e) => error(e),
            }
        }
        "browser_tabs" => {
            let tabs: Vec<_> = app.webviews().into_iter().filter(|(label, _)| label.starts_with("workbench-browser-")).map(|(label, view)| serde_json::json!({"label":label,"url":view.url().ok().map(|u|u.to_string())})).collect();
            ToolResult {
                content: vec![serde_json::json!({"type":"json","json":tabs})],
                is_error: false,
            }
        }
        "browser_open" | "browser_read_text" | "browser_screenshot" | "browser_click"
        | "browser_type" => {
            let _ = app.emit(
                "workbench-mcp-browser-command",
                serde_json::json!({"action": call.name, "arguments": call.arguments}),
            );
            error("browser action queued to the visible native tab; result bridge is not available yet")
        }
        "terminal_run" => {
            let command = call
                .arguments
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let request_id = uuid::Uuid::new_v4().to_string();
            let _ = app.emit(
                "workbench-mcp-terminal-run",
                serde_json::json!({"requestId":request_id,"command":command}),
            );
            text(format!("terminal request queued: {request_id}"))
        }
        "terminal_read" | "terminal_stop" => {
            error("terminal output is owned by the visible terminal tab")
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
