{ pkgs }:

let
  inherit (pkgs) lib;
  root = ../.;

  meter = root + "/herdr-meter";
  cargo = (lib.importTOML (meter + "/Cargo.toml")).package;
  scene = root + "/herdr-scene";
  manifest = lib.importJSON (scene + "/package.json");
  pele = pkgs.fetchFromGitHub (
    {
      owner = "mulatta";
      repo = "pele";
    }
    // lib.importJSON (scene + "/pele.json")
  );
  sceneBuild = pkgs.stdenvNoCC.mkDerivation {
    pname = "hscene-build";
    inherit (manifest) version;

    src = lib.fileset.toSource {
      root = scene;
      fileset = lib.fileset.unions [
        (lib.fileset.difference (scene + "/mods") (scene + "/mods/mermaid/vendor"))
        (scene + "/manual")
        (scene + "/skills")
        (scene + "/bench/stubs")
        (scene + "/bench/theme.js")
        (scene + "/cli")
        (scene + "/package.json")
        (scene + "/pele.json")
        (scene + "/scripts")
        (scene + "/src")
        (scene + "/tests")
      ];
    };

    PELE_SRC = pele;
    nativeBuildInputs = with pkgs; [
      esbuild
      nodejs
      git
    ];

    buildPhase = ''
      runHook preBuild
      bash scripts/build.sh mods/mermaid/vendor
      runHook postBuild
    '';

    doCheck = true;
    checkPhase = ''
      runHook preCheck
      node --test tests/*.test.mjs
      runHook postCheck
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -R mods skills manual build/hscene.mjs "$out/"
      runHook postInstall
    '';
  };

in
{
  hmeter = pkgs.rustPlatform.buildRustPackage {
    pname = cargo.name;
    inherit (cargo) version;

    src = lib.fileset.toSource {
      root = meter;
      fileset = lib.fileset.unions [
        (meter + "/mods")
        (meter + "/build.rs")
        (meter + "/Cargo.toml")
        (meter + "/Cargo.lock")
        (meter + "/src")
        (meter + "/tests")
      ];
    };

    cargoLock.lockFile = meter + "/Cargo.lock";
    nativeCheckInputs = [ pkgs.ps ];

    postInstall = ''
      mkdir -p "$out/share/pi"
      cp -R ${meter + "/pi"} "$out/share/pi/herdr-meter"
    '';

    meta = {
      inherit (cargo) description;
      license = lib.licenses.mit;
      mainProgram = cargo.name;
    };
  };

  hscene =
    pkgs.runCommand "hscene-${manifest.version}"
      {
        inherit (manifest) version;
        nativeBuildInputs = [
          pkgs.makeWrapper
          pkgs.installAgentSkills
        ];
        passthru.pele = pele;
        passthru.tests.vendor-fresh = pkgs.runCommand "vendor-fresh" { } ''
          diff -r ${scene}/mods/mermaid/vendor ${sceneBuild}/mods/mermaid/vendor
          touch "$out"
        '';
        meta = {
          license = lib.licenses.mit;
          mainProgram = "hscene";
        };
      }
      ''
        mkdir -p "$out/lib" "$out/bin"
        cp -R ${sceneBuild} "$out/lib/hscene"
        makeWrapper ${lib.getExe pkgs.nodejs} "$out/bin/hscene" \
          --add-flags "$out/lib/hscene/hscene.mjs" \
          --suffix PATH : ${lib.makeBinPath [ pkgs.git ]}
        installSkill ${sceneBuild}/skills/herdr-scene hscene
      '';
}
