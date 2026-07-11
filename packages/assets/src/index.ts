// Browser-safe entry: pure parsers/transforms only. Node-only code (scanning
// the filesystem, decrypting on-disk assets) lives at the `./node` subpath
// export so importing this package never drags `node:fs` into a browser
// bundle — same convention as `@threemaker/importer-rpgm`.
export type { DecryptErrorCode } from './decrypt.js';
export { DecryptError, decryptRpgmv, parseEncryptionKey } from './decrypt.js';
