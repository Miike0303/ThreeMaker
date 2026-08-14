import type { ElevationField } from '@threemaker/gameplay';

/** The elevation slice of a floor that light and prop placement needs. */
export interface FloorElevationSource {
  readonly floorId: string;
  readonly baseElevation: number;
  readonly elevation: ElevationField;
}
