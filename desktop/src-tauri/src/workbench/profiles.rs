use std::path::{Path, PathBuf};

pub const PROFILE_NAMES: &[&str] = &[
    "default",
    "superi-chrome",
    "superi-firefox",
    "flowpix",
    "higgsfield",
    "pinterest",
];

pub fn profile_directory(base: &Path, profile: &str) -> Result<PathBuf, String> {
    if !PROFILE_NAMES.contains(&profile) || profile.contains(['/', '\\', ':']) {
        return Err("unknown browser profile".to_string());
    }
    Ok(base.join("BuzzDukick").join("workbench").join("profiles").join(profile))
}

pub fn default_profile_root() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("local app data directory unavailable")?;
    Ok(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_names_are_allowlisted_and_local() {
        for name in PROFILE_NAMES {
            let path = profile_directory(Path::new("C:\\Users\\test\\AppData\\Local"), name).unwrap();
            assert!(path.ends_with(format!("BuzzDukick\\workbench\\profiles\\{name}")));
        }
        assert!(profile_directory(Path::new("C:\\Users\\test\\AppData\\Local"), "../../Buzz").is_err());
    }
}
