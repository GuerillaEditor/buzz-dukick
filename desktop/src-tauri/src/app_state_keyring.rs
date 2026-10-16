/// Service name for the desktop OS keyring. Dukick builds never share the
/// upstream Buzz service, including debug launches.
fn dev_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with("buzz-desktop-dukick-dev."))
        .unwrap_or_else(|| "buzz-desktop-dukick-dev".to_string())
}

pub(crate) fn keyring_service() -> &'static str {
    if crate::build_identity::is_demo_build() {
        static DEMO_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        DEMO_SERVICE
            .get_or_init(|| crate::build_identity::keyring_service().into_owned())
            .as_str()
    } else if cfg!(debug_assertions) {
        static DEV_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        DEV_SERVICE
            .get_or_init(|| dev_keyring_service(std::env::var("BUZZ_DEV_KEYRING_SERVICE").ok()))
            .as_str()
    } else {
        "buzz-desktop-dukick"
    }
}

pub(super) fn migration_marker_name(service: &str, default_name: &str) -> String {
    if matches!(
        service,
        "buzz-desktop"
            | "buzz-desktop-dev"
            | "buzz-desktop-dukick"
            | "buzz-desktop-dukick-dev"
    ) {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

#[cfg(test)]
mod tests {
    use super::{dev_keyring_service, migration_marker_name};

    #[test]
    fn standalone_scope_must_remain_under_dev_service() {
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop-dukick-dev.example".to_string())),
            "buzz-desktop-dukick-dev.example"
        );
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop-dukick".to_string())),
            "buzz-desktop-dukick-dev"
        );
    }

    #[test]
    fn standalone_scope_uses_its_own_migration_marker() {
        assert_eq!(
            migration_marker_name("buzz-desktop-dukick", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dukick-dev", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dukick-dev.example", "identity.migrated"),
            "identity.buzz-desktop-dukick-dev.example.migrated"
        );
    }

    #[test]
    fn dukick_builds_use_a_distinct_keyring_service() {
        let expected = if cfg!(debug_assertions) {
            "buzz-desktop-dukick-dev"
        } else {
            "buzz-desktop-dukick"
        };
        assert_eq!(super::keyring_service(), expected);
    }
}
