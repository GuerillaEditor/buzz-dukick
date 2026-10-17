mod browser;
mod files;
mod mcp;
mod mcp_auth;
mod mcp_tools;
mod path_guard;
mod profiles;

pub use mcp::start as start_mcp;
pub use mcp_tools::McpBridge;

pub use browser::{
    workbench_browser_activate, workbench_browser_close, workbench_browser_history,
    workbench_browser_navigate, workbench_browser_open, workbench_browser_reload,
    workbench_browser_set_viewport, BrowserRegistry,
};
pub use files::{
    workbench_files_list, workbench_files_open, workbench_files_preview, workbench_files_read, workbench_files_reveal,
    workbench_files_roots,
};
