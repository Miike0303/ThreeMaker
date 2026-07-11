// Node-only entry: filesystem-walking code that must never end up in a
// browser bundle. Same convention as `@threemaker/importer-rpgm`'s `./node`
// subpath export.
export type {
  GameRecord,
  ScanError,
  ScanErrorCode,
  ScanOptions,
  ScanResult,
} from './scanner.js';
export { scanGames } from './scanner.js';
