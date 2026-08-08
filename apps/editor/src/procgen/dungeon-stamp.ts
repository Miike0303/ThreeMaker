/**
 * Offline dungeon layout stamp for Maker Studio (Dungeon Alchemist–lite v1).
 *
 * Pure: seed + tile ids → 4 paint layers. Does not touch the catalog or GPU.
 * Walls go on layer 2 (Wall), floor on layer 0 (Ground).
 */

export type DungeonStampOptions = {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Tile id painted on layer 0 for walkable floor. */
  readonly groundTileId: number;
  /** Tile id painted on layer 2 for solid walls. */
  readonly wallTileId: number;
  /** Minimum room size (default 4). */
  readonly minRoomSize?: number;
  /** Maximum room size (default 8). */
  readonly maxRoomSize?: number;
  /** How many rooms to place (default 6). */
  readonly roomCount?: number;
  /** Corridor thickness in tiles (default 1). */
  readonly corridorWidth?: number;
  /** Keep an uncarved ring at the map edge (default false). */
  readonly tightBorder?: boolean;
};

export type DungeonRoom = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type DungeonStampResult = {
  /** Four row-major layers [0..3], length width*height each. */
  readonly layers: readonly [number[], number[], number[], number[]];
  readonly rooms: readonly DungeonRoom[];
  readonly seed: number;
};

/**
 * Prefer the center of the largest room (by area) so playtesting starts in a
 * real chamber, not a corridor or wall. Ties keep the first room in order.
 * When no rooms landed, fall back to the map center (hall carve path).
 */
export function pickMainRoomSpawn(
  rooms: readonly DungeonRoom[],
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  if (rooms.length === 0) {
    return {
      x: Math.min(width - 1, Math.max(0, Math.floor(width / 2))),
      y: Math.min(height - 1, Math.max(0, Math.floor(height / 2))),
    };
  }
  let best = rooms[0]!;
  let bestArea = best.w * best.h;
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]!;
    const area = r.w * r.h;
    if (area > bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return {
    x: best.x + Math.floor(best.w / 2),
    y: best.y + Math.floor(best.h / 2),
  };
}

/** Mulberry32 — deterministic 0..1 from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idx(width: number, x: number, y: number): number {
  return y * width + x;
}

/**
 * Place non-overlapping rooms, carve 1-tile corridors between centers,
 * flood floor + walls into paint layers. Deterministic for a given seed.
 */
export function stampSimpleDungeon(options: DungeonStampOptions): DungeonStampResult {
  const {
    width,
    height,
    seed,
    groundTileId,
    wallTileId,
    minRoomSize = 4,
    maxRoomSize = 8,
    roomCount = 6,
    corridorWidth = 1,
    tightBorder = false,
  } = options;

  if (width < 8 || height < 8) {
    throw new Error(`dungeon stamp needs width/height >= 8, got ${width}x${height}`);
  }
  if (groundTileId === 0 || wallTileId === 0) {
    throw new Error('groundTileId and wallTileId must be non-zero tile ids');
  }
  const corridorHalf = Math.max(0, Math.floor((Math.max(1, corridorWidth) - 1) / 2));
  const border = tightBorder ? 2 : 1;

  const rand = mulberry32(seed);
  const size = width * height;
  const walkable = new Uint8Array(size);

  type Room = { x: number; y: number; w: number; h: number };
  const rooms: Room[] = [];
  const attempts = roomCount * 24;
  const maxW = Math.max(1, width - border * 2);
  const maxH = Math.max(1, height - border * 2);

  for (let i = 0; i < attempts && rooms.length < roomCount; i++) {
    const w = Math.min(
      maxW,
      minRoomSize + Math.floor(rand() * Math.max(1, maxRoomSize - minRoomSize + 1)),
    );
    const h = Math.min(
      maxH,
      minRoomSize + Math.floor(rand() * Math.max(1, maxRoomSize - minRoomSize + 1)),
    );
    const x = border + Math.floor(rand() * Math.max(1, width - w - border * 2));
    const y = border + Math.floor(rand() * Math.max(1, height - h - border * 2));
    const candidate = { x, y, w, h };
    const overlaps = rooms.some(
      (r) =>
        candidate.x < r.x + r.w + 1 &&
        candidate.x + candidate.w + 1 > r.x &&
        candidate.y < r.y + r.h + 1 &&
        candidate.y + candidate.h + 1 > r.y,
    );
    if (overlaps) continue;
    rooms.push(candidate);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        walkable[idx(width, xx, yy)] = 1;
      }
    }
  }

  const carveDisk = (cx: number, cy: number) => {
    for (let dy = -corridorHalf; dy <= corridorHalf; dy++) {
      for (let dx = -corridorHalf; dx <= corridorHalf; dx++) {
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < border || yy < border || xx >= width - border || yy >= height - border) continue;
        walkable[idx(width, xx, yy)] = 1;
      }
    }
  };

  // L-corridors between consecutive room centers (width from preset).
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    if (!a || !b) continue;
    const ax = a.x + Math.floor(a.w / 2);
    const ay = a.y + Math.floor(a.h / 2);
    const bx = b.x + Math.floor(b.w / 2);
    const by = b.y + Math.floor(b.h / 2);
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    for (let xx = x0; xx <= x1; xx++) carveDisk(xx, ay);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    for (let yy = y0; yy <= y1; yy++) carveDisk(bx, yy);
  }

  // If no rooms landed, carve a centered hall so the stamp is never empty.
  if (rooms.length === 0) {
    const margin = Math.max(2, border);
    for (let y = margin; y < height - margin; y++) {
      for (let x = margin; x < width - margin; x++) {
        walkable[idx(width, x, y)] = 1;
      }
    }
  }

  const ground = new Array(size).fill(0);
  const mid = new Array(size).fill(0);
  const wall = new Array(size).fill(0);
  const over = new Array(size).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(width, x, y);
      if (walkable[i]) {
        ground[i] = groundTileId;
        continue;
      }
      // Wall if any 4-neighbor is walkable (edge of rooms/corridors).
      let border = false;
      if (x > 0 && walkable[idx(width, x - 1, y)]) border = true;
      if (x < width - 1 && walkable[idx(width, x + 1, y)]) border = true;
      if (y > 0 && walkable[idx(width, x, y - 1)]) border = true;
      if (y < height - 1 && walkable[idx(width, x, y + 1)]) border = true;
      if (border) {
        ground[i] = groundTileId;
        wall[i] = wallTileId;
      }
    }
  }

  return {
    layers: [ground, mid, wall, over],
    rooms,
    seed,
  };
}
