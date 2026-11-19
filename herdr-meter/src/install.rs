use serde::Deserialize;
use std::env;
use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::json;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const GENERATED: [&str; 2] = ["gpui-kit.d.ts", "jsconfig.json"];

#[derive(Default)]
struct Tree {
    files: &'static [(&'static str, &'static [u8])],
    dirs: &'static [(&'static str, Tree)],
}

include!(concat!(env!("OUT_DIR"), "/mods.rs"));

#[derive(Deserialize)]
struct Marker {
    tool: String,
    version: String,
    check: String,
}

#[derive(Default)]
pub struct Options {
    app_home: Option<PathBuf>,
    json: bool,
    dry_run: bool,
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn default_path(key: &str, fallback: &str) -> io::Result<PathBuf> {
    env_path(key)
        .or_else(|| env_path("HOME").map(|home| home.join(fallback)))
        .ok_or_else(|| io::Error::other(format!("set {key} or HOME")))
}

impl Options {
    pub fn parse(command: &str, mut args: &[&str]) -> Option<Self> {
        let mut options = Self::default();
        while let Some((arg, rest)) = args.split_first() {
            args = rest;
            match *arg {
                "--app-home" => {
                    let (dir, rest) = args.split_first()?;
                    if dir.is_empty() || dir.starts_with("--") {
                        return None;
                    }
                    options.app_home = Some(PathBuf::from(dir));
                    args = rest;
                }
                arg if arg.starts_with("--app-home=") => {
                    let dir = arg.strip_prefix("--app-home=")?;
                    if dir.is_empty() {
                        return None;
                    }
                    options.app_home = Some(PathBuf::from(dir));
                }
                "--json" if command == "status" => options.json = true,
                "--dry-run" if command != "status" => options.dry_run = true,
                _ => return None,
            }
        }
        Some(options)
    }

    pub fn run(self, command: &str) -> io::Result<()> {
        let home = match self.app_home {
            Some(dir) => dir,
            None => default_path("HERDR_APP_HOME", ".config/herdr-app")?,
        };
        let home = std::path::absolute(home)?;
        let mods = home.join("mods");
        if command == "install" && !self.dry_run {
            fs::create_dir_all(&mods)?;
        }
        // Serialize two installers without putting a lock file in Herdr's watched tree.
        let _lock = if mods.try_exists()? {
            let dir = File::open(&mods)?;
            if command == "status" || self.dry_run {
                dir.lock_shared()?;
            } else {
                dir.lock()?;
            }
            Some(dir)
        } else {
            None
        };
        let mut status = serde_json::Map::new();
        let mut backup_folder = None;
        let mut failed = false;
        for (name, files) in MODS {
            let path = mods.join(name);
            if command == "install" {
                match install(name, files, &home, &path, self.dry_run, &mut backup_folder) {
                    Ok(ok) => failed |= !ok,
                    Err(e) => {
                        eprintln!("{}: {e}", path.display());
                        failed = true;
                    }
                }
                continue;
            }
            let marker = read_marker(&path)?;
            let installed = marker.as_ref().map(|m| m.version.as_str());
            let check = marker.as_ref().map(|m| m.check.as_str());
            match command {
                "status" if self.json => {
                    status.insert(
                        (*name).into(),
                        json!({"installed":installed,"check":check,"package":VERSION,"path":path}),
                    );
                }
                "status" => {
                    if let (Some(v), Some(check)) = (installed, check) {
                        let suffix = if v == VERSION {
                            ""
                        } else {
                            ": outdated, run `hmeter install`"
                        };
                        println!(
                            "{name}  installed {v} (check {check}), package {VERSION}{suffix}"
                        );
                    } else {
                        println!("{name}  not installed");
                    }
                }
                "uninstall" if installed.is_some() => {
                    if !self.dry_run {
                        fs::remove_dir_all(&path)?;
                    }
                    let action = if self.dry_run {
                        "would uninstall"
                    } else {
                        "uninstalled"
                    };
                    println!("{action} {name} → {}", path.display());
                }
                "uninstall" => {
                    let action = if self.dry_run {
                        "would skip"
                    } else {
                        "skipped"
                    };
                    println!("{action} {}: not installed by hmeter", path.display());
                }
                _ => {}
            }
        }
        if self.json {
            println!("{}", json!({"mods":status}));
        }
        if failed {
            Err(io::Error::other("installation failed"))
        } else {
            Ok(())
        }
    }
}

fn metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn read_marker(dir: &Path) -> io::Result<Option<Marker>> {
    if !metadata(dir)?.is_some_and(|m| m.is_dir()) {
        return Ok(None);
    }
    let marker = dir.join(".hmods");
    if !metadata(&marker)?.is_some_and(|m| m.is_file()) {
        return Ok(None);
    }
    Ok(serde_json::from_slice::<Marker>(&fs::read(marker)?)
        .ok()
        .filter(|m| m.tool == "hmeter"))
}

fn backup_folder(dry_run: bool) -> io::Result<PathBuf> {
    let backups =
        std::path::absolute(default_path("XDG_STATE_HOME", ".local/state")?)?.join("hmods/backups");
    let stamp = jiff::Timestamp::now()
        .strftime("%Y%m%dT%H%M%SZ")
        .to_string();
    if !dry_run {
        fs::create_dir_all(&backups)?;
    }
    for index in 1.. {
        let folder = backups.join(if index == 1 {
            stamp.clone()
        } else {
            format!("{stamp}-{index}")
        });
        if dry_run {
            if metadata(&folder)?.is_none() {
                return Ok(folder);
            }
        } else {
            match fs::create_dir(&folder) {
                Ok(()) => return Ok(folder),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }
    unreachable!()
}

fn backup(path: &Path, name: &str, dry_run: bool, folder: &mut Option<PathBuf>) -> io::Result<()> {
    let folder = match folder {
        Some(folder) => folder,
        None => folder.insert(backup_folder(dry_run)?),
    };
    let dest = folder.join(name);
    if !dry_run {
        match fs::rename(path, &dest) {
            Err(e) if e.kind() == ErrorKind::CrossesDevices => {
                if !Command::new("mv")
                    .arg("--")
                    .arg(path)
                    .arg(&dest)
                    .status()?
                    .success()
                {
                    return Err(io::Error::other("backup move failed"));
                }
            }
            result => result?,
        }
    }
    let action = if dry_run { "would move" } else { "moved" };
    println!("{action} {} → {}", path.display(), dest.display());
    Ok(())
}

fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    let path = dir.join(name);
    if let Some(meta) = metadata(&path)? {
        if meta.is_file() && meta.permissions().mode() & 0o200 != 0 && fs::read(&path)? == bytes {
            return Ok(());
        }
        if meta.is_dir() {
            sync(&path, &Tree::default())?;
            fs::remove_dir(&path)?;
        }
    }
    // Herdr can reload on write. Publish only complete files.
    let temp = dir.join(format!(".hmods-tmp-{}", std::process::id()));
    let mut file = File::create_new(&temp)?;
    file.write_all(bytes)?;
    fs::rename(temp, path)
}

fn sync(dir: &Path, files: &Tree) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == ".hmods" || GENERATED.iter().any(|&f| name == f) {
            continue;
        }
        if files.files.iter().any(|&(f, _)| name == f) || files.dirs.iter().any(|&(d, _)| name == d)
        {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            sync(&path, &Tree::default())?;
            if fs::read_dir(&path)?.next().is_none() {
                fs::remove_dir(&path)?;
            }
        } else {
            fs::remove_file(path)?;
        }
    }
    for &(name, bytes) in files.files {
        write_file(dir, name, bytes)?;
    }
    for (name, children) in files.dirs {
        let path = dir.join(name);
        if metadata(&path)?.is_some_and(|m| !m.is_dir()) {
            fs::remove_file(&path)?;
        }
        fs::create_dir_all(&path)?;
        sync(&path, children)?;
    }
    Ok(())
}

fn check(home: &Path, path: &Path) -> &'static str {
    if !super::on_path("herdr-app") {
        return "skipped";
    }
    let result = if let Some(name) = GENERATED.iter().find(|name| path.join(name).is_symlink()) {
        Err(io::Error::other(format!(
            "cannot check with symlink at {name}"
        )))
    } else {
        Command::new("herdr-app")
            .arg("check")
            .arg(path)
            .env("HERDR_APP_HOME", home)
            .output()
    };
    match result {
        Ok(output) if output.status.success() => {
            println!("check passed: {}", path.display());
            "passed"
        }
        other => {
            println!("check failed: {}", path.display());
            match other {
                Ok(output) => {
                    for stream in [&output.stdout, &output.stderr] {
                        for line in String::from_utf8_lossy(stream).lines() {
                            println!("  {line}");
                        }
                    }
                }
                Err(e) => println!("  {e}"),
            }
            "failed"
        }
    }
}

fn install(
    name: &str,
    files: &Tree,
    home: &Path,
    path: &Path,
    dry_run: bool,
    folder: &mut Option<PathBuf>,
) -> io::Result<bool> {
    if read_marker(path)?.is_none()
        && let Some(meta) = metadata(path)?
    {
        if meta.is_symlink() {
            if !dry_run {
                fs::remove_file(path)?;
            }
            let action = if dry_run { "would remove" } else { "removed" };
            println!("{action} link {}", path.display());
        } else {
            backup(path, name, dry_run, folder)?;
        }
    }
    if dry_run {
        println!("would install {name} {VERSION} → {}", path.display());
        return Ok(true);
    }
    fs::create_dir_all(path)?;
    sync(path, files)?;
    let check = check(home, path);
    let marker = json!({"tool":"hmeter","version":VERSION,"check":check});
    write_file(path, ".hmods", marker.to_string().as_bytes())?;
    let suffix = if check == "failed" {
        " (check failed)"
    } else {
        ""
    };
    println!("installed {name} {VERSION} → {}{suffix}", path.display());
    Ok(check != "failed")
}
