use super::types::{AppEntry, McpServerSpec};

pub const WORKBENCH_APP_ID: &str = "buzz-workbench";

fn web(id: &str, name: &str, description: &str, url: &str) -> AppEntry {
    AppEntry {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        web_url: Some(url.into()),
        browser_profile: Some(id.into()),
        sources: vec!["preset".into()],
        ..Default::default()
    }
}

fn http_mcp(name: &str, url: &str) -> McpServerSpec {
    McpServerSpec {
        name: name.into(),
        url: Some(url.into()),
        ..Default::default()
    }
}

/// Built-in launchers for the tools Nam's production uses. Discovered
/// plugins / MCP servers with the same id are merged into these.
pub fn presets() -> Vec<AppEntry> {
    let mut higgsfield = web(
        "higgsfield",
        "Higgsfield",
        "Image & video generation (Genjutsu, Canvas, Marketing Studio).",
        "https://higgsfield.ai",
    );
    higgsfield
        .mcp
        .push(http_mcp("higgsfield", "https://mcp.higgsfield.ai/mcp"));

    let mut miro = web(
        "miro",
        "Miro",
        "Whiteboards and boards.",
        "https://miro.com/app/dashboard/",
    );
    miro.mcp.push(http_mcp("miro", "https://mcp.miro.com/"));

    let mut canva = web(
        "canva",
        "Canva",
        "Design, edit, resize.",
        "https://www.canva.com",
    );
    canva
        .mcp
        .push(http_mcp("canva", "https://mcp.canva.com/mcp"));

    let mut figma = web(
        "figma",
        "Figma",
        "Design files and prototypes.",
        "https://www.figma.com/files",
    );
    figma
        .mcp
        .push(http_mcp("figma", "https://mcp.figma.com/mcp"));

    let mut penpot = web(
        "penpot",
        "Penpot",
        "Self-hosted design tool (local :9011).",
        "http://localhost:9011",
    );
    penpot.browser_profile = Some("default".into());
    penpot
        .mcp
        .push(http_mcp("penpot", "http://localhost:4401/mcp"));

    let mut comfyui = web(
        "comfyui",
        "ComfyUI",
        "Local image/video workflows (:8188).",
        "http://127.0.0.1:8188",
    );
    comfyui.browser_profile = Some("default".into());

    let workbench = AppEntry {
        id: WORKBENCH_APP_ID.into(),
        name: "Buzz Workbench".into(),
        description: "Lets agents drive the Browser, Terminal and Files panes of Buzz Dukick."
            .into(),
        mcp: vec![http_mcp(
            "buzz-workbench",
            &format!(
                "http://127.0.0.1:{}/mcp",
                crate::workbench::workbench_mcp_port()
            ),
        )],
        sources: vec!["preset".into()],
        ..Default::default()
    };

    vec![
        workbench,
        higgsfield,
        web(
            "magicpath",
            "MagicPath",
            "AI UI design canvas.",
            "https://www.magicpath.ai",
        ),
        miro,
        canva,
        figma,
        web(
            "flowpix",
            "FlowPix",
            "Seedance / FlowPix workflows.",
            "https://flowpix.club",
        ),
        web(
            "super-i",
            "Super-i",
            "super-i.cn workflow articles.",
            "https://www.super-i.cn",
        ),
        comfyui,
        penpot,
        web(
            "pinterest",
            "Pinterest",
            "Reference images.",
            "https://www.pinterest.com",
        ),
        web("gmail", "Gmail", "Mail.", "https://mail.google.com"),
        web(
            "google-drive",
            "Google Drive",
            "Drive, Docs, Sheets.",
            "https://drive.google.com",
        ),
    ]
}
