//! Write an app's MCP servers and skills into an agent config home
//! (`.claude.json` / Codex `config.toml` / `skills/`).
//!
//! Only entries Buzz itself added are ever removed; servers or skills the
//! user configured by hand are reported as already present and left alone.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::types::{AgentTarget, AppEntry, ManagedItems, McpServerSpec, TargetKind};

static BACKED_UP: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// One rolling `<file>.bak-apps` copy per file per app run.
fn backup_once(path: &Path) -> Result<(), String> {
    let mut done = BACKED_UP.lock().map_err(|e| e.to_string())?;
    if done.iter().any(|p| p == path) || !path.is_file() {
        return Ok(());
    }
    let mut backup = path.as_os_str().to_owned();
    backup.push(".bak-apps");
    std::fs::copy(path, PathBuf::from(backup))
        .map_err(|e| format!("backup {}: {e}", path.display()))?;
    done.push(path.to_path_buf());
    Ok(())
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    backup_once(path)?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp-apps");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, contents).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("replace {}: {e}", path.display()))
}

fn claude_json(spec: &McpServerSpec) -> serde_json::Value {
    if let Some(url) = &spec.url {
        let mut obj = serde_json::json!({"type": "http", "url": url});
        if !spec.headers.is_empty() {
            obj["headers"] = serde_json::to_value(&spec.headers).unwrap_or_default();
        }
        obj
    } else {
        serde_json::json!({
            "type": "stdio",
            "command": spec.command.clone().unwrap_or_default(),
            "args": spec.args,
            "env": spec.env,
        })
    }
}

fn codex_table(spec: &McpServerSpec) -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    if let Some(url) = &spec.url {
        table["url"] = toml_edit::value(url.as_str());
        if !spec.headers.is_empty() {
            let mut headers = toml_edit::InlineTable::new();
            for (k, v) in &spec.headers {
                headers.insert(k, v.as_str().into());
            }
            table["http_headers"] = toml_edit::value(headers);
        }
    } else {
        table["command"] = toml_edit::value(spec.command.clone().unwrap_or_default());
        let mut args = toml_edit::Array::new();
        for arg in &spec.args {
            args.push(arg.as_str());
        }
        table["args"] = toml_edit::value(args);
        if !spec.env.is_empty() {
            let mut env = toml_edit::InlineTable::new();
            for (k, v) in &spec.env {
                env.insert(k, v.as_str().into());
            }
            table["env"] = toml_edit::value(env);
        }
    }
    table
}

/// MCP server names currently configured in a target.
pub fn configured_servers(target: &AgentTarget) -> BTreeSet<String> {
    let path = Path::new(&target.config_file);
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeSet::new();
    };
    match target.kind {
        TargetKind::Claude => serde_json::from_str::<serde_json::Value>(&raw)
            .ok()
            .and_then(|v| {
                v.get("mcpServers")
                    .and_then(|s| s.as_object())
                    .map(|o| o.keys().cloned().collect())
            })
            .unwrap_or_default(),
        TargetKind::Codex => raw
            .parse::<toml_edit::DocumentMut>()
            .ok()
            .and_then(|doc| {
                doc.get("mcp_servers")
                    .and_then(|v| v.as_table_like())
                    .map(|t| t.iter().map(|(k, _)| k.to_string()).collect())
            })
            .unwrap_or_default(),
    }
}

fn skill_link(target: &AgentTarget, skill_name: &str) -> PathBuf {
    Path::new(&target.skills_dir).join(skill_name)
}

/// True when every MCP server and skill of `app` is present in `target`.
pub fn app_enabled(app: &AppEntry, target: &AgentTarget, servers: &BTreeSet<String>) -> bool {
    if app.mcp.is_empty() && app.skills.is_empty() {
        return false;
    }
    app.mcp.iter().all(|s| servers.contains(&s.name))
        && app
            .skills
            .iter()
            .all(|s| skill_link(target, &s.name).exists())
}

fn is_reparse_point(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        std::fs::symlink_metadata(path)
            .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }
}

fn link_dir(link: &Path, source: &Path) -> Result<(), String> {
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        // Directory junctions need no admin / developer mode.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(source)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("mklink /J failed for {}", link.display()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(source, link).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub added: Vec<String>,
    pub already_present: Vec<String>,
    pub removed: Vec<String>,
}

/// Add the app's MCP servers + skill links to `target`.
/// `resolve` fills runtime values (e.g. the workbench token) just before write.
pub fn enable(
    app: &AppEntry,
    target: &AgentTarget,
    managed: &mut ManagedItems,
    resolve: &dyn Fn(&McpServerSpec) -> McpServerSpec,
) -> Result<SyncReport, String> {
    let mut report = SyncReport::default();
    let path = Path::new(&target.config_file);
    if !app.mcp.is_empty() {
        match target.kind {
            TargetKind::Claude => {
                let mut doc: serde_json::Value = match std::fs::read_to_string(path) {
                    Ok(raw) => serde_json::from_str(&raw)
                        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?,
                    Err(_) => serde_json::json!({}),
                };
                if !doc.is_object() {
                    return Err(format!("{} is not a JSON object", path.display()));
                }
                let servers = doc
                    .as_object_mut()
                    .expect("checked object")
                    .entry("mcpServers")
                    .or_insert_with(|| serde_json::json!({}));
                let servers = servers
                    .as_object_mut()
                    .ok_or("mcpServers is not an object")?;
                let mut changed = false;
                for spec in &app.mcp {
                    if servers.contains_key(&spec.name) {
                        report.already_present.push(spec.name.clone());
                        continue;
                    }
                    servers.insert(spec.name.clone(), claude_json(&resolve(spec)));
                    managed.mcp.push(spec.name.clone());
                    report.added.push(spec.name.clone());
                    changed = true;
                }
                if changed {
                    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
                    write_atomic(path, &text)?;
                }
            }
            TargetKind::Codex => {
                let raw = std::fs::read_to_string(path).unwrap_or_default();
                let mut doc = raw
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|e| format!("{} is not valid TOML: {e}", path.display()))?;
                if !doc.contains_key("mcp_servers") {
                    let mut parent = toml_edit::Table::new();
                    parent.set_implicit(true);
                    doc["mcp_servers"] = toml_edit::Item::Table(parent);
                }
                let servers = doc["mcp_servers"]
                    .as_table_mut()
                    .ok_or("mcp_servers is not a table")?;
                let mut changed = false;
                for spec in &app.mcp {
                    if servers.contains_key(&spec.name) {
                        report.already_present.push(spec.name.clone());
                        continue;
                    }
                    servers.insert(
                        &spec.name,
                        toml_edit::Item::Table(codex_table(&resolve(spec))),
                    );
                    managed.mcp.push(spec.name.clone());
                    report.added.push(spec.name.clone());
                    changed = true;
                }
                if changed {
                    write_atomic(path, &doc.to_string())?;
                }
            }
        }
    }
    for skill in &app.skills {
        let link = skill_link(target, &skill.name);
        if link.exists() || is_reparse_point(&link) {
            report.already_present.push(format!("skill:{}", skill.name));
            continue;
        }
        link_dir(&link, Path::new(&skill.path))?;
        managed.skills.push(link.to_string_lossy().into_owned());
        report.added.push(format!("skill:{}", skill.name));
    }
    Ok(report)
}

/// Remove what Buzz added for this app from `target`.
pub fn disable(
    app: &AppEntry,
    target: &AgentTarget,
    managed: &mut ManagedItems,
) -> Result<SyncReport, String> {
    let mut report = SyncReport::default();
    let path = Path::new(&target.config_file);
    let ours: Vec<String> = app
        .mcp
        .iter()
        .map(|s| s.name.clone())
        .filter(|n| managed.mcp.contains(n))
        .collect();
    if !ours.is_empty() && path.is_file() {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        match target.kind {
            TargetKind::Claude => {
                let mut doc: serde_json::Value =
                    serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                if let Some(servers) = doc.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                    for name in &ours {
                        if servers.remove(name).is_some() {
                            report.removed.push(name.clone());
                        }
                    }
                }
                write_atomic(
                    path,
                    &serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?,
                )?;
            }
            TargetKind::Codex => {
                let mut doc = raw
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|e| e.to_string())?;
                if let Some(servers) = doc.get_mut("mcp_servers").and_then(|v| v.as_table_mut()) {
                    for name in &ours {
                        if servers.remove(name).is_some() {
                            report.removed.push(name.clone());
                        }
                    }
                }
                write_atomic(path, &doc.to_string())?;
            }
        }
    }
    managed.mcp.retain(|n| !ours.contains(n));
    for skill in &app.skills {
        let link = skill_link(target, &skill.name);
        let key = link.to_string_lossy().into_owned();
        if !managed.skills.contains(&key) {
            continue;
        }
        // Only a junction/symlink Buzz created is removed — never a real folder.
        if is_reparse_point(&link) {
            std::fs::remove_dir(&link).map_err(|e| format!("unlink {}: {e}", link.display()))?;
            report.removed.push(format!("skill:{}", skill.name));
        }
        managed.skills.retain(|s| s != &key);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apps::types::SkillRef;
    use std::fs;

    fn target(kind: TargetKind, dir: &Path, file: &str) -> AgentTarget {
        AgentTarget {
            id: "t".into(),
            kind,
            label: "t".into(),
            dir: dir.to_string_lossy().into_owned(),
            config_file: dir.join(file).to_string_lossy().into_owned(),
            skills_dir: dir.join("skills").to_string_lossy().into_owned(),
            in_use: true,
        }
    }

    fn app() -> AppEntry {
        AppEntry {
            id: "miro".into(),
            name: "Miro".into(),
            mcp: vec![
                McpServerSpec {
                    name: "miro".into(),
                    url: Some("https://mcp.miro.com/".into()),
                    ..Default::default()
                },
                McpServerSpec {
                    name: "keep".into(),
                    url: Some("https://other/".into()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn claude_enable_disable_keeps_user_entries() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".claude.json"),
            r#"{"numStartups":3,"mcpServers":{"keep":{"type":"http","url":"https://mine/"}}}"#,
        )
        .unwrap();
        let t = target(TargetKind::Claude, dir.path(), ".claude.json");
        let mut managed = ManagedItems::default();
        let report = enable(&app(), &t, &mut managed, &|s| s.clone()).unwrap();
        assert_eq!(report.added, vec!["miro"]);
        assert_eq!(report.already_present, vec!["keep"]);
        let servers = configured_servers(&t);
        assert!(servers.contains("miro") && servers.contains("keep"));
        assert!(app_enabled(&app(), &t, &servers));

        let report = disable(&app(), &t, &mut managed).unwrap();
        assert_eq!(report.removed, vec!["miro"]);
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(".claude.json")).unwrap())
                .unwrap();
        assert_eq!(doc["numStartups"], 3);
        assert_eq!(doc["mcpServers"]["keep"]["url"], "https://mine/");
        assert!(doc["mcpServers"].get("miro").is_none());
        assert!(dir.path().join(".claude.json.bak-apps").is_file());
    }

    #[test]
    fn codex_enable_disable_preserves_comments() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("config.toml"),
            "# my config\nmodel = \"gpt\"\n\n[mcp_servers.keep]\nurl = \"https://mine/\" # mine\n",
        )
        .unwrap();
        let t = target(TargetKind::Codex, dir.path(), "config.toml");
        let mut managed = ManagedItems::default();
        enable(&app(), &t, &mut managed, &|s| s.clone()).unwrap();
        let text = fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(text.contains("# my config") && text.contains("# mine"));
        assert!(text.contains("[mcp_servers.miro]"));
        disable(&app(), &t, &mut managed).unwrap();
        let text = fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(!text.contains("[mcp_servers.miro]"));
        assert!(text.contains("[mcp_servers.keep]"));
    }

    #[test]
    fn skill_links_are_created_and_only_managed_links_removed() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("src-skill");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "x").unwrap();
        let t = target(TargetKind::Codex, dir.path(), "config.toml");
        let app = AppEntry {
            id: "s".into(),
            name: "s".into(),
            skills: vec![SkillRef {
                name: "demo".into(),
                path: source.to_string_lossy().into_owned(),
            }],
            ..Default::default()
        };
        let mut managed = ManagedItems::default();
        enable(&app, &t, &mut managed, &|s| s.clone()).unwrap();
        let link = dir.path().join("skills").join("demo");
        assert!(link.join("SKILL.md").is_file());
        disable(&app, &t, &mut managed).unwrap();
        assert!(!link.exists());
        assert!(
            source.join("SKILL.md").is_file(),
            "source skill must survive"
        );
    }
}
