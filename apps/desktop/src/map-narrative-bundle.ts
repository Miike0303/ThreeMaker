/**
 * The PER-MAP half of the desktop narrative runtime (C1a spec R6, design D1):
 * this map's compiled Ink stories, dialogue provider, `EventInterpreter`,
 * floor-scoped `NpcRegistry`/`TriggerIndex` and NPC sprites. All of it is
 * rebuilt on a map swap and torn down by `dispose()`. The SESSION-scoped half
 * (`WorldState`, seeds, overlay) is `narrative-root.ts`, whose doc comment
 * carries the rationale for the split.
 *
 * Two boundaries this module must not cross:
 * - it never constructs a `WorldState` -- it uses `root.world`, and seeds it
 *   BEFORE compiling/binding any story, since `bindStoryToWorld`'s `world_get`
 *   hard-throws on a key the world does not hold yet (`story-runtime.ts`);
 * - session inventory/stats also come from `root` (not constructed here) so
 *   map hops keep the same stores on the interpreter and ink externals;
 * - `dispose()` owns exactly the NPC sheet textures loaded here and the meshes
 *   added to the scene. FLOOR textures are disposed by the swap sequence's own
 *   `disposeFloorTextures`; a second path over them would double-free.
 */

import type { DialogueProvider, DialogueSource, DialogueStep, EventHost } from '@threemaker/core';
import { EventInterpreter, PlainTextDialogueProvider } from '@threemaker/core';
import type { Direction, NpcDefinition, RoutineStop } from '@threemaker/gameplay';
import { NpcRegistry, routinePositionAt, TriggerIndex } from '@threemaker/gameplay';
import type { MapEventScripts } from '@threemaker/map-format';
import { bindStoryToWorld, compileInk, InkDialogueProvider } from '@threemaker/narrative';
import { groundYAt } from '@threemaker/renderer';
import type * as THREE from 'three/webgpu';
import type { AuthoredMapNarrative } from './authored-map.js';
import { CharacterSprite, DEFAULT_SHEET_COLUMNS, DEFAULT_SHEET_ROWS } from './character-sprite.js';
import { buildPlaceholderCharacterTexture } from './character-sprite-placeholder.js';
import type { FloorGameplay } from './floor-runtime.js';
import type { NarrativeRoot } from './narrative-root.js';

/** One NPC that actually moved (or re-faced) during {@link MapNarrativeBundle.applyRoutines}. */
export interface RoutineMove {
  readonly npcId: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly groundY: number;
  };
}

/**
 * One authored routine, coordinate-translated once at bundle build (same
 * floor-index domain as the NPC base pose). `spriteIndex` indexes
 * {@link MapNarrativeBundle.sprites} (authored order).
 */
interface RoutineBinding {
  readonly npcId: string;
  readonly base: RoutineStop;
  readonly routine: readonly RoutineStop[];
  readonly spriteIndex: number;
  readonly floor: number;
  currentX: number;
  currentY: number;
  currentFacing: Direction;
}

/** One compiled, already-bound Ink story. Spelled via `compileInk`'s return type because `inkjs` is `@threemaker/narrative`'s dependency, not this app's. */
type CompiledStory = ReturnType<typeof compileInk>;

/**
 * Routes a `showDialogue` command to the backend its source kind needs. The v4
 * schema accepts BOTH `{kind:'ink'}` and `{kind:'text'}` sources, so an
 * ink-only provider makes every authored text source a dead event: `open()`
 * throws, the interpreter aborts the script (`script:failed`) and the lines are
 * never presented. A dispatch over the closed two-member `DialogueSource`
 * union, not a facade -- both backends already exist and neither wraps the other.
 */
class MapDialogueProvider implements DialogueProvider {
  private readonly ink: InkDialogueProvider;
  private readonly text = new PlainTextDialogueProvider();
  private active: DialogueProvider | null = null;

  constructor(stories: ReadonlyMap<string, CompiledStory>) {
    this.ink = new InkDialogueProvider(stories);
  }

  open(source: DialogueSource): void {
    const backend = source.kind === 'ink' ? this.ink : this.text;
    // Selected only AFTER `open` succeeds, so a rejected source cannot leave a
    // half-opened backend as the active one for the next `next()` call.
    backend.open(source);
    this.active = backend;
  }

  next(): DialogueStep {
    return this.require('next()').next();
  }

  choose(index: number): void {
    this.require('choose()').choose(index);
  }

  private require(callerLabel: string): DialogueProvider {
    if (this.active === null) {
      throw new Error(`MapDialogueProvider: ${callerLabel} called before open().`);
    }
    return this.active;
  }
}

export interface MapNarrativeBundleDeps {
  /**
   * This map's cross-validated authored narrative (`AuthoredMapResult.narrative`);
   * floors are already resolved to runtime INDICES. `undefined` for a map that
   * authors none, which yields NO bundle at all (spec R5) -- the key stays
   * required so a caller cannot forget to forward it.
   */
  readonly narrative: AuthoredMapNarrative | undefined;
  /** The session-scoped root. Its `world` is the ONLY world this bundle uses. */
  readonly root: NarrativeRoot;
  /** App-supplied movement/teleport effects for the interpreter. */
  readonly host: EventHost;
  /** Scene the NPC billboards are added to, and removed from on `dispose()`. */
  readonly scene: {
    add(object: THREE.Object3D): void;
    remove(object: THREE.Object3D): void;
  };
  /** The session's floors, indexed by floor INDEX (`session.floorRouter.floors`) -- each NPC's sprite Y is sampled from its OWN floor. */
  readonly floors: readonly Pick<FloorGameplay, 'elevation' | 'baseElevation'>[];
  /** Tile and floor the player arrives on, so an `enter` trigger the player merely spawns on top of does not fire (design D1's `initialTile`). */
  readonly arrival: { readonly x: number; readonly y: number; readonly floor: number };
  /** Resolves one NPC sheet's `object` sha256 to a texture. Called once per DISTINCT sha; a rejection degrades that sheet to a placeholder. */
  readonly resolveObjectTexture: (sha256: string) => Promise<{ readonly texture: THREE.Texture }>;
  /** Must match the tilemap's own `tileWorldSize`. */
  readonly tileWorldSize: number;
  /** Must match the renderer's `heightUnit`, so sprites line up with the ground they stand on. */
  readonly heightUnit: number;
  /**
   * Session clock minutes-of-day used for the initial routine application at
   * build (evening boot / night hop must land NPCs at evening stops, not base).
   * Defaults to `0` when omitted.
   */
  readonly minutes?: number;
}

export interface MapNarrativeBundle {
  readonly interpreter: EventInterpreter;
  readonly npcRegistry: NpcRegistry;
  readonly triggerIndex: TriggerIndex;
  /** This map's event scripts, for routing an NPC's `onInteract` or a trigger's `event` to `interpreter.run`. */
  readonly events: MapEventScripts;
  /**
   * The live NPC billboards, in authored order. An ARRAY, not a map keyed by
   * `npc.id`: `schema.ts` rejects duplicate NPC *tiles* but not duplicate
   * *ids*, so an id-keyed map would silently drop a reference to a sprite still
   * in the scene -- exactly the never-disposed leak spec R7 closes. No caller
   * needs sprite-by-id lookup; they face these at the camera and dispose them.
   */
  readonly sprites: readonly CharacterSprite[];
  /**
   * Place every routined NPC at `routinePositionAt(base, routine, minutes)`.
   * When the resolved stop differs from the live registry pose: `moveNpc`,
   * sprite tile + facing. Returns only NPCs that actually moved (for light
   * follow). Absolute resolution — safe to call after a dialogue-gated skip
   * (the next call self-heals to the correct stop). Idempotent for a given
   * minute. NPCs without routines cost nothing.
   */
  applyRoutines(minutes: number): readonly RoutineMove[];
  /** Removes and frees everything this bundle owns. Idempotent. */
  dispose(): void;
}

/**
 * Crossed-minute seam used by main.ts: skip routine teleports while dialogue
 * or a cutscene holds the interpreter. `routinePositionAt` is absolute (not
 * incremental), so the next idle crossed-minute application self-heals — no
 * missed minutes to replay.
 */
export function applyRoutinesIfIdle(
  bundle: Pick<MapNarrativeBundle, 'interpreter' | 'applyRoutines'>,
  minutes: number,
): readonly RoutineMove[] {
  if (bundle.interpreter.state !== 'idle') return [];
  return bundle.applyRoutines(minutes);
}

/**
 * Loads one NPC sheet, degrading to the in-memory placeholder sheet on any
 * failure -- W1's fail-soft convention (`authored-map.ts`'s per-slot texture
 * resolution, `main.ts`'s player sheet): one unreadable sheet makes one NPC
 * visibly wrong, never aborts the load. Either way the texture was created
 * here, so the bundle owns and disposes it.
 */
async function loadSheet(sha256: string, deps: MapNarrativeBundleDeps): Promise<THREE.Texture> {
  try {
    return (await deps.resolveObjectTexture(sha256)).texture;
  } catch (error) {
    console.error(
      `map-narrative-bundle: NPC sheet object ${sha256} is missing or unreadable; using the placeholder sprite sheet.`,
      error,
    );
    return buildPlaceholderCharacterTexture();
  }
}

/** World-space ground Y of `(x, y)` on floor INDEX `floor` -- the NPC's own floor, never the floor the player happens to be on. */
function npcGroundY(floor: number, x: number, y: number, deps: MapNarrativeBundleDeps): number {
  const target = deps.floors[floor];
  if (!target) {
    throw new Error(
      `map-narrative-bundle: no floor at index ${floor} (have ${deps.floors.length} floor(s)).`,
    );
  }
  return groundYAt(target.elevation, x, y, deps.heightUnit, target.baseElevation);
}

/**
 * Builds this map's narrative runtime over the session's narrative root, or
 * returns `undefined` when the map authors no narrative at all -- spec R5: such
 * a map gets no interpreter, no registries and no sprites, and behaves exactly
 * as it did before this change. Returning the decision instead of leaving it to
 * an `if` at the (untested) `main.ts` call site is what makes R5 assertable.
 *
 * Throws for a floor reference the session cannot satisfy: `NpcRegistry`/
 * `TriggerIndex` run `assertFloorIndex` over every entry, and this is the one
 * boundary an unresolved `.tmmap` floor id could actually reach -- failing here
 * is what stops it from keying every lookup to an unmatchable tile.
 */
export async function buildMapNarrativeBundle(
  deps: MapNarrativeBundleDeps,
): Promise<MapNarrativeBundle | undefined> {
  const { narrative, root } = deps;
  if (!narrative) return undefined;

  // BEFORE compile/bind: an ink `world_get` on an unseeded key hard-throws.
  root.seedIfAbsent(narrative.worldSeeds);

  const stories = new Map<string, CompiledStory>();
  for (const [storyId, source] of narrative.inkSources) {
    const story = compileInk(source);
    // Session stores from the root: same instances across map hops (C4).
    bindStoryToWorld(story, {
      storyId,
      world: root.world,
      items: root.inventory,
      stats: root.stats,
    });
    stories.set(storyId, story);
  }

  const interpreter = new EventInterpreter({
    world: root.world,
    host: deps.host,
    provider: new MapDialogueProvider(stories),
    items: root.inventory,
    stats: root.stats,
  });

  // Bridges the document's content-addressed sheet ref to `NpcDefinition`'s
  // sheet/index addressing; the registry itself never reads `sprite`.
  const npcs: readonly NpcDefinition[] = narrative.npcs.map((npc) => ({
    id: npc.id,
    x: npc.x,
    y: npc.y,
    floor: npc.floor,
    facing: npc.facing,
    sprite: { sheet: npc.sprite.object, index: npc.sprite.characterIndex },
    onInteract: npc.onInteract,
  }));
  const npcRegistry = new NpcRegistry(npcs);
  const triggerIndex = new TriggerIndex(narrative.triggers, deps.arrival);

  // Deduped by sha WITHIN this map, so two NPCs on one sheet decode it once.
  // These are the only textures `dispose()` frees.
  const sheets = new Map<string, THREE.Texture>();
  await Promise.all(
    [...new Set(narrative.npcs.map((npc) => npc.sprite.object))].map(async (sha256) => {
      sheets.set(sha256, await loadSheet(sha256, deps));
    }),
  );

  const sprites: CharacterSprite[] = [];
  try {
    for (const npc of narrative.npcs) {
      const texture = sheets.get(npc.sprite.object);
      if (!texture) throw new Error(`map-narrative-bundle: unresolved sheet ${npc.sprite.object}.`);
      // Resolved BEFORE the sprite is constructed: this is the one call in the
      // loop that can throw on authored data (`npcGroundY`, a floor index past
      // `deps.floors`), so doing it first keeps the failure from allocating a
      // mesh it would only have to free again.
      const groundY = npcGroundY(npc.floor, npc.x, npc.y, deps);
      const sprite = new CharacterSprite({
        texture,
        // Design D5: NPC sheets use the standard 4x2 character-block layout, the
        // same one `main.ts` builds the player sprite with.
        sheetColumns: DEFAULT_SHEET_COLUMNS,
        sheetRows: DEFAULT_SHEET_ROWS,
        characterIndex: npc.sprite.characterIndex,
        tileWorldSize: deps.tileWorldSize,
      });
      // Tracked the instant it exists, so the cleanup below reaches it even if
      // the very next statement is what throws.
      sprites.push(sprite);
      sprite.setFrame(npc.facing, 1);
      sprite.setTilePosition(npc.x, npc.y, deps.tileWorldSize, groundY);
      deps.scene.add(sprite.mesh);
    }
  } catch (error) {
    // Partial construction is NOT recoverable, but it is still ours to clean up:
    // `dispose()` only exists on the bundle object below, which a throw here
    // never returns, so every mesh already in the shared scene and every sheet
    // texture already decoded would leak with no handle left to free them (spec
    // R7's leak, reached by construction instead of by a missed swap). Frees
    // exactly what this function allocated -- never `deps.scene`'s other
    // content, never the floor textures -- then rethrows unchanged so the
    // caller still sees the real diagnostic.
    for (const sprite of sprites) {
      deps.scene.remove(sprite.mesh);
      sprite.dispose();
    }
    for (const texture of sheets.values()) texture.dispose();
    sheets.clear();
    throw error;
  }

  // Translate document routines ONCE (same coordinate domain as NPC base:
  // runtime floor index, tile x/y). Only NPCs that author a routine bind.
  const routineBindings: RoutineBinding[] = [];
  for (let spriteIndex = 0; spriteIndex < narrative.npcs.length; spriteIndex++) {
    const npc = narrative.npcs[spriteIndex];
    if (!npc?.routine || npc.routine.length === 0) continue;
    const base: RoutineStop = { at: 0, x: npc.x, y: npc.y, facing: npc.facing };
    const routine: readonly RoutineStop[] = npc.routine.map((stop) => ({
      at: stop.at,
      x: stop.x,
      y: stop.y,
      facing: stop.facing,
    }));
    routineBindings.push({
      npcId: npc.id,
      base,
      routine,
      spriteIndex,
      floor: npc.floor,
      currentX: npc.x,
      currentY: npc.y,
      currentFacing: npc.facing,
    });
  }

  let disposed = false;

  function applyRoutines(minutes: number): readonly RoutineMove[] {
    if (disposed) return [];
    const moved: RoutineMove[] = [];
    for (const binding of routineBindings) {
      const stop = routinePositionAt(binding.base, binding.routine, minutes);
      if (
        stop.x === binding.currentX &&
        stop.y === binding.currentY &&
        stop.facing === binding.currentFacing
      ) {
        continue;
      }
      npcRegistry.moveNpc(binding.npcId, stop.x, stop.y, stop.facing);
      const groundY = npcGroundY(binding.floor, stop.x, stop.y, deps);
      const sprite = sprites[binding.spriteIndex];
      if (!sprite) {
        throw new Error(
          `map-narrative-bundle: applyRoutines missing sprite at index ${binding.spriteIndex} for npc ${JSON.stringify(binding.npcId)}.`,
        );
      }
      sprite.setTilePosition(stop.x, stop.y, deps.tileWorldSize, groundY);
      sprite.setFrame(stop.facing, 1);
      binding.currentX = stop.x;
      binding.currentY = stop.y;
      binding.currentFacing = stop.facing;
      moved.push({
        npcId: binding.npcId,
        position: { x: stop.x, y: stop.y, groundY },
      });
    }
    return moved;
  }

  // Evening boot / night hop: land at the CURRENT minute's stop, not base.
  applyRoutines(deps.minutes ?? 0);

  return {
    interpreter,
    npcRegistry,
    triggerIndex,
    events: narrative.events,
    sprites,
    applyRoutines,

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sprite of sprites) {
        deps.scene.remove(sprite.mesh);
        sprite.dispose();
      }
      // One entry per distinct sha, so each owned sheet is disposed exactly
      // once. Floor textures are never in here (see this module's doc comment).
      for (const texture of sheets.values()) texture.dispose();
      sheets.clear();
    },
  };
}
