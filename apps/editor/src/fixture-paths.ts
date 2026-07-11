/**
 * Builds Vite dev-server `/@fs/` URLs for the mz-project1 fixture (see
 * fixtures/README.md), reused here as the Slice 3 map viewer's bundled
 * fixture map -- the real catalog's `tilesets`/`tileset_sheets` tables
 * aren't populated yet (Slice 4 territory, per design), so there is no
 * catalog-composed map to view. Same convention as
 * apps/desktop/src/fixture-paths.ts (dev-only: `/@fs/` and `server.fs.allow`
 * don't exist in a production build).
 */
export function mzFixtureJsonUrl(fixturesDir: string, fileName: string): string {
  return `/@fs/${fixturesDir}/data/${fileName}`;
}

export function mzFixtureImageUrl(fixturesDir: string, sheetName: string): string {
  return `/@fs/${fixturesDir}/img/tilesets/${sheetName}.png`;
}
