{ pkgs, pele }:
{
  default = pkgs.mkShell {
    PELE_SRC = pele;
    packages = with pkgs; [
      nodejs
      esbuild
      cargo
      rustc
      shellcheck
    ];
  };
}
