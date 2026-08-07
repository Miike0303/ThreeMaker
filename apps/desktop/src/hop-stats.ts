/**
 * Counters for map hops (G-cycle / transferMap). Pure so vitest can drive
 * them without a browser. PLAN_DEV_2 C1 exit wants hop GPU disposal
 * "debug-panel verifiable" — these numbers feed that readout.
 */

export type HopStats = {
  readonly hopsCompleted: number;
  /** NPC sprite meshes on the map that was disposed at the last hop. */
  readonly lastOutgoingNarrativeSprites: number;
  /** Floor texture keys disposed with the outgoing map at the last hop. */
  readonly lastOutgoingFloorTextureKeys: number;
  /** Prop instances disposed with the outgoing map at the last hop (C5). */
  readonly lastOutgoingPropInstances: number;
  /** Distinct prop glTF assets disposed with the outgoing map at the last hop (C5). */
  readonly lastOutgoingPropAssets: number;
  /** Authored light instances disposed with the outgoing map at the last hop (C6). */
  readonly lastOutgoingLights: number;
};

export function createHopStats(): HopStats {
  return {
    hopsCompleted: 0,
    lastOutgoingNarrativeSprites: 0,
    lastOutgoingFloorTextureKeys: 0,
    lastOutgoingPropInstances: 0,
    lastOutgoingPropAssets: 0,
    lastOutgoingLights: 0,
  };
}

export function recordHopCompleted(
  stats: HopStats,
  outgoing: {
    readonly outgoingNarrativeSprites: number;
    readonly outgoingFloorTextureKeys: number;
    readonly outgoingPropInstances?: number;
    readonly outgoingPropAssets?: number;
    readonly outgoingLights?: number;
  },
): HopStats {
  return {
    hopsCompleted: stats.hopsCompleted + 1,
    lastOutgoingNarrativeSprites: outgoing.outgoingNarrativeSprites,
    lastOutgoingFloorTextureKeys: outgoing.outgoingFloorTextureKeys,
    lastOutgoingPropInstances: outgoing.outgoingPropInstances ?? 0,
    lastOutgoingPropAssets: outgoing.outgoingPropAssets ?? 0,
    lastOutgoingLights: outgoing.outgoingLights ?? 0,
  };
}
