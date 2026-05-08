{
  stdenv,
  bun2nix,
  bun,
}:
let
  package = builtins.fromJSON (builtins.readFile ./package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = package.name;
  version = package.version;

  src = ./.;

  nativeBuildInputs = [
    bun2nix.hook
  ];
  buildInputs = [ bun ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  bunBuildFlags = [
    package.module
    "--outfile"
    finalAttrs.pname
    "--target=bun"
    "--minify"
  ];
})
