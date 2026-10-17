use std::{net::IpAddr, path::PathBuf};

use getrandom::getrandom;

pub const DEFAULT_PORT: u16 = 8941;

fn token_path() -> Result<PathBuf, String> {
    let root = dirs::data_local_dir().ok_or("local data directory unavailable")?;
    Ok(root.join("BuzzDukick").join("workbench").join("mcp-token"))
}

pub fn load_or_create_token() -> Result<String, String> {
    let path = token_path()?;
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if token.len() >= 32 {
            return Ok(token);
        }
    }
    let parent = path.parent().ok_or("invalid token path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes).map_err(|e| e.to_string())?;
    let token = hex::encode(bytes);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut opts = std::fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true).mode(0o600);
        use std::io::Write;
        let mut file = opts.open(&path).map_err(|e| e.to_string())?;
        file.write_all(token.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, token.as_bytes()).map_err(|e| e.to_string())?;
    Ok(token)
}

pub fn token_matches(expected: &str, supplied: Option<&str>) -> bool {
    let supplied = supplied.unwrap_or("");
    expected.as_bytes().len() == supplied.as_bytes().len()
        && expected
            .as_bytes()
            .iter()
            .zip(supplied.as_bytes())
            .fold(0u8, |v, (a, b)| v | (a ^ b))
            == 0
}

pub fn is_loopback(addr: IpAddr) -> bool {
    addr.is_loopback()
}

pub fn configured_port() -> u16 {
    std::env::var("BUZZ_DUKICK_MCP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_matching_token() {
        assert!(token_matches("abc", Some("abc")));
        assert!(!token_matches("abc", Some("abd")));
        assert!(!token_matches("abc", None));
    }
    #[test]
    fn loopback_guard_rejects_remote() {
        assert!(is_loopback("127.0.0.1".parse().unwrap()));
        assert!(!is_loopback("192.168.1.3".parse().unwrap()));
        assert!(is_loopback("::1".parse().unwrap()));
    }
}
