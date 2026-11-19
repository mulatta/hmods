mod common;

use serde_json::{Value, json};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;

fn run(root: &Path, args: &[&str]) -> String {
    common::run_env(
        root,
        &[
            ("HERDR_APP_HOME", root.join("app").to_str().unwrap()),
            ("PATH", "/usr/bin:/bin"),
        ],
        args,
    )
}

#[test]
fn install_sync_status_and_uninstall() {
    let root = common::temp_dir("sync");
    run(&root, &["install", "--dry-run"]);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    run(&root, &["install"]);
    let cache = root.join("app/mods/cache");
    let version = env!("CARGO_PKG_VERSION");
    let main = cache.join("main.js");
    assert_eq!(
        fs::read(&main).unwrap(),
        include_bytes!("../mods/cache/main.js")
    );
    assert_ne!(fs::metadata(&main).unwrap().permissions().mode() & 0o200, 0);
    let modified = fs::metadata(&main).unwrap().modified().unwrap();
    fs::write(cache.join("gpui-kit.d.ts"), "generated").unwrap();
    fs::write(cache.join("jsconfig.json"), "{}").unwrap();
    fs::write(cache.join("stale"), "old").unwrap();
    fs::write(
        cache.join(".hmods"),
        r#"{"tool":"hmeter","version":"0","check":"passed"}"#,
    )
    .unwrap();
    assert!(run(&root, &["status"]).lines().any(|line| line
        == format!(
            "cache  installed 0 (check passed), package {version}: outdated, run `hmeter install`"
        )));
    run(&root, &["install"]);
    assert_eq!(fs::metadata(&main).unwrap().modified().unwrap(), modified);
    assert!(!cache.join("stale").exists());
    assert_eq!(fs::read(cache.join("gpui-kit.d.ts")).unwrap(), b"generated");
    assert!(cache.join("jsconfig.json").exists());
    let status: Value = serde_json::from_str(&run(&root, &["status", "--json"])).unwrap();
    for name in ["cache", "usage"] {
        assert_eq!(
            status["mods"][name],
            json!({"installed":version,"check":"skipped","package":version,"path":root.join("app/mods").join(name)})
        );
    }
    fs::remove_file(cache.join(".hmods")).unwrap();
    run(&root, &["uninstall", "--dry-run"]);
    assert!(root.join("app/mods/usage").exists());
    run(&root, &["uninstall"]);
    assert!(main.exists());
    assert!(!root.join("app/mods/usage").exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preserves_foreign_folder_and_replaces_link() {
    let root = common::temp_dir("backup");
    let mods = root.join("custom/mods");
    fs::create_dir_all(mods.join("cache")).unwrap();
    fs::write(mods.join("cache/user.js"), "mine").unwrap();
    symlink(mods.join("cache"), mods.join("usage")).unwrap();
    let out = run(
        &root,
        &[
            "install",
            "--app-home",
            mods.parent().unwrap().to_str().unwrap(),
        ],
    );
    let timestamp = fs::read_dir(root.join("hmods/backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(fs::read(timestamp.join("cache/user.js")).unwrap(), b"mine");
    assert!(out.contains(timestamp.to_str().unwrap()));
    assert!(mods.join("usage/mod.json").is_file());
    assert!(!mods.join("usage").is_symlink());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn checks_each_mod_before_recording_the_result() {
    let root = common::temp_dir("check").canonicalize().unwrap();
    let app = root.join("custom");
    let checker = root.join("herdr-app");
    fs::write(
        &checker,
        r#"#!/bin/sh
test "$1" = check && test "$HERDR_APP_HOME" = "${2%/mods/*}" && test ! -e "$2/.hmods" || exit 9
case "$2" in
  */cache) echo details; echo error >&2; exit 1 ;;
  *) echo noisy-success ;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(&checker, fs::Permissions::from_mode(0o755)).unwrap();
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_hmeter"))
        .current_dir(&root)
        .env("PATH", &root)
        .env("HERDR_APP_HOME", root.join("wrong"))
        .args(["install", "--app-home=custom"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let cache = app.join("mods/cache");
    let usage = app.join("mods/usage");
    let version = env!("CARGO_PKG_VERSION");
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!(
            "check failed: {c}\n  details\n  error\ninstalled cache {version} → {c} (check failed)\ncheck passed: {u}\ninstalled usage {version} → {u}\n",
            c = cache.display(),
            u = usage.display()
        )
    );
    for (dir, check) in [(cache, "failed"), (usage, "passed")] {
        let marker: Value = serde_json::from_slice(&fs::read(dir.join(".hmods")).unwrap()).unwrap();
        assert_eq!(
            marker,
            json!({"tool":"hmeter","version":version,"check":check})
        );
    }
    assert_eq!(
        std::process::Command::new(env!("CARGO_BIN_EXE_hmeter"))
            .args(["status", "--app-home", app.to_str().unwrap(), "--dry-run"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(2)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn groups_foreign_targets_by_run() {
    let root = common::temp_dir("two-backups");
    let mods = root.join("app/mods");
    fs::create_dir_all(mods.join("cache")).unwrap();
    fs::write(mods.join("cache/.hmods"), "invalid").unwrap();
    fs::write(mods.join("usage"), "mine").unwrap();
    let preview = run(&root, &["install", "--dry-run"]);
    assert_eq!(
        preview
            .lines()
            .filter(|line| line.starts_with("would move "))
            .count(),
        2
    );
    assert!(!root.join("hmods").exists());
    run(&root, &["install"]);
    let folders: Vec<_> = fs::read_dir(root.join("hmods/backups"))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(folders.len(), 1);
    let name = folders[0].file_name().into_string().unwrap();
    assert_eq!(name.len(), 16);
    assert_eq!(&name[8..9], "T");
    assert!(name.ends_with('Z'));
    assert_eq!(fs::read(folders[0].path().join("usage")).unwrap(), b"mine");
    assert!(folders[0].path().join("cache/.hmods").is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn installs_all_source_files_and_keeps_nested_generated_files() {
    fn compare(src: &Path, installed: &Path) {
        for entry in fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let target = installed.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                compare(&entry.path(), &target);
            } else {
                assert_eq!(
                    fs::read(&target).unwrap(),
                    fs::read(entry.path()).unwrap(),
                    "{}",
                    target.display()
                );
            }
        }
    }
    let root = common::temp_dir("tree");
    run(&root, &["install"]);
    compare(Path::new("mods"), &root.join("app/mods"));
    let nested = root.join("app/mods/cache/stale/inner");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join(".hmods"), "metadata").unwrap();
    fs::write(nested.join("old.js"), "old").unwrap();
    run(&root, &["install"]);
    assert_eq!(fs::read(nested.join(".hmods")).unwrap(), b"metadata");
    assert!(!nested.join("old.js").exists());
    fs::remove_dir_all(root).unwrap();
}
