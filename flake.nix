{
  description = "Herdr mods and companion tools";

  nixConfig = {
    extra-substituters = [ "https://cache.mulatta.io" ];
    extra-trusted-public-keys = [
      "cache.mulatta.io-1:DrV+Oy2azNyVKM7ihhD1QoOetRUnW+1G6RWToUpSO4U="
    ];
    allow-import-from-derivation = false;
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      inherit (nixpkgs) lib;

      eachSystem = lib.genAttrs systems;

      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });

      treefmtEval = eachSystem (system: treefmt-nix.lib.evalModule pkgsFor.${system} ./nix/treefmt.nix);
    in
    {
      packages = eachSystem (system: import ./nix/packages.nix { pkgs = pkgsFor.${system}; });

      checks = eachSystem (
        system:
        self.packages.${system}
        // {
          formatting = treefmtEval.${system}.config.build.check self;
          inherit (self.packages.${system}.hscene.tests) vendor-fresh;
        }
      );

      formatter = eachSystem (system: treefmtEval.${system}.config.build.wrapper);

      devShells = eachSystem (
        system:
        import ./nix/shell.nix {
          pkgs = pkgsFor.${system};
          inherit (self.packages.${system}.hscene) pele;
        }
      );
    };
}
