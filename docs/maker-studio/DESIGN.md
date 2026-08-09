# Design: Maker Studio (UX + 2.5D layers + procgen + community)

**Date:** 2026-08-08  
**Status:** active implementation guide  
**Product:** Maker Studio (engine brand: ThreeMaker)

## One-line outcome

A game-studio shell where authors paint multi-layer 2.5D maps, generate layouts from catalog tiles (Dungeon Alchemist–style), and optionally share assets to a community pipeline — without losing the create→play loop.

## Quick path

1. Fix session-killing UX bugs (workspace unmount, named layers).
2. Ship Layers panel (Ground / Mid / Wall / Over) + tool→inspector routing.
3. Add offline procgen that paints a `MapDocument` from catalog tile IDs.
4. Design community upload as opt-out product surface (no server required for v0 flags).

## Key decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Layer model | Keep 4 paint layers + multi-floor elevation | Flatten to single layer; pure 3D freeplace | Matches RPGM authoring + existing schema; 2.5D needs both paint order and world Y |
| Layer UX names | Ground / Mid / Wall / Over (ids 0–3) | Numbers only; free-form N layers | Recognition over recall; schema stays `0|1|2|3` |
| Procgen v1 | Pure layout + stamp catalog tiles | Full AI pixel generation | Catalog already holds user tiles; Imagine is for missing fills, not layout |
| Community default | Opt-out flag on save (`shareWithCommunity: true` default in settings) | Always local; always forced upload | User request; legal: never auto-upload third-party RPGM copyright packs without explicit OK |
| Workspace Map/Assets | Keep both mounted; CSS hide inactive | Unmount inactive | Unmount destroyed PainterViewport + unsaved session — critical bug |
| Design artifact language | English | Spanish | Project technical default |

## Architecture (target)

```
Maker Studio shell
├── Map workspace (always mounted when app open)
│   ├── Tool rail (paint + entity tools)
│   ├── Viewport (floors × 4 tile layers + overlays)
│   └── Inspector: Map | Paint(Layers) | Events | Ink | Entities
├── Assets workspace
│   └── Catalog + preview
└── Future: Procgen panel → packages/procgen → MapDocument
    Future: community-client (queue) → remote API
```

### Procgen (v1)

- Input: seed, size, biome preset, `tileset` slots from catalog (or current map slots).
- Algorithm: BSP or room-graph → corridors → paint ground on layer 0, walls on layer 2 + semantic `wall`, doors as openings.
- Output: `MapDocument` via `createBlankMapDocument` + layer writes; load into painter.
- Non-goal v1: AI room decoration, multi-floor stacks, full Ink stories.

### Community (v0 product surface only)

- Settings: `community.shareOnSave` boolean (default true in product spec; store localStorage).
- On save: if true, enqueue `{ mapId, version, tileObjectShas[], licenseTag }` — no network until API exists.
- Hard rule: assets with provenance `import-rpgm` require `community.allowImportedAssets` (default false).

## File impact (implementation order)

| Unit | Files | Goal |
|---|---|---|
| WU-UX-01 | `App.tsx`, `editor.css` | Keep Map workspace mounted |
| WU-UX-02 | `PainterPanel.tsx`, locales | Named layers panel + auto-tab |
| WU-UX-03 | locales, CSS | Status polish, focus rings, empty states |
| WU-PROC-01 | `packages/procgen` (new) or `apps/editor/src/procgen` | Pure dungeon stamp tests |
| WU-COMM-01 | settings store + save hook | Opt-out flag + enqueue stub |

## UX principles (cognitive-doc-design + studio norms)

- Lead with canvas; inspector is secondary.
- Named layers and floors always visible when map ready.
- Tool selection opens the matching inspector tab (npc→Entities, brush→Paint).
- Never discard unsaved map when browsing Assets.
- Progressive disclosure: advanced fill tile id stays advanced.

## Open questions

- [ ] Community legal default for mixed catalogs (user-owned vs imported RPGM).
- [x] Procgen lives in editor `src/procgen` for v1 (promote to package when desktop/MCP need it).
- [ ] Whether Imagine ingest is in-studio or CLI-only for v1.

## Implemented (loop log)

- WU-UX-01 keep Map mounted; named layers; tool→inspector
- WU-PROC-01 stampSimpleDungeon + Generate dungeon
- WU-COMM-01 settings + opt-out toggles + offline enqueue
- WU-PROC-02 seed field + tile-pick heuristics + preserve narrative on stamp
- WU-PROC-03 presets dungeon/house/cave + wall tile picker (brush/auto/override)
- WU-PROC-04 place spawn in largest room on Generate (`pickMainRoomSpawn`)
- WU-PROC-05 stamp tags wall tile ids `semantics.class=wall`; tile-pick prefers wall-classed tiles
- WU-PROC-06 door openings at room edges; optional mid door tile from door-class semantics + `semantics.class=door`
- WU-PROC-07 door tile picker (id / brush / auto) + success status shows door count
- WU-UX-03 empty states (no map / no events) + focus rings; community offline queue + status badge
- WU-COMM-02 clear offline share queue; procgen pipeline regression test (stamp→apply spawn/doors/semantics)
- WU-PROC-08 palette dock roles brush/wall/door — click catalog swatch sets fill or procgen overrides
- WU-UX-04 workspace mount contract tests + fix Assets `display:flex` overriding inactive hide

## PR Plan

1. **fix(editor): keep map workspace mounted when browsing assets**
2. **feat(editor): named paint layers panel + tool→inspector routing**
3. **feat(procgen): pure dungeon layout → MapDocument stamp**
4. **feat(editor): community share preference + save enqueue stub**
5. **feat(editor): procgen panel in Maker Studio**

## Testing strategy

| Layer | What |
|---|---|
| Unit | Layer labels pure map; procgen determinism by seed; share-flag persistence |
| Integration | create → switch Assets → return → map still loaded |
| Manual | Layer rename visibility, tool tab switch, save blocked on invalid events |
