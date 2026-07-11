/**
 * Builds Vite dev-server `/@fs/` URLs for files outside the app's own root
 * (the `fixtures/` folder lives at the repo root, two levels above
 * `apps/desktop`). `fixturesDir` is the fixture's absolute path, injected at
 * dev-server start time via the `__FIXTURES_DIR__` define in
 * `vite.config.ts` -- see that file for why this only works in `vite dev`
 * (`server.fs.allow` + `/@fs/` are dev-server-only features, not present in
 * a production build).
 */
export function fixtureJsonUrl(fixturesDir: string, fileName: string): string {
  return `/@fs/${fixturesDir}/${fileName}`;
}

/**
 * Same as `fixtureJsonUrl`, but for a fixture using the genuine RPG Maker MZ
 * project layout (a `data/` subfolder), like `mz-project1` -- unlike
 * `roseliam`'s flat layout, its `MapXXX.json`/`Tilesets.json`/etc. live under
 * `<fixturesDir>/data/`.
 */
export function mzFixtureJsonUrl(fixturesDir: string, fileName: string): string {
  return `/@fs/${fixturesDir}/data/${fileName}`;
}

/** Same as `fixtureJsonUrl`, but for a tileset sheet PNG under `img/tilesets/`. */
export function fixtureImageUrl(fixturesDir: string, sheetName: string): string {
  return `/@fs/${fixturesDir}/img/tilesets/${sheetName}.png`;
}

/** Same as `fixtureImageUrl`, but for a character sheet PNG under `img/characters/`. */
export function fixtureCharacterUrl(fixturesDir: string, sheetName: string): string {
  return `/@fs/${fixturesDir}/img/characters/${sheetName}.png`;
}
