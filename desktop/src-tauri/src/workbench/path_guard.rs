use std::path::{Component, Path, PathBuf};

pub const DEFAULT_ALLOWED_ROOTS: [&str; 3] = [
    r"C:\AIWorkstation\projects",
    r"C:\AIWorkstation\buzz_agents\claude_media\outputs",
    r"C:\AIWorkstation\buzz_agents\codex_media",
];

#[derive(Debug, Clone)]
pub struct PathGuard {
    roots: Vec<PathBuf>,
}

impl PathGuard {
    pub fn default_roots() -> Result<Self, String> {
        Self::new(DEFAULT_ALLOWED_ROOTS.iter().map(PathBuf::from).collect())
    }

    pub fn new(roots: Vec<PathBuf>) -> Result<Self, String> {
        if roots.is_empty() {
            return Err("at least one allowed root is required".to_string());
        }
        let roots = roots
            .into_iter()
            .map(|root| {
                root.canonicalize().map_err(|error| {
                    format!(
                        "failed to canonicalize allowed root {}: {error}",
                        root.display()
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { roots })
    }

    pub fn resolve(&self, input: impl AsRef<Path>) -> Result<PathBuf, String> {
        let input = input.as_ref();
        if input
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        {
            return Err("parent directory components are not allowed".to_string());
        }
        let canonical = input
            .canonicalize()
            .map_err(|error| format!("path does not exist or cannot be resolved: {error}"))?;
        if self.roots.iter().any(|root| canonical.starts_with(root)) {
            Ok(canonical)
        } else {
            Err("path is outside the allowed roots".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PathGuard;
    use std::fs;

    #[test]
    fn allows_existing_paths_inside_a_root() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("inside.txt");
        fs::write(&file, b"inside").unwrap();
        let guard = PathGuard::new(vec![temp.path().to_path_buf()]).unwrap();

        assert_eq!(guard.resolve(&file).unwrap(), file.canonicalize().unwrap());
    }

    #[test]
    fn rejects_parent_components_even_when_they_resolve_inside() {
        let temp = tempfile::tempdir().unwrap();
        let child = temp.path().join("child");
        fs::create_dir(&child).unwrap();
        let guard = PathGuard::new(vec![temp.path().to_path_buf()]).unwrap();

        let error = guard.resolve(child.join("..")).unwrap_err();
        assert!(error.contains("parent"));
    }

    #[test]
    fn rejects_existing_paths_outside_all_roots() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let guard = PathGuard::new(vec![root.path().to_path_buf()]).unwrap();

        let error = guard.resolve(outside.path()).unwrap_err();
        assert!(error.contains("outside"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_symlink_escape_when_windows_allows_link_creation() {
        use std::os::windows::fs::symlink_dir;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = root.path().join("escape");
        if let Err(error) = symlink_dir(outside.path(), &link) {
            eprintln!("skipping symlink test because Windows denied link creation: {error}");
            return;
        }
        let guard = PathGuard::new(vec![root.path().to_path_buf()]).unwrap();

        assert!(guard.resolve(&link).unwrap_err().contains("outside"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_junction_escape() {
        use std::process::Command;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let junction = root.path().join("junction-escape");
        let output = Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "test junction creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let guard = PathGuard::new(vec![root.path().to_path_buf()]).unwrap();

        assert!(guard.resolve(&junction).unwrap_err().contains("outside"));
        fs::remove_dir(&junction).unwrap();
    }
}
