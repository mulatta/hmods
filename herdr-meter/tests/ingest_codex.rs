mod common;

use common::{now, run_in, temp_dir};
use hmeter::codex::{self, Hook, Rollout};
use hmeter::snapshot::{Certainty, Store};

const HOOK: &str = include_str!("fixtures/codex-post-model-request.json");
const ROLLOUT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/codex-rollout.jsonl"
);
const HC_GET_CODEX: &str = include_str!("fixtures/hc-get-codex.json");
const HC_GET_CLAUDE: &str = include_str!("fixtures/hc-get-claude.json");
// A fake `hc` that knows t3 (Codex) and t9 (Claude Code); every other terminal is gone.
const FAKE_HC: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/bin");

fn hook() -> String {
    HOOK.replace("ROLLOUT", ROLLOUT)
}

/// Puts the fake `hc` first on PATH while keeping the tools its script needs.
fn with_fake_hc() -> String {
    format!("{FAKE_HC}:{}", std::env::var("PATH").unwrap_or_default())
}

fn ingest(state: &std::path::Path, terminal: Option<&str>, path: &str) -> String {
    // t4's Codex is this test process, an ancestor of the hmeter it starts.
    let pid = std::process::id().to_string();
    run_in(
        state,
        terminal,
        &[("PATH", path), ("HC_FAKE_PID", &pid)],
        &["ingest", "codex"],
        &hook(),
    )
}

#[test]
fn completed_request_estimates_expiry_and_reads_windows_from_rollout() {
    let hook = Hook::parse(&hook()).unwrap();
    let rollout = Rollout::read(ROLLOUT);
    let snap = codex::snapshot(&hook, "t3", 1000, None, rollout.as_ref()).unwrap();
    assert_eq!(snap.agent, "codex");
    assert_eq!(snap.model.as_deref(), Some("gpt-5.6-sol"));
    let cache = snap.cache.unwrap();
    assert_eq!(cache.certainty, Certainty::Estimated);
    assert_eq!(cache.expires_at, Some(1000 + 300));
    assert_eq!(cache.at_stake_tokens, Some(84058));
    let windows: Vec<_> = snap
        .limits
        .iter()
        .map(|l| (l.window_minutes, l.used_pct, l.resets_at))
        .collect();
    assert_eq!(windows, [(Some(10080), 2.0, Some(1_794_387_269))]);
    let context = snap.context.unwrap();
    assert_eq!(context.tokens, Some(84058));
    assert_eq!(context.used_pct.map(f64::round), Some(33.0));
}

#[test]
fn failed_request_keeps_the_previous_cache_and_windows() {
    let ok = Hook::parse(&hook()).unwrap();
    let rollout = Rollout::read(ROLLOUT);
    let prev = codex::snapshot(&ok, "t3", 1000, None, rollout.as_ref()).unwrap();

    let failed = hook().replace("\"completed\"", "\"failed\"");
    let failed = failed.replace(
        &failed[failed.find("\"token_usage\"").unwrap()..],
        "\"token_usage\": null }",
    );
    let failed = Hook::parse(&failed).unwrap();
    let snap = codex::snapshot(&failed, "t3", 1200, Some(&prev), None).unwrap();
    assert_eq!(snap.updated_at, 1200);
    assert_eq!(snap.cache.unwrap().expires_at, Some(1300));
    assert_eq!(snap.limits.len(), 1);
}

#[test]
fn subagents_and_other_events_are_ignored() {
    let sub = hook().replace("\"turn_id\"", "\"agent_id\": \"a1\", \"turn_id\"");
    assert!(codex::snapshot(&Hook::parse(&sub).unwrap(), "t3", 1000, None, None).is_none());
    let pre = hook().replace("PostModelRequest", "PreModelRequest");
    assert!(codex::snapshot(&Hook::parse(&pre).unwrap(), "t3", 1000, None, None).is_none());
}

#[test]
fn only_a_terminal_running_codex_names_its_process() {
    assert_eq!(codex::codex_terminal_pid(HC_GET_CODEX), Some(79561));
    assert_eq!(codex::codex_terminal_pid(HC_GET_CLAUDE), None);
    assert_eq!(
        codex::codex_terminal_pid(r#"{"error":{"kind":"not_found","message":"no such terminal"}}"#),
        None
    );
    assert_eq!(codex::codex_terminal_pid("not json"), None);
}

#[test]
fn a_process_descends_from_its_ancestors_only() {
    let parents = codex::parents("  10     1\n  20    10\n  30    20\n  40     1\n");
    assert!(codex::descends_from(&parents, 30, 10));
    assert!(codex::descends_from(&parents, 10, 10));
    assert!(!codex::descends_from(&parents, 40, 10));
    assert!(!codex::descends_from(&parents, 99, 10));
}

#[test]
fn ingest_records_snapshot_and_prints_nothing() {
    let state = temp_dir("codex");
    let before = now();
    let out = ingest(&state, Some("t4"), &with_fake_hc());
    assert_eq!(out, "");
    let snap = Store::new(state.join("herdr-meter")).read("t4").unwrap();
    assert_eq!(snap.agent, "codex");
    assert!(snap.cache.unwrap().expires_at.unwrap() >= before + 300);
    assert_eq!(snap.limits[0].window_minutes, Some(10080));

    let outside = temp_dir("codex-outside");
    ingest(&outside, None, &with_fake_hc());
    assert!(!outside.join("herdr-meter").exists());
}

// Under Codex's shared app-server daemon the hook inherits the daemon's terminal, which may
// run another agent, be gone, or run another Codex session; such requests must not land in
// that terminal's snapshot.
#[test]
fn requests_from_terminals_not_running_codex_are_dropped() {
    let state = temp_dir("codex-daemon");
    for terminal in ["t9", "t5"] {
        ingest(&state, Some(terminal), &with_fake_hc());
    }
    assert!(!state.join("herdr-meter").exists());
}

#[test]
fn a_hook_outside_the_terminals_codex_is_dropped() {
    // t3 runs Codex, but as a process this hook does not run under: the daemon's case.
    let state = temp_dir("codex-other-session");
    ingest(&state, Some("t3"), &with_fake_hc());
    assert!(!state.join("herdr-meter").exists());
}

#[test]
fn without_hc_nothing_is_recorded() {
    let state = temp_dir("codex-no-hc");
    let empty = temp_dir("codex-empty-path");
    ingest(&state, Some("t4"), empty.to_str().unwrap());
    assert!(!state.join("herdr-meter").exists());
}
