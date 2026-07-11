import type { ElevationField } from './elevation-field.js';

/**
 * One waypoint along a stair-link's authored path, resolved to the numeric
 * `floors` array index this walker was constructed with (design "stair-link
 * ... waypoints incl. turns"). Mirrors `@threemaker/map-format`'s
 * `StairLinkWaypoint` shape, except `floor` is a plain array index here
 * rather than a stable string id -- this package stays map-format-agnostic
 * (DOM/three-free, GridMover-agnostic), so resolving a `StairLinkDocument`'s
 * string `fromFloor`/`toFloor`/`waypoints[].floor` ids to numeric indices
 * into a `floors` array is the CALLER's job (apps/desktop/src/main.ts).
 */
export interface StairTraversalWaypoint {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

/**
 * One floor's height inputs, exactly the two terms `groundYAt` (apps/desktop)
 * composes into world Y (design: "worldY = (floor.baseElevation +
 * elevation.surfaceHeightAt(fx,fy)) * HEIGHT_UNIT"). `StairTraversal` uses
 * the SAME composed formula for each waypoint's endpoint height, per Slice
 * 5's own note that no new `groundYAt`-adjacent plumbing is needed here --
 * only that this walker's per-segment Y interpolation stays consistent with
 * it.
 */
export interface StairTraversalFloor {
  readonly baseElevation: number;
  readonly elevation: ElevationField;
}

export interface StairTraversalOptions {
  /** Entry-to-landing path, in traversal order; ascend and descend are the SAME link walked with the waypoint array in forward or reversed order (design: "bidirectional ... traversed via the reversed waypoint order"). Must have at least 2 waypoints. */
  readonly waypoints: readonly StairTraversalWaypoint[];
  /** Indexed by each waypoint's `floor`. */
  readonly floors: readonly StairTraversalFloor[];
  /** Tiles/second along the path. Defaults to 4, matching `GridMover`'s own default speed. */
  readonly speed?: number;
  /** World-space height of one region-elevation step; must match the caller's own `HEIGHT_UNIT` (see `groundYAt`). */
  readonly heightUnit: number;
}

/** One frame's worth of the walker's render-position output (design: `activeTraversal.update(dt) -> { x, y, worldY, done }`). */
export interface StairTraversalFrame {
  readonly x: number;
  readonly y: number;
  readonly worldY: number;
  readonly done: boolean;
}

const DEFAULT_SPEED = 4;
// A segment whose two waypoints share the same (x, y) -- a stair authored as
// a straight vertical climb with no footprint shift between floors -- would
// otherwise have zero planar length, which would either divide-by-zero or
// make the floor change instantaneous. Treating it as a nominal 1-tile-long
// segment gives it the same real, non-zero traversal time as any other
// single stair step.
const ZERO_LENGTH_SEGMENT_DISTANCE = 1;

interface Segment {
  readonly from: StairTraversalWaypoint;
  readonly to: StairTraversalWaypoint;
  readonly fromWorldY: number;
  readonly toWorldY: number;
  readonly length: number;
  /** Cumulative path distance at the START of this segment. */
  readonly startDistance: number;
}

function worldYAt(
  waypoint: StairTraversalWaypoint,
  floors: readonly StairTraversalFloor[],
  heightUnit: number,
): number {
  const floor = floors[waypoint.floor];
  if (!floor) {
    throw new Error(
      `StairTraversal: waypoint references floor index ${waypoint.floor}, but only ${floors.length} floor(s) were given.`,
    );
  }
  return (
    (floor.baseElevation + floor.elevation.surfaceHeightAt(waypoint.x, waypoint.y)) * heightUnit
  );
}

/**
 * Pure walker over a stair-link's authored waypoints (design: "a PURE
 * walker: given a stair-link's waypoints + speed, produces the interpolated
 * world position ... frame by frame; turns freely (waypoints, NOT the
 * edge-profile rule -- this is why stairs sidestep the L-turn limitation"),
 * mirroring `GridMover`'s own `update(dt)`-driven interpolation style but
 * over an arbitrary polyline instead of a single tile-to-tile step, and
 * across floors instead of within one. No input handling, no passability
 * checks on interior waypoints, no knowledge of `GridMover`/three.js/DOM --
 * `main.ts`'s render-position handoff owns entry-trigger detection, freezing
 * player input, and the completion-frame `mover.teleport` + `currentFloor`
 * flip (see the design's "Render-position handoff" section); this class only
 * answers "where is the walker on the path right now".
 */
export class StairTraversal {
  private readonly segments: readonly Segment[];
  private readonly totalDistance: number;
  private readonly speed: number;
  private distanceTraveled = 0;

  constructor(options: StairTraversalOptions) {
    if (options.waypoints.length < 2) {
      throw new Error('StairTraversal requires at least 2 waypoints.');
    }
    this.speed = options.speed ?? DEFAULT_SPEED;

    const segments: Segment[] = [];
    let cumulative = 0;
    for (let i = 0; i < options.waypoints.length - 1; i++) {
      const from = options.waypoints[i];
      const to = options.waypoints[i + 1];
      if (!from || !to) continue;
      const planarLength = Math.hypot(to.x - from.x, to.y - from.y);
      const length = planarLength === 0 ? ZERO_LENGTH_SEGMENT_DISTANCE : planarLength;
      segments.push({
        from,
        to,
        fromWorldY: worldYAt(from, options.floors, options.heightUnit),
        toWorldY: worldYAt(to, options.floors, options.heightUnit),
        length,
        startDistance: cumulative,
      });
      cumulative += length;
    }
    this.segments = segments;
    this.totalDistance = cumulative;
  }

  /** Advances the walker by `dt` seconds and returns the resulting frame. Calling this again after `done` is `true` returns the same landing frame -- `done` fires once and stays true (idempotent). */
  update(dt: number): StairTraversalFrame {
    this.distanceTraveled = Math.min(
      this.totalDistance,
      this.distanceTraveled + this.speed * Math.max(0, dt),
    );
    return this.frameAt(this.distanceTraveled);
  }

  private frameAt(distance: number): StairTraversalFrame {
    const done = distance >= this.totalDistance;
    const lastSegment = this.segments[this.segments.length - 1];
    if (done || !lastSegment) {
      const landing = lastSegment?.to ?? this.segments[0]?.from;
      return {
        x: landing?.x ?? 0,
        y: landing?.y ?? 0,
        worldY: lastSegment?.toWorldY ?? 0,
        done: true,
      };
    }

    // Find the segment `distance` currently falls within. Segments are few
    // (a handful of waypoints per stair-link), so a linear scan is simplest
    // and plenty fast.
    let segment = this.segments[0];
    for (const candidate of this.segments) {
      if (distance >= candidate.startDistance) segment = candidate;
    }
    if (!segment) {
      return { x: 0, y: 0, worldY: 0, done: false };
    }

    const localDistance = distance - segment.startDistance;
    const t = segment.length === 0 ? 1 : Math.min(1, localDistance / segment.length);
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t,
      worldY: segment.fromWorldY + (segment.toWorldY - segment.fromWorldY) * t,
      done: false,
    };
  }
}
