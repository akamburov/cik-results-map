/**
 * serve.mjs — tiny zero-dependency static file server for previewing the site.
 *
 * Run:   node scripts/serve.mjs [port]
 * Defaults to port 8000 → http://localhost:8000
 *
 * GitHub Pages is the real host; this just lets you preview locally. Node
 * built-ins only (http + fs) — nothing to install.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // repo root
const PORT = Number(process.argv[2] ?? 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// index.html loads the bundled app.min.js (app.js + app-core.js + the vendored
// Leaflet.markercluster, all minified). Warn if it is missing or older than its
// source inputs, so local preview doesn't silently show stale code.
async function warnIfBundlesStale() {
  const min = join(ROOT, 'app.min.js');
  const sources = ['app.js', 'app-core.js'];
  try {
    const minStat = await stat(min);
    for (const src of sources) {
      const srcStat = await stat(join(ROOT, src));
      if (srcStat.mtimeMs > minStat.mtimeMs) {
        console.warn(`[serve] warning: app.min.js is older than ${src} — run:\n` +
          '  node scripts/minify.mjs app.js');
      }
    }
  } catch {
    console.warn('[serve] warning: app.min.js is missing — index.html loads it, so the\n' +
      '  page will fail. Run: node scripts/minify.mjs app.js');
  }
  await warnIfCssStale();
}

// index.html links the minified stylesheet; same staleness check as the JS.
async function warnIfCssStale() {
  const cssMin = join(ROOT, 'style.min.css');
  try {
    const minStat = await stat(cssMin);
    const srcStat = await stat(join(ROOT, 'style.css'));
    if (srcStat.mtimeMs > minStat.mtimeMs) {
      console.warn('[serve] warning: style.min.css is older than style.css — run:\n' +
        '  node scripts/minify.mjs style.css');
    }
  } catch {
    console.warn('[serve] warning: style.min.css is missing — index.html links it, so\n' +
      '  the page renders unstyled. Run: node scripts/minify.mjs style.css');
  }
}

warnIfBundlesStale().finally(() => {
  createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/') pathname = '/index.html';

    // basic path-traversal guard
    const file = normalize(join(ROOT, pathname));
    if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { code: 403 });

    let target = file;
    try {
      if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
    } catch { /* fall through to read below */ }

    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    const code = err && err.code === 403 ? 403 : 404;
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(code === 403 ? 'Forbidden' : 'Not found');
  }
  }).listen(PORT, () => {
    console.log(`[serve] http://localhost:${PORT}  (repo root: ${ROOT})`);
  });
});
