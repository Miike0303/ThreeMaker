# ThreeMaker

An open-source 2.5D (HD-2D) narrative game engine built on [Three.js](https://threejs.org/), with map/tileset importing from RPG Maker MV/MZ projects.

**Status: early development (Phase 1 of 6).** See `PLAN_DEV_1.MD` for the roadmap and `ARQUIT_2.MD` for the architecture (currently in Spanish).

## Goals

- HD-2D aesthetic (Octopath Traveler style): extruded tile maps, billboard sprites, depth-of-field post-processing.
- Branching narrative via [Ink](https://www.inklestudios.com/ink/), with a synchronized text + graph visual editor.
- Multi-genre core: JRPG, roguelike, dungeon crawler — genre is never hardcoded in the engine.
- Import maps, tilesets, and character sprites from RPG Maker MV/MZ projects.
- Usable without programming (visual editor) and fully extensible (plugins + MCP server).

## Structure

```
packages/
  core/            Headless engine core: node tree, typed signal bus, game loop (no DOM, no Three.js)
  importer-rpgm/   RPG Maker MV/MZ project parser (typed intermediate model)
apps/
  desktop/         Tauri 2 shell rendering with Three.js WebGPURenderer (WebGL2 fallback)
```

## Development

Requires Node >= 24, pnpm >= 10, and the Rust toolchain (for the Tauri shell).

```sh
pnpm install
pnpm test                        # run all workspace tests
pnpm lint                        # biome check
pnpm --filter desktop tauri dev  # launch the desktop shell
```

Importer tests run against a local RPG Maker project fixture that is not distributed with this repository (third-party copyrighted data) — see `fixtures/README.md` after running the fixture setup. Tests that need it fail with instructions if it is missing.

## License

[MIT](LICENSE)
