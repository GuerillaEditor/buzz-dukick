use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// One MCP server an app contributes. Either `url` (HTTP / streamable-HTTP)
/// or `command` (stdio) is set.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSpec {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

impl McpServerSpec {
    pub fn is_http(&self) -> bool {
        self.url.is_some()
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillRef {
    pub name: String,
    pub path: String,
}

/// A launchable integration: a website, MCP servers and/or skills.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// `https://…` or `data:` URL.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub browser_profile: Option<String>,
    #[serde(default)]
    pub mcp: Vec<McpServerSpec>,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    /// Where the entry came from: preset, claude, claude-plugin, codex,
    /// codex-plugin, skills, custom.
    #[serde(default)]
    pub sources: Vec<String>,
}

impl AppEntry {
    /// Fill gaps in `self` from `other` (same app found in another source).
    pub fn merge_from(&mut self, other: AppEntry) {
        if self.description.is_empty() {
            self.description = other.description;
        }
        if self.icon.is_none() {
            self.icon = other.icon;
        }
        if self.web_url.is_none() {
            self.web_url = other.web_url;
        }
        if self.browser_profile.is_none() {
            self.browser_profile = other.browser_profile;
        }
        for server in other.mcp {
            if !self.mcp.iter().any(|s| s.name == server.name) {
                self.mcp.push(server);
            }
        }
        for skill in other.skills {
            if !self.skills.iter().any(|s| s.name == skill.name) {
                self.skills.push(skill);
            }
        }
        for source in other.sources {
            if !self.sources.contains(&source) {
                self.sources.push(source);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Claude,
    Codex,
}

/// An agent configuration home Buzz agents read MCP servers and skills from:
/// a `CLAUDE_CONFIG_DIR` (or the default `~/.claude`) or a `CODEX_HOME`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTarget {
    pub id: String,
    pub kind: TargetKind,
    pub label: String,
    pub dir: String,
    pub config_file: String,
    pub skills_dir: String,
    /// Referenced by a Buzz managed agent or harness (CLAUDE_CONFIG_DIR / CODEX_HOME).
    pub in_use: bool,
}

/// Redacted MCP description sent to the UI (no header / env values).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    pub name: String,
    pub transport: &'static str,
    pub endpoint: String,
    pub has_secrets: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub web_url: Option<String>,
    pub browser_profile: String,
    pub mcp: Vec<McpServerView>,
    pub skills: Vec<SkillRef>,
    pub sources: Vec<String>,
    pub added: bool,
    pub custom: bool,
    /// Target ids where every MCP server and skill of the app is present.
    pub enabled_targets: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsSnapshot {
    pub apps: Vec<AppView>,
    pub targets: Vec<AgentTarget>,
}

/// Persisted state in `%LOCALAPPDATA%\BuzzDukick\apps\apps.json`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsFile {
    #[serde(default)]
    pub added: Vec<String>,
    #[serde(default)]
    pub custom: Vec<AppEntry>,
    /// What Buzz itself wrote into each target, so disabling never removes a
    /// server or skill the user configured by hand.
    #[serde(default)]
    pub managed: BTreeMap<String, ManagedItems>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedItems {
    #[serde(default)]
    pub mcp: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
}

/// Lowercase `[a-z0-9-]` id from a display name.
pub fn slug(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes_display_names() {
        assert_eq!(slug("Google Drive"), "google-drive");
        assert_eq!(slug("  Super-i  "), "super-i");
        assert_eq!(slug("small-business~g2"), "small-business-g2");
        assert_eq!(slug("ComfyUI :8188"), "comfyui-8188");
    }

    #[test]
    fn merge_keeps_first_values_and_unions_lists() {
        let mut a = AppEntry {
            id: "higgsfield".into(),
            name: "Higgsfield".into(),
            web_url: Some("https://higgsfield.ai".into()),
            mcp: vec![McpServerSpec {
                name: "higgsfield".into(),
                url: Some("https://mcp.higgsfield.ai/mcp".into()),
                ..Default::default()
            }],
            sources: vec!["preset".into()],
            ..Default::default()
        };
        a.merge_from(AppEntry {
            id: "higgsfield".into(),
            name: "Higgsfield".into(),
            description: "Images and video".into(),
            web_url: Some("https://other".into()),
            mcp: vec![McpServerSpec {
                name: "higgsfield".into(),
                url: Some("https://openai-mcp.higgsfield.ai/mcp".into()),
                ..Default::default()
            }],
            skills: vec![SkillRef {
                name: "higgsfield".into(),
                path: "C:\\x".into(),
            }],
            sources: vec!["codex-plugin".into()],
            ..Default::default()
        });
        assert_eq!(a.web_url.as_deref(), Some("https://higgsfield.ai"));
        assert_eq!(a.description, "Images and video");
        assert_eq!(a.mcp.len(), 1);
        assert_eq!(a.skills.len(), 1);
        assert_eq!(a.sources, vec!["preset", "codex-plugin"]);
    }
}
