import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Vite prints the port wrapped in ANSI bold ("localhost:<ESC>[1m1421<ESC>[22m/"),
// so a naive /:\d+/ match never fires. NO_COLOR asks it to stop, and stripping
// is the belt to that suspenders -- whether a piped child gets colored depends on
// the parent environment, and a check that only passes under some shells is worse
// than no check at all. Built from a string so the ESC byte never appears as a
// control character inside a regex literal (biome noControlCharactersInRegex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function startDev() {
  return new Promise((resolveUrl, reject) => {
    const child = spawn('pnpm', ['--filter', 'editor', 'dev'], {
      cwd: ROOT,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let buf = '';
    let timer;
    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    const onData = (chunk) => {
      buf += String(chunk).replace(ANSI, '');
      const m = buf.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/);
      if (m) settle(resolveUrl, { child, url: m[0] });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => settle(reject, error));
    child.on('exit', (code) => settle(reject, new Error(`dev server exited ${code}: ${buf}`)));
    timer = setTimeout(() => settle(reject, new Error(`dev server timeout: ${buf}`)), 60_000);
  });
}

function stop(child) {
  if (!child?.pid) return;
  // pnpm spawns vite as a grandchild, so the whole tree has to go (/T), and the
  // kill must be SYNCHRONOUS: vite holds port 1421 with strictPort, so an
  // orphaned server makes the very next run fail with "port already in use".
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
  // Detach the pipes: their open handles keep this process's event loop alive
  // long after the check has printed its verdict.
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

/**
 * Asserts the painter is really drawing.
 *
 * Screenshotting the canvas does NOT work here, and that is worth spelling out
 * because it looks like it does: `WebGPURenderer` defaults to `alpha: true`, so
 * an unrendered surface is transparent and Playwright captures the page behind
 * it -- plenty of non-uniform pixels, check passes, render dead. Verified by
 * stubbing out the `renderer.render` call: the pixel version stayed green.
 *
 * Draw calls come from the renderer itself, so they cannot be faked by the DOM.
 */
function assertPainted(stats) {
  if (!stats) {
    throw new Error('window.__threemaker_painter_debug is missing (not a DEV build?)');
  }
  if (!stats.ready) throw new Error('WebGPURenderer never finished init()');
  if (stats.drawCalls < 1) {
    throw new Error(`painter issued no draw calls (triangles=${stats.triangles})`);
  }
}

let child;
let browser;
try {
  const started = await startDev();
  child = started.child;
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${started.url}/?webgl=1`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('.painter-viewport-canvas canvas');
  await canvas.waitFor({ timeout: 30_000 });
  const openBtn = page.getByRole('button', { name: 'Open' }).first();
  if ((await openBtn.count()) === 0)
    throw new Error('no saved map to open; painter stayed on welcome');
  await openBtn.click();
  await page.locator('.ide-welcome').waitFor({ state: 'detached', timeout: 60_000 });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() => window.__threemaker_painter_debug?.() ?? null);
  assertPainted(stats);
  console.log(`PAINTER CANVAS OK (drawCalls=${stats.drawCalls} triangles=${stats.triangles})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop(child);
  // A smoke script's job is done the moment it has a verdict. Exit on it rather
  // than waiting for a stray handle to let the event loop drain.
  process.exit(process.exitCode ?? 0);
}
