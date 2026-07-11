// Minimal ambient declarations for the exact Node.js builtins `scanner.ts`
// needs, kept deliberately narrow instead of pulling in `@types/node` — same
// reasoning as `packages/importer-rpgm/src/global.d.ts`. Extend this file if
// a future slice (catalog, object-store, cli) needs more of the Node API.
declare module 'node:fs' {
  export interface Dirent {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
  }

  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function realpathSync(path: string): string;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
}

declare module 'node:crypto' {
  interface Hash {
    update(data: Uint8Array): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
}

// `cli.ts` is a Node-run script (`tsx src/cli.ts`), not a browser-safe
// export, so a minimal `console`/`process` surface is fine here.
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
declare const process: {
  argv: string[];
  exitCode?: number;
};
