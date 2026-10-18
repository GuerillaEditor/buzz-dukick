use std::path::{Path, PathBuf};

pub const PROFILE_NAMES: &[&str] = &[
    "default",
    "superi-chrome",
    "superi-firefox",
    "flowpix",
    "higgsfield",
    "pinterest",
];

/// Profile names are `[a-z0-9-]{1,48}` so each Apps-hub app can keep its own
/// logins; the built-in names above stay valid.
pub fn is_valid_profile_name(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 48
        && !profile.starts_with('-')
        && profile
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn profile_directory(base: &Path, profile: &str) -> Result<PathBuf, String> {
    if !is_valid_profile_name(profile) {
        return Err("invalid browser profile".to_string());
    }
    Ok(base
        .join("BuzzDukick")
        .join("workbench")
        .join("profiles")
        .join(profile))
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
            let path =
                profile_directory(Path::new("C:\\Users\\test\\AppData\\Local"), name).unwrap();
            assert!(path.ends_with(format!("BuzzDukick\\workbench\\profiles\\{name}")));
        }
        assert!(
            profile_directory(Path::new("C:\\Users\\test\\AppData\\Local"), "../../Buzz").is_err()
        );
        assert!(profile_directory(Path::new("C:\\x"), "google-drive").is_ok());
        assert!(profile_directory(Path::new("C:\\x"), "Bad Name").is_err());
        assert!(profile_directory(Path::new("C:\\x"), "a\\b").is_err());
    }
}
