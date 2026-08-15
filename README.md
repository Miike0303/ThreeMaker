# ThreeMaker

An open-source 2.5D (HD-2D) narrative game engine built on [Three.js](https://threejs.org/), with map/tileset importing from RPG Maker MV/MZ projects.

**Status: playable engine, authoring studio in progress.** The create → play loop closes today: you can paint a multi-floor map in the editor, place NPCs with branching Ink dialogue, save it, and walk/talk/collect/transfer/save in the desktop runtime. Distribution works for desktop (unsigned) and static web.

Not yet: code signing, mobile, pathfinding, combat.

## Goals

- HD-2D aesthetic (Octopath Traveler style): extruded tile maps, billboard sprites, depth-of-field post-processing.
- Branching narrative via [Ink](https://www.inklestudios.com/ink/), with a synchronized text + graph visual editor.
- Multi-genre core: JRPG, roguelike, dungeon crawler — genre is never hardcoded in the engine.
- Import maps, tilesets, and character sprites from RPG Maker MV/MZ projects. Import-first: nothing is ever exported back to RPG Maker.
- Usable without programming (visual editor) and fully extensible (plugins + MCP server).

## Plugins

Genre-specific verbs stay out of the engine. A plugin owns one authored command
type end to end — how it parses out of a map's `events`, and what it does at
runtime — and registers on a `CommandRegistry` shared by the parser and the
interpreter:

```ts
import { CommandRegistry } from '@threemaker/core';

const plugins = new CommandRegistry();
plugins.register({
  type: 'startBattle',
  parse(value, path) {
    if (typeof value.troopId !== 'string') throw new Error(`${path} needs a string "troopId".`);
    return { type: 'startBattle', troopId: value.troopId };
  },
  run(command, ctx) {
    openBattleScene(command.troopId as string, ctx.done);
    return 'wait'; // or 'continue' to run the next command immediately
  },
});
```

Pass that same registry to `parseMapDocument(json, plugins)` and to the
`EventInterpreter` — parsing with it and interpreting without it yields
commands nothing can execute. A plugin may not claim a builtin command type
(`BUILTIN_COMMAND_TYPES`); registration throws instead of silently shadowing.

The runtime's own audio verbs (`playSound`, `playBgm`, `stopBgm`) are built
this way rather than as builtins — see `apps/desktop/src/audio.ts`.

## Structure

```
packages/
  core/            Headless: node tree, typed signal bus, game loop, event-command
                   interpreter, command-plugin registry, world state, world clock
                   (no DOM, no Three.js)
  gameplay/        Grid movement, terrain passability, elevation, stairs, NPC
                   registry, triggers, inventory, stats
  narrative/       Ink compile + dialogue provider + world-state binding, and the
                   knot-graph model the editor draws
  renderer/        Three.js tile geometry: chunk building, autotiles, walls,
                   materials, streaming, floor-visibility policies
  map-format/      Versioned .tmmap schema (v6) with migrations, undo/redo diffs
  save/            Versioned game-save schema (v2) with migrations
  input/           Remappable logical actions over keyboard, gamepad, pointer
  assets/          SQLite asset catalog with content-addressed dedup, RPG Maker
                   decryption, tileset ingest (+ CLI)
  importer-rpgm/   RPG Maker MV/MZ project parser → typed model → MapDocument
apps/
  desktop/         Tauri 2 game runtime: Three.js WebGPURenderer (WebGL2
                   fallback), HD-2D post-processing, lights, props, weather,
                   day-night, dialogue UI, save/load
  editor/          Tauri 2 authoring studio: tile painter, layers, floors,
                   entity tools, events forms, Ink text+graph, procgen, catalog
  mcp-server/      stdio MCP adapter: open_project, list_maps, create_map,
                   get/set_world_state, add_event, edit_dialogue, save_project
```

The game runtime currently lives in `apps/desktop`, not in `packages/renderer` — camera, post-processing, lights and glTF props are wired there. `packages/` holds the libraries it composes.

## Development

Requires Node >= 20, pnpm >= 10, and the Rust toolchain (for the Tauri shells).

```sh
pnpm install
pnpm test                        # all workspace tests (vitest)
pnpm typecheck                   # project-wide tsc -b
pnpm lint                        # biome check
pnpm --filter editor tauri dev   # authoring studio
pnpm --filter desktop tauri dev  # game runtime
```

Building a map needs an asset catalog first:

```sh
pnpm --filter @threemaker/assets catalog "path/to/your/RPGM/games"
pnpm --filter @threemaker/assets ingest-tilesets
```

Importer tests run against a local RPG Maker project fixture that is not distributed with this repository (third-party copyrighted data) — see `fixtures/README.md` after running the fixture setup. Tests that need it fail with instructions if it is missing.

## License

[MIT](LICENSE)
