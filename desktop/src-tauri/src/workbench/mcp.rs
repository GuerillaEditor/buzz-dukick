use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tauri::AppHandle;

use super::mcp_auth::{configured_port, is_loopback, load_or_create_token, token_matches};
use super::mcp_tools::{self, ToolCall};

#[derive(Clone)]
struct ServerState {
    app: AppHandle,
    token: Arc<String>,
}

async fn rpc(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get("x-buzz-dukick-token")
                .and_then(|v| v.to_str().ok())
        });
    if !token_matches(&state.token, supplied) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"jsonrpc":"2.0","error":{"code":-32001,"message":"unauthorized"}})),
        );
    }
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"buzz-dukick-workbench","version":env!("CARGO_PKG_VERSION")}})
        }
        "notifications/initialized" => json!(null),
        "tools/list" => {
            json!({"tools": mcp_tools::TOOL_NAMES.iter().map(|name| json!({"name":name,"description":"Buzz Dukick Workbench tool","inputSchema":{"type":"object"}})).collect::<Vec<_>>() })
        }
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_default();
            let call: ToolCall = serde_json::from_value(json!({"name":params.get("name").cloned().unwrap_or_default(),"arguments":params.get("arguments").cloned().unwrap_or(json!({}))})).unwrap_or(ToolCall{name:String::new(),arguments:json!({})});
            let value = mcp_tools::call(&state.app, call).await;
            serde_json::to_value(value).unwrap_or_else(|_| json!({"is_error":true}))
        }
        _ => {
            return (
                StatusCode::OK,
                Json(
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"method not found"}}),
                ),
            )
        }
    };
    (
        StatusCode::OK,
        Json(json!({"jsonrpc":"2.0","id":id,"result":result})),
    )
}

pub fn start(app: AppHandle) {
    let port = configured_port();
    let token = match load_or_create_token() {
        Ok(token) => token,
        Err(_) => return,
    };
    let state = ServerState {
        app,
        token: Arc::new(token),
    };
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        if !is_loopback(addr.ip()) {
            return;
        }
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => listener,
            Err(_) => return,
        };
        let router = Router::new().route("/mcp", post(rpc)).with_state(state);
        let _ = axum::serve(listener, router).await;
    });
}

#[cfg(test)]
mod tests {
    use super::super::mcp_auth::{is_loopback, token_matches};
    #[test]
    fn mcp_server_policy_is_loopback_only() {
        assert!(is_loopback("127.0.0.1".parse().unwrap()));
    }
    #[test]
    fn auth_rejects_missing_and_wrong_tokens() {
        assert!(!token_matches("secret", None));
        assert!(!token_matches("secret", Some("wrong")));
        assert!(token_matches("secret", Some("secret")));
    }
}
