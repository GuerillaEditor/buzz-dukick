use axum::{
    http::{HeaderMap, Request, StatusCode},
    middleware, Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ServerCapabilities, ServerConfig},
    tool, tool_handler, tool_router, ServerHandler,
};
use schemars::JsonSchema;
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tauri::{AppHandle, Emitter, Listener, Manager};

use super::mcp_auth::{configured_port, is_loopback, load_or_create_token, token_matches};
use super::mcp_tools::{self, ToolCall};

#[derive(Clone)]
struct McpHandler {
    app: AppHandle,
    tool_router: ToolRouter<McpHandler>,
}
#[derive(Debug, serde::Deserialize, JsonSchema)]
struct AnyParams {
    #[serde(flatten)]
    values: std::collections::HashMap<String, Value>,
}

#[tool_router]
impl McpHandler {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            tool_router: Self::tool_router(),
        }
    }
    async fn queued(
        &self,
        name: &str,
        Parameters(params): Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let _ = self
            .app
            .emit("workbench-agent-activity", json!({"tool":name}));
        let arguments = Value::Object(params.values.into_iter().collect());
        let result = mcp_tools::call(
            &self.app,
            ToolCall {
                name: name.to_string(),
                arguments,
            },
        )
        .await;
        let payload = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
        Ok(CallToolResult::success(vec![
            rmcp::model::ContentBlock::text(payload),
        ]))
    }
    #[tool(
        name = "browser_open",
        description = "Open an isolated native browser tab"
    )]
    async fn browser_open(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_open", p).await
    }
    #[tool(
        name = "browser_navigate",
        description = "Navigate a native browser tab"
    )]
    async fn browser_navigate(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_navigate", p).await
    }
    #[tool(name = "browser_read_text", description = "Read visible browser text")]
    async fn browser_read_text(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_read_text", p).await
    }
    #[tool(
        name = "browser_screenshot",
        description = "Capture visible browser tab"
    )]
    async fn browser_screenshot(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_screenshot", p).await
    }
    #[tool(name = "browser_click", description = "Click visible browser tab")]
    async fn browser_click(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_click", p).await
    }
    #[tool(name = "browser_type", description = "Type into visible browser tab")]
    async fn browser_type(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_type", p).await
    }
    #[tool(name = "browser_tabs", description = "List native browser tabs")]
    async fn browser_tabs(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("browser_tabs", p).await
    }
    #[tool(
        name = "terminal_run",
        description = "Run a command in a new terminal tab"
    )]
    async fn terminal_run(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("terminal_run", p).await
    }
    #[tool(name = "terminal_read", description = "Read terminal output")]
    async fn terminal_read(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("terminal_read", p).await
    }
    #[tool(name = "terminal_stop", description = "Stop a terminal session")]
    async fn terminal_stop(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("terminal_stop", p).await
    }
    #[tool(name = "files_reveal", description = "Reveal an allowed file")]
    async fn files_reveal(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("files_reveal", p).await
    }
    #[tool(name = "files_preview", description = "Preview an allowed file")]
    async fn files_preview(
        &self,
        p: Parameters<AnyParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.queued("files_preview", p).await
    }
}
#[tool_handler(router = self.tool_router)]
impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }
}

pub fn start(app: AppHandle) {
    let port = configured_port();
    let token = match load_or_create_token() {
        Ok(token) => token,
        Err(_) => return,
    };
    let token = Arc::new(token);
    let app_for_service = app.clone();
    let bridge = app.state::<super::mcp_tools::McpBridge>().inner().clone();
    app.listen("workbench-mcp-result", move |event| {
        if let Ok(payload) = serde_json::from_str::<Value>(event.payload()) {
            bridge.resolve(payload);
        }
    });
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        if !is_loopback(addr.ip()) {
            return;
        }
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => listener,
            Err(_) => return,
        };
        let service = StreamableHttpService::new(
            move || Ok(McpHandler::new(app_for_service.clone())),
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default(),
        );
        let token_for_middleware = token.clone();
        let auth = middleware::from_fn(
            move |headers: HeaderMap,
                  request: Request<axum::body::Body>,
                  next: middleware::Next| {
                let token = token_for_middleware.clone();
                async move {
                    let supplied = headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.strip_prefix("Bearer "))
                        .or_else(|| {
                            headers
                                .get("x-buzz-dukick-token")
                                .and_then(|v| v.to_str().ok())
                        });
                    if !token_matches(&token, supplied) {
                        return axum::response::Response::builder()
                            .status(StatusCode::UNAUTHORIZED)
                            .body(axum::body::Body::from("unauthorized"))
                            .unwrap();
                    }
                    next.run(request).await
                }
            },
        );
        let router = Router::new().nest_service("/mcp", service).layer(auth);
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
