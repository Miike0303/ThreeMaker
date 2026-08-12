# Three Maker positioning

**Product:** Three Maker (HD-2D studio)  
**Look:** open-source **2.5D HD-2D** (Octopath-style), not voxel 3D.

## vs RPG-Cobo

| | RPG-Cobo | ThreeMaker / Maker Studio |
| --- | --- | --- |
| Visual language | High-res **voxels**, block assembly | **Tiles + billboard sprites**, extruded depth, DoF |
| Content entry | Native voxel library | **Import-first RPG Maker MV/MZ** + catalog |
| Logic | No-code event editor + full DB suite | Form-first `EventCommand` + Ink; thin game-defs |
| Stack | Sakana + voxengine | Three.js + Tauri editor |
| Pitch | “RPG Maker for 3D voxels” | “RPG Maker for HD-2D / Octopath” |

**Do not adopt:** voxel engine, Sakana, their native runtime.  
**Do adopt as product patterns:** create → generate → dress → play funnel; procgen presets with immediate edit; quiet professional studio chrome; optional AI localization later.

## Studio UI principles

1. **Lead with canvas** — chrome recedes; Map status lives in `.ide-status` only.  
2. **One-row toolbars** — menubar and inspector tabs scroll horizontally, never wrap into form dumps.  
3. **Quiet controls** — accent only for active/primary; secondary actions stay transparent.  
4. **Assets is a library** — import as a slim path toolbar; list + preview with empty state.  
5. **Keep-mounted workspaces** — Map and Assets stay mounted; visibility is CSS + `inert` only.

## Ideas borrowed for speed (mapped)

| Cobo-like idea | ThreeMaker home |
| --- | --- |
| Procgen presets (world/cave/dungeon) | `apps/editor/src/procgen/*` + inspector Procgen tab |
| Fast map start | `new-map-wizard` → optional next: “Generate after create” |
| Event list UI | `CommandForm` / `event-form-helpers` (expand cmds later) |
| Asset browser | Catalog tab + thumbs + honest import summary |
| Clean editor chrome | `editor.css` tokens + shell classes (`app-shell-map`) |

## Explicit non-goals

- Voxel/GI block worlds  
- Full JRPG battle DB as a prerequisite for map shipping  
- Re-export back to RPG Maker  
