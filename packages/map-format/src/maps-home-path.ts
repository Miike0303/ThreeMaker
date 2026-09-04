/**
 * Home-relative maps directory shared by editor save, desktop Play, the
 * vite map API, and web-export path stripping — so Play and Studio cannot
 * disagree on where authored maps live.
 */

import { MAP_DOCUMENT_FILE_SUFFIX } from './ink-sidecar-path.js';

/** Directory under `BaseDirectory.Home` that holds named map documents. */
export const MAP_DIR_RELATIVE = '.threemaker/maps';

/** Stem of the legacy single-file working map (still a valid named map). */
export const LEGACY_MAP_NAME = 'current';

/** Home-relative path of the legacy working map document. */
export const LEGACY_MAP_FILE_RELATIVE =
  `${MAP_DIR_RELATIVE}/${LEGACY_MAP_NAME}${MAP_DOCUMENT_FILE_SUFFIX}` as const;
