// Minimal ambient declarations for the exact Node.js builtins `loadProject`
// needs, kept deliberately narrow instead of pulling in `@types/node` — same
// reasoning as `packages/core/src/global.d.ts` (no extra dev dependency for
// a handful of functions, and this package must stay a thin, auditable data
// parser). Extend this file if a future slice needs more of the Node API.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
}

declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
