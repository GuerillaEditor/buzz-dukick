use serde_json::Value;

#[test]
fn external_workbench_webviews_have_an_explicit_empty_capability() {
    let default: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("default capability must be valid JSON");
    assert!(default.get("windows").is_none());
    assert_eq!(default["webviews"], serde_json::json!(["main", "huddle-*"]));

    let workbench: Value =
        serde_json::from_str(include_str!("../capabilities/workbench-browser.json"))
            .expect("workbench capability must be valid JSON");
    assert_eq!(
        workbench["webviews"],
        serde_json::json!(["workbench-browser-*"])
    );
    assert_eq!(workbench["permissions"], serde_json::json!([]));
}
