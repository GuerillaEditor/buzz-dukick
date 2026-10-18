//! Read-only discovery of integrations already set up for Claude Code /
//! Claude desktop and Codex, plus the agent config homes Buzz agents use.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use super::types::{slug, AgentTarget, AppEntry, McpServerSpec, SkillRef, TargetKind};

const MAX_ICON_BYTES: u64 = 256 * 1024;

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn read_toml(path: &Path) -> Option<toml::Value> {
    toml::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Servers that carry a Buzz identity are per-agent plumbing, not apps.
fn is_identity_server(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "buzz" || lower.starts_with("buzz-chat") || lower.starts_with("sprout")
}

fn string_map(value: Option<&serde_json::Value>) -> BTreeMap<String, String> {
    value
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Parse one `mcpServers` entry from a Claude / plugin `.mcp.json` document.
pub fn mcp_from_json(name: &str, value: &serde_json::Value) -> Option<McpServerSpec> {
    let obj = value.as_object()?;
    if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
        return Some(McpServerSpec {
            name: name.to_string(),
            url: Some(url.to_string()),
            headers: string_map(obj.get("headers")),
            ..Default::default()
        });
    }
    let command = obj.get("command").and_then(|v| v.as_str())?;
    Some(McpServerSpec {
        name: name.to_string(),
        command: Some(command.to_string()),
        args: obj
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        env: string_map(obj.get("env")),
        ..Default::default()
    })
}

/// Parse one `[mcp_servers.<name>]` table from a Codex `config.toml`.
pub fn mcp_from_toml(name: &str, value: &toml::Value) -> Option<McpServerSpec> {
    let table = value.as_table()?;
    let str_map = |key: &str| -> BTreeMap<String, String> {
        table
            .get(key)
            .and_then(|v| v.as_table())
            .map(|t| {
                t.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(url) = table.get("url").and_then(|v| v.as_str()) {
        return Some(McpServerSpec {
            name: name.to_string(),
            url: Some(url.to_string()),
            headers: str_map("http_headers"),
            ..Default::default()
        });
    }
    let command = table.get("command").and_then(|v| v.as_str())?;
    Some(McpServerSpec {
        name: name.to_string(),
        command: Some(command.to_string()),
        args: table
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        env: str_map("env"),
        ..Default::default()
    })
}

fn server_app(spec: McpServerSpec, source: &str) -> AppEntry {
    AppEntry {
        id: slug(&spec.name),
        name: spec.name.clone(),
        mcp: vec![spec],
        sources: vec![source.to_string()],
        ..Default::default()
    }
}

/// Skill folders (`<dir>/<name>/SKILL.md`) under `dir`.
fn skills_in(dir: &Path) -> Vec<SkillRef> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.join("SKILL.md").is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                out.push(SkillRef {
                    name: name.to_string(),
                    path: path.to_string_lossy().into_owned(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn icon_data_url(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_ICON_BYTES {
        return None;
    }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn claude_config_file(dir: &Path, home: &Path) -> PathBuf {
    if dir == home.join(".claude") {
        home.join(".claude.json")
    } else {
        dir.join(".claude.json")
    }
}

fn norm(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_ascii_lowercase()
}

/// Collect every `CLAUDE_CONFIG_DIR` / `CODEX_HOME` value in Buzz harness and
/// managed-agent files (both the official Buzz and Buzz Dukick app data).
fn referenced_homes(buzz_data_dirs: &[PathBuf]) -> (BTreeSet<String>, BTreeSet<String>) {
    fn walk(
        value: &serde_json::Value,
        claude: &mut BTreeSet<String>,
        codex: &mut BTreeSet<String>,
    ) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    if let Some(text) = child.as_str() {
                        if key == "CLAUDE_CONFIG_DIR" {
                            claude.insert(text.to_string());
                        } else if key == "CODEX_HOME" {
                            codex.insert(text.to_string());
                        }
                    }
                    walk(child, claude, codex);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, claude, codex);
                }
            }
            _ => {}
        }
    }
    let mut claude = BTreeSet::new();
    let mut codex = BTreeSet::new();
    for base in buzz_data_dirs {
        let mut files = vec![base.join("agents").join("managed-agents.json")];
        if let Ok(entries) = std::fs::read_dir(base.join("custom_harnesses")) {
            files.extend(
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "json")),
            );
        }
        for file in files {
            if let Some(json) = read_json(&file) {
                walk(&json, &mut claude, &mut codex);
            }
        }
    }
    (claude, codex)
}

/// Agent config homes: default `~/.claude` and `~/.codex`, every
/// `~/.claude-*` profile, and every `CODEX_HOME` a Buzz harness uses.
pub fn discover_targets(home: &Path, buzz_data_dirs: &[PathBuf]) -> Vec<AgentTarget> {
    let (claude_refs, codex_refs) = referenced_homes(buzz_data_dirs);
    let claude_refs: BTreeSet<String> = claude_refs.iter().map(|p| norm(Path::new(p))).collect();
    let codex_refs_norm: BTreeSet<String> = codex_refs.iter().map(|p| norm(Path::new(p))).collect();

    let mut claude_dirs = vec![home.join(".claude")];
    if let Ok(entries) = std::fs::read_dir(home) {
        let mut extra: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(".claude-"))
                    && p.join(".claude.json").is_file()
            })
            .collect();
        extra.sort();
        claude_dirs.extend(extra);
    }

    let mut targets = Vec::new();
    for dir in claude_dirs {
        let label = match dir.file_name().and_then(|n| n.to_str()) {
            Some(".claude") => "Claude Code (mặc định)".to_string(),
            Some(name) => format!("Claude ({})", name.trim_start_matches(".claude-")),
            None => continue,
        };
        targets.push(AgentTarget {
            id: format!("claude:{}", norm(&dir)),
            kind: TargetKind::Claude,
            label,
            config_file: claude_config_file(&dir, home)
                .to_string_lossy()
                .into_owned(),
            skills_dir: dir.join("skills").to_string_lossy().into_owned(),
            in_use: claude_refs.contains(&norm(&dir)),
            dir: dir.to_string_lossy().into_owned(),
        });
    }

    let mut codex_dirs = vec![home.join(".codex")];
    for path in &codex_refs {
        let candidate = PathBuf::from(path);
        if candidate.is_dir() && !codex_dirs.iter().any(|d| norm(d) == norm(&candidate)) {
            codex_dirs.push(candidate);
        }
    }
    for dir in codex_dirs {
        let label = if dir == home.join(".codex") {
            "Codex (mặc định)".to_string()
        } else {
            let parent = dir
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("custom");
            format!("Codex ({parent})")
        };
        targets.push(AgentTarget {
            id: format!("codex:{}", norm(&dir)),
            kind: TargetKind::Codex,
            label,
            config_file: dir.join("config.toml").to_string_lossy().into_owned(),
            skills_dir: dir.join("skills").to_string_lossy().into_owned(),
            in_use: codex_refs_norm.contains(&norm(&dir)),
            dir: dir.to_string_lossy().into_owned(),
        });
    }
    targets
}

fn claude_plugin_apps(home: &Path) -> Vec<AppEntry> {
    let mut out: BTreeMap<String, AppEntry> = BTreeMap::new();
    let Ok(orgs) = std::fs::read_dir(home.join(".claude").join("plugins").join("synced")) else {
        return Vec::new();
    };
    for org in orgs.flatten() {
        let Ok(plugins) = std::fs::read_dir(org.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            let dir = plugin.path();
            let Some(manifest) = read_json(&dir.join(".claude-plugin").join("plugin.json")) else {
                continue;
            };
            let Some(name) = manifest.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let id = slug(name);
            if id.is_empty() || out.contains_key(&id) {
                continue;
            }
            let mut mcp = Vec::new();
            if let Some(doc) = read_json(&dir.join(".mcp.json")) {
                if let Some(servers) = doc.get("mcpServers").and_then(|v| v.as_object()) {
                    for (server_name, value) in servers {
                        if let Some(spec) = mcp_from_json(server_name, value) {
                            mcp.push(spec);
                        }
                    }
                }
            }
            out.insert(
                id.clone(),
                AppEntry {
                    id,
                    name: name.to_string(),
                    description: manifest
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    mcp,
                    skills: skills_in(&dir.join("skills")),
                    sources: vec!["claude-plugin".into()],
                    ..Default::default()
                },
            );
        }
    }
    out.into_values().collect()
}

/// Latest version directory of each Codex plugin in the plugin cache.
fn codex_plugin_apps(home: &Path) -> Vec<AppEntry> {
    let mut out = Vec::new();
    let cache = home.join(".codex").join("plugins").join("cache");
    let Ok(marketplaces) = std::fs::read_dir(&cache) else {
        return out;
    };
    for marketplace in marketplaces.flatten() {
        let market_name = marketplace.file_name().to_string_lossy().into_owned();
        // Bundled runtime plugins only work inside the Codex app itself.
        if market_name == "openai-bundled" || market_name == "openai-primary-runtime" {
            continue;
        }
        let Ok(plugins) = std::fs::read_dir(marketplace.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            let Ok(versions) = std::fs::read_dir(plugin.path()) else {
                continue;
            };
            let mut dirs: Vec<PathBuf> = versions.flatten().map(|v| v.path()).collect();
            dirs.sort();
            let Some(dir) = dirs
                .into_iter()
                .rev()
                .find(|d| d.join(".codex-plugin").join("plugin.json").is_file())
            else {
                continue;
            };
            let Some(manifest) = read_json(&dir.join(".codex-plugin").join("plugin.json")) else {
                continue;
            };
            let interface = manifest.get("interface");
            let field = |key: &str| {
                interface
                    .and_then(|i| i.get(key))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            };
            let name = field("displayName").or_else(|| {
                manifest
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            });
            let Some(name) = name else { continue };
            let mut mcp = Vec::new();
            let mcp_file = manifest
                .get("mcpServers")
                .and_then(|v| v.as_str())
                .map(|rel| dir.join(rel.trim_start_matches("./")))
                .unwrap_or_else(|| dir.join("mcp.json"));
            if let Some(doc) = read_json(&mcp_file) {
                if let Some(servers) = doc.get("mcpServers").and_then(|v| v.as_object()) {
                    for (server_name, value) in servers {
                        if let Some(spec) = mcp_from_json(server_name, value) {
                            mcp.push(spec);
                        }
                    }
                }
            }
            let icon = field("logo")
                .and_then(|rel| icon_data_url(&dir.join(rel.trim_start_matches("./"))));
            out.push(AppEntry {
                id: slug(&name),
                name,
                description: field("shortDescription").unwrap_or_default(),
                icon,
                web_url: field("websiteURL"),
                mcp,
                skills: skills_in(&dir.join("skills")),
                sources: vec!["codex-plugin".into()],
                ..Default::default()
            });
        }
    }
    out
}

fn config_server_apps(targets: &[AgentTarget]) -> Vec<AppEntry> {
    let mut out = Vec::new();
    for target in targets {
        let path = Path::new(&target.config_file);
        match target.kind {
            TargetKind::Claude => {
                let Some(doc) = read_json(path) else { continue };
                if let Some(servers) = doc.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, value) in servers {
                        if is_identity_server(name) {
                            continue;
                        }
                        if let Some(spec) = mcp_from_json(name, value) {
                            out.push(server_app(spec, "claude"));
                        }
                    }
                }
            }
            TargetKind::Codex => {
                let Some(doc) = read_toml(path) else { continue };
                if let Some(servers) = doc.get("mcp_servers").and_then(|v| v.as_table()) {
                    for (name, value) in servers {
                        if is_identity_server(name) {
                            continue;
                        }
                        if let Some(spec) = mcp_from_toml(name, value) {
                            out.push(server_app(spec, "codex"));
                        }
                    }
                }
            }
        }
    }
    out
}

/// Loose skills in `~/.claude/skills` and `~/.codex/skills`. Skills sharing a
/// prefix (hyperframes-*) become one app; a skill named like an app joins it.
fn skill_apps(home: &Path, known_ids: &BTreeSet<String>) -> Vec<AppEntry> {
    let mut skills: BTreeMap<String, SkillRef> = BTreeMap::new();
    for dir in [
        home.join(".claude").join("skills"),
        home.join(".codex").join("skills"),
    ] {
        for skill in skills_in(&dir) {
            skills.entry(skill.name.clone()).or_insert(skill);
        }
    }
    let mut prefix_count: BTreeMap<String, usize> = BTreeMap::new();
    for name in skills.keys() {
        let prefix = name.split('-').next().unwrap_or(name).to_string();
        *prefix_count.entry(prefix).or_default() += 1;
    }
    let mut apps: BTreeMap<String, AppEntry> = BTreeMap::new();
    for (name, skill) in skills {
        let prefix = name.split('-').next().unwrap_or(&name).to_string();
        let id = if known_ids.contains(&name) {
            name.clone()
        } else if known_ids.contains(&prefix) || prefix_count.get(&prefix).copied().unwrap_or(0) > 1
        {
            prefix
        } else {
            name.clone()
        };
        apps.entry(id.clone())
            .or_insert_with(|| AppEntry {
                id: id.clone(),
                name: id.clone(),
                description: "Skill".into(),
                sources: vec!["skills".into()],
                ..Default::default()
            })
            .skills
            .push(skill);
    }
    apps.into_values().collect()
}

/// Everything discoverable on this machine, merged by id onto `base`.
pub fn discover_apps(home: &Path, targets: &[AgentTarget], base: Vec<AppEntry>) -> Vec<AppEntry> {
    let mut by_id: BTreeMap<String, AppEntry> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut add = |entry: AppEntry, by_id: &mut BTreeMap<String, AppEntry>| {
        if entry.id.is_empty() {
            return;
        }
        match by_id.get_mut(&entry.id) {
            Some(existing) => existing.merge_from(entry),
            None => {
                order.push(entry.id.clone());
                by_id.insert(entry.id.clone(), entry);
            }
        }
    };
    for entry in base {
        add(entry, &mut by_id);
    }
    for entry in codex_plugin_apps(home) {
        add(entry, &mut by_id);
    }
    for entry in claude_plugin_apps(home) {
        add(entry, &mut by_id);
    }
    for entry in config_server_apps(targets) {
        add(entry, &mut by_id);
    }
    let known: BTreeSet<String> = by_id.keys().cloned().collect();
    for entry in skill_apps(home, &known) {
        add(entry, &mut by_id);
    }
    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_claude_and_codex_mcp_entries() {
        let http = serde_json::json!({"type":"http","url":"https://mcp.x/mcp","headers":{"Authorization":"Bearer s"}});
        let spec = mcp_from_json("x", &http).unwrap();
        assert_eq!(spec.url.as_deref(), Some("https://mcp.x/mcp"));
        assert_eq!(
            spec.headers.get("Authorization").map(String::as_str),
            Some("Bearer s")
        );

        let stdio = serde_json::json!({"command":"node","args":["a.js"],"env":{"K":"v"}});
        let spec = mcp_from_json("y", &stdio).unwrap();
        assert_eq!(spec.command.as_deref(), Some("node"));
        assert_eq!(spec.args, vec!["a.js"]);

        let doc: toml::Value = toml::from_str(
            "[mcp_servers.h]\nurl='https://h/mcp'\nhttp_headers={A='b'}\n[mcp_servers.s]\ncommand='uvx'\nargs=['w']\n",
        )
        .unwrap();
        let servers = doc.get("mcp_servers").unwrap();
        assert_eq!(
            mcp_from_toml("h", &servers["h"])
                .unwrap()
                .headers
                .get("A")
                .map(String::as_str),
            Some("b")
        );
        assert_eq!(
            mcp_from_toml("s", &servers["s"])
                .unwrap()
                .command
                .as_deref(),
            Some("uvx")
        );
    }

    #[test]
    fn discovers_targets_plugins_servers_and_skills() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        // Claude default + a profile used by a Buzz agent.
        fs::create_dir_all(h.join(".claude/skills/hyperframes-core")).unwrap();
        fs::write(h.join(".claude/skills/hyperframes-core/SKILL.md"), "x").unwrap();
        fs::create_dir_all(h.join(".claude/skills/hyperframes-cli")).unwrap();
        fs::write(h.join(".claude/skills/hyperframes-cli/SKILL.md"), "x").unwrap();
        fs::create_dir_all(h.join(".claude/skills/magicpath")).unwrap();
        fs::write(h.join(".claude/skills/magicpath/SKILL.md"), "x").unwrap();
        fs::write(
            h.join(".claude.json"),
            r#"{"mcpServers":{"higgsfield":{"type":"http","url":"https://mcp.higgsfield.ai/mcp"},"buzz":{"command":"node"}}}"#,
        )
        .unwrap();
        fs::create_dir_all(h.join(".claude-thai4")).unwrap();
        fs::write(
            h.join(".claude-thai4/.claude.json"),
            r#"{"mcpServers":{"miro":{"type":"http","url":"https://mcp.miro.com/"}}}"#,
        )
        .unwrap();
        // Codex home referenced by a Buzz harness.
        let codex_home = h.join("codex_media/codex_home");
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[mcp_servers.comfy-media]\ncommand='python'\nargs=['s.py']\n[mcp_servers.buzz-chat]\ncommand='node'\n",
        )
        .unwrap();
        let buzz = h.join("buzz-data");
        fs::create_dir_all(buzz.join("custom_harnesses")).unwrap();
        fs::write(
            buzz.join("custom_harnesses/codex-media.json"),
            serde_json::json!({"env":{"CODEX_HOME": codex_home.to_string_lossy()}}).to_string(),
        )
        .unwrap();
        fs::create_dir_all(buzz.join("agents")).unwrap();
        fs::write(
            buzz.join("agents/managed-agents.json"),
            serde_json::json!([{"env_vars":{"CLAUDE_CONFIG_DIR": h.join(".claude-thai4").to_string_lossy()}}]).to_string(),
        )
        .unwrap();

        let targets = discover_targets(h, &[buzz]);
        let labels: Vec<&str> = targets.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(
            labels,
            vec![
                "Claude Code (mặc định)",
                "Claude (thai4)",
                "Codex (mặc định)",
                "Codex (codex_media)"
            ]
        );
        assert!(targets[1].in_use && targets[3].in_use && !targets[0].in_use);
        assert!(targets[0].config_file.ends_with(".claude.json"));

        let base = vec![AppEntry {
            id: "magicpath".into(),
            name: "MagicPath".into(),
            sources: vec!["preset".into()],
            ..Default::default()
        }];
        let apps = discover_apps(h, &targets, base);
        let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"higgsfield"));
        assert!(ids.contains(&"miro"));
        assert!(ids.contains(&"comfy-media"));
        assert!(!ids.contains(&"buzz") && !ids.contains(&"buzz-chat"));
        let magicpath = apps.iter().find(|a| a.id == "magicpath").unwrap();
        assert_eq!(magicpath.skills.len(), 1);
        let hyper = apps.iter().find(|a| a.id == "hyperframes").unwrap();
        assert_eq!(hyper.skills.len(), 2);
    }
}
