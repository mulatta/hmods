use std::env;
use std::fmt::Write;
use std::fs;
use std::path::Path;

fn entries(dir: &Path) -> Vec<fs::DirEntry> {
    let mut entries: Vec<_> = fs::read_dir(dir).unwrap().map(Result::unwrap).collect();
    entries.sort_by_key(|entry| entry.file_name());
    entries
}

fn tree(dir: &Path, source: &mut String) {
    let entries = entries(dir);
    source.push_str("Tree { files: &[\n");
    for entry in &entries {
        let kind = entry.file_type().unwrap();
        if kind.is_dir() {
            continue;
        }
        let path = entry.path();
        assert!(kind.is_file(), "expected a real file at {}", path.display());
        writeln!(
            source,
            "({:?}, include_bytes!({path:?})),",
            entry.file_name()
        )
        .unwrap();
    }
    source.push_str("], dirs: &[\n");
    for entry in entries {
        if entry.file_type().unwrap().is_dir() {
            write!(source, "({:?}, ", entry.file_name()).unwrap();
            tree(&entry.path(), source);
            source.push_str("),\n");
        }
    }
    source.push_str("] }");
}

fn main() {
    let mods = Path::new("mods").canonicalize().unwrap();
    println!("cargo:rerun-if-changed=mods");
    let mut source = String::from("const MODS: &[(&str, Tree)] = &[\n");
    for entry in entries(&mods) {
        write!(source, "({:?}, ", entry.file_name()).unwrap();
        tree(&entry.path(), &mut source);
        source.push_str("),\n");
    }
    source.push_str("];\n");
    fs::write(
        Path::new(&env::var_os("OUT_DIR").unwrap()).join("mods.rs"),
        source,
    )
    .unwrap();
}
