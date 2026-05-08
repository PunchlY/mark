{
  description = "Bun2Nix minimal sample";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default";

    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.inputs.systems.follows = "systems";

    bun.url = "github:aster-void/bunnix";
    bun.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs: let
    eachSystem = inputs.nixpkgs.lib.genAttrs (import inputs.systems);

    pkgsFor = eachSystem (system:
      import inputs.nixpkgs {
        inherit system;
        overlays = [
          inputs.bun2nix.overlays.default
          (final: prev: {
            bun = inputs.bun.packages.${system}.default;
          })
        ];
      });
  in {
    packages = eachSystem (system: {
      default = pkgsFor.${system}.callPackage ./default.nix {};
    });

    devShells = eachSystem (system: {
      default = pkgsFor.${system}.mkShell {
        packages = with pkgsFor.${system}; [
          bashInteractive
          bun
          bun2nix
        ];

        shellHook = ''
          bun install --frozen-lockfile
        '';
      };
    });
  };
}
