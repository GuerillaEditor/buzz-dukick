//! Dukick "Apps" hub: launchers for third-party tools (websites opened in the
//! workbench browser) plus their MCP servers / skills, which can be switched
//! on for every Buzz agent (Claude Code `CLAUDE_CONFIG_DIR`s and Codex
//! `CODEX_HOME`s) in one click.

mod discover;
mod presets;
mod sync;
mod types;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use types::{
    slug, AgentTarget, AppEntry, AppView, AppsFile, AppsSnapshot, McpServerSpec, McpServerView,
    SkillRef,
};

static STORE_LOCK: Mutex<()> = Mutex::new(());

fn store_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("local app data directory unavailable")?;
    Ok(base.join("BuzzDukick").join("apps").join("apps.json"))
}

fn load_store() -> AppsFile {
    store_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_store(file: &AppsFile) -> Result<(), String> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn buzz_data_dirs() -> Vec<PathBuf> {
    dirs::data_dir()
        .map(|d| vec![d.join("xyz.block.buzz.app"), d.join("xyz.dukick.buzz.app")])
        .unwrap_or_default()
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "home directory unavailable".to_string())
}

/// Full catalog: custom apps, presets, then everything discovered.
fn catalog(store: &AppsFile) -> Result<(Vec<AppEntry>, Vec<AgentTarget>), String> {
    let home = home()?;
    let targets = discover::discover_targets(&home, &buzz_data_dirs());
    let mut base = store.custom.clone();
    base.extend(presets::presets());
    Ok((discover::discover_apps(&home, &targets, base), targets))
}

fn view(
    app: &AppEntry,
    store: &AppsFile,
    targets: &[AgentTarget],
    servers: &[BTreeSet<String>],
) -> AppView {
    AppView {
        id: app.id.clone(),
        name: app.name.clone(),
        description: app.description.clone(),
        icon: app.icon.clone(),
        web_url: app.web_url.clone(),
        browser_profile: app
            .browser_profile
            .clone()
            .unwrap_or_else(|| app.id.clone()),
        mcp: app
            .mcp
            .iter()
            .map(|s| McpServerView {
                name: s.name.clone(),
                transport: if s.is_http() { "http" } else { "stdio" },
                endpoint: s.url.clone().unwrap_or_else(|| {
                    let mut parts = vec![s.command.clone().unwrap_or_default()];
                    parts.extend(s.args.iter().cloned());
                    parts.join(" ")
                }),
                has_secrets: !s.headers.is_empty() || !s.env.is_empty(),
            })
            .collect(),
        skills: app.skills.clone(),
        sources: app.sources.clone(),
        added: store.added.contains(&app.id) || store.custom.iter().any(|c| c.id == app.id),
        custom: store.custom.iter().any(|c| c.id == app.id),
        enabled_targets: targets
            .iter()
            .zip(servers)
            .filter(|(t, s)| sync::app_enabled(app, t, s))
            .map(|(t, _)| t.id.clone())
            .collect(),
    }
}

fn snapshot(store: &AppsFile) -> Result<AppsSnapshot, String> {
    let (apps, targets) = catalog(store)?;
    let servers: Vec<BTreeSet<String>> = targets.iter().map(sync::configured_servers).collect();
    Ok(AppsSnapshot {
        apps: apps
            .iter()
            .map(|a| view(a, store, &targets, &servers))
            .collect(),
        targets,
    })
}

#[tauri::command]
pub async fn apps_list() -> Result<AppsSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        snapshot(&load_store())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn apps_set_added(app_id: String, added: bool) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut store = load_store();
    store.added.retain(|id| id != &app_id);
    if added {
        store.added.push(app_id);
    }
    save_store(&store)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAppInput {
    pub name: String,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub mcp_url: Option<String>,
    #[serde(default)]
    pub mcp_command: Option<String>,
    #[serde(default)]
    pub mcp_args: Vec<String>,
    #[serde(default)]
    pub skill_dir: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[tauri::command]
pub async fn apps_add_custom(input: CustomAppInput) -> Result<String, String> {
    let id = slug(&input.name);
    if id.is_empty() {
        return Err("Tên app không hợp lệ".into());
    }
    let web_url = non_empty(input.web_url);
    if let Some(url) = &web_url {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Website phải bắt đầu bằng http:// hoặc https://".into());
        }
    }
    let mut mcp = Vec::new();
    if let Some(url) = non_empty(input.mcp_url) {
        mcp.push(McpServerSpec {
            name: id.clone(),
            url: Some(url),
            ..Default::default()
        });
    } else if let Some(command) = non_empty(input.mcp_command) {
        mcp.push(McpServerSpec {
            name: id.clone(),
            command: Some(command),
            args: input
                .mcp_args
                .into_iter()
                .filter(|a| !a.trim().is_empty())
                .collect(),
            ..Default::default()
        });
    }
    let mut skills = Vec::new();
    if let Some(dir) = non_empty(input.skill_dir) {
        let path = PathBuf::from(&dir);
        if !path.join("SKILL.md").is_file() {
            return Err(format!("Không thấy SKILL.md trong {dir}"));
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| id.clone());
        skills.push(SkillRef { name, path: dir });
    }
    if web_url.is_none() && mcp.is_empty() && skills.is_empty() {
        return Err("Cần ít nhất một website, MCP hoặc thư mục skill".into());
    }
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut store = load_store();
    store.custom.retain(|c| c.id != id);
    store.custom.push(AppEntry {
        id: id.clone(),
        name: input.name.trim().to_string(),
        description: "Custom".into(),
        web_url,
        browser_profile: Some(id.clone()),
        mcp,
        skills,
        sources: vec!["custom".into()],
        ..Default::default()
    });
    if !store.added.contains(&id) {
        store.added.push(id.clone());
    }
    save_store(&store)?;
    Ok(id)
}

#[tauri::command]
pub async fn apps_remove_custom(app_id: String) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut store = load_store();
    store.custom.retain(|c| c.id != app_id);
    store.added.retain(|id| id != &app_id);
    save_store(&store)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSyncResult {
    pub target_id: String,
    pub label: String,
    #[serde(flatten)]
    pub report: sync::SyncReport,
    pub error: Option<String>,
}

/// Fill in values only known at write time (the workbench MCP token).
fn resolve_spec(spec: &McpServerSpec) -> McpServerSpec {
    let mut spec = spec.clone();
    if spec.name == presets::WORKBENCH_APP_ID && !spec.headers.contains_key("Authorization") {
        if let Ok(token) = crate::workbench::workbench_mcp_token() {
            spec.headers
                .insert("Authorization".into(), format!("Bearer {token}"));
        }
    }
    spec
}

#[tauri::command]
pub async fn apps_set_agent_use(
    app_id: String,
    target_ids: Vec<String>,
    enabled: bool,
) -> Result<Vec<TargetSyncResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut store = load_store();
        let (apps, targets) = catalog(&store)?;
        let app = apps
            .into_iter()
            .find(|a| a.id == app_id)
            .ok_or_else(|| format!("unknown app {app_id}"))?;
        let mut results = Vec::new();
        for target in targets.iter().filter(|t| target_ids.contains(&t.id)) {
            let managed = store.managed.entry(target.id.clone()).or_default();
            let outcome = if enabled {
                sync::enable(&app, target, managed, &resolve_spec)
            } else {
                sync::disable(&app, target, managed)
            };
            let (report, error) = match outcome {
                Ok(report) => (report, None),
                Err(error) => (sync::SyncReport::default(), Some(error)),
            };
            results.push(TargetSyncResult {
                target_id: target.id.clone(),
                label: target.label.clone(),
                report,
                error,
            });
        }
        if enabled && !store.added.contains(&app_id) {
            store.added.push(app_id.clone());
        }
        save_store(&store)?;
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop running Claude/Codex ACP adapters so the next message starts a fresh
/// session that reads the updated MCP / skill configuration. Buzz harnesses
/// respawn them on demand.
#[tauri::command]
pub async fn apps_restart_agents() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let script = "$n = 0; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'claude-agent-acp|codex-acp' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; $n";
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&output.stdout).trim().parse().unwrap_or(0))
        }
        #[cfg(not(windows))]
        {
            let status = std::process::Command::new("pkill")
                .args(["-f", "claude-agent-acp|codex-acp"])
                .status()
                .map_err(|e| e.to_string())?;
            Ok(u32::from(status.success()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
