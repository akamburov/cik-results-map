/**
 * minify.mjs — bundle + minify this repo's JS with esbuild, fetched on demand
 * via `npx` (no committed dependency: no package.json, no node_modules).
 *
 * Run:   node scripts/minify.mjs <entry.js> [<entry.js> ...] [--out <dir>] [-- <esbuild args>]
 *
 * Writes <name>.min.js next to each entry (or into <dir> when --out is given).
 *
 * esbuild resolves the import graph, so a single entry (`app.js`) becomes one
 * self-contained `app.min.js` with `app-core.js` and the vendored
 * Leaflet.markercluster inlined. `leaflet` is kept external (`--external`) so
 * the importmap in index.html still resolves it from the CDN. This replaces the
 * old terser + import-rewrite approach: bundling also minifies the previously
 * unminified vendored code, cutting the payload roughly in half.
 *
 * Anything after `--` is passed straight through to esbuild.
 *
 * The first run downloads esbuild into the npx cache (needs network); later
 * runs reuse it. For a pinned/repeatable build, install it yourself
 * (`npm i -g esbuild`) or add it as a devDependency — the repo intentionally
 * does neither.
 */
import { readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const USAGE = `Usage:
  node scripts/minify.mjs <entry.js|style.css> [...] [--out <dir>] [-- <esbuild args>]

Bundles + minifies each <entry.js> with esbuild (via npx, on demand) into
<name>.min.js next to the source file, or into <dir> when --out is given.
--external:leaflet is applied by default so the importmap still resolves it.
<name>.css entries are minified (not bundled, keeps <link>s simple) into
<name>.min.css. Extra args after "--" are forwarded to esbuild.`;

function runEsbuild(args, opts = {}) {
  try {
    execFileSync('npx', ['--yes', 'esbuild', ...args], {
      stdio: opts.quiet ? 'ignore' : 'inherit',
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error('\n[npx not found] esbuild is fetched via npx. Install Node/npm, or\n' +
        'install esbuild globally (`npm i -g esbuild`) and re-run.\n');
    } else {
      console.error('\n[esbuild failed] Could not bundle. Check the output above; the\n' +
        'first run needs network access to download esbuild into the npx cache.\n');
    }
    process.exit(1);
  }
}

const minNameFor = (base) => {
  if (base.endsWith('.js')) return `${base.slice(0, -3)}.min.js`;
  if (base.endsWith('.css')) return `${base.slice(0, -4)}.min.css`;
  return `${base}.min.css`;
};

// esbuild's --metafile lists every source file the bundle pulled in, so summing
// their bytes gives an honest "before" (the unminified total) to compare the
// single bundle against. Returns null if the metafile can't be produced.
async function sourceBytesFromMetafile(dest) {
  const metaPath = `${dest}.meta.json`;
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    return Object.values(meta.inputs || {}).reduce((sum, i) => sum + (i.bytes || 0), 0);
  } catch {
    return null;
  } finally {
    try { await unlink(metaPath); } catch { /* already gone */ }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let outDir = null;

  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const passthrough = sep === -1 ? [] : argv.slice(sep + 1);

  for (let i = 0; i < own.length; i += 1) {
    if (own[i] === '--out') { outDir = own[++i] || ''; continue; }
    if (own[i].startsWith('-')) {
      console.error(`Unknown option: ${own[i]}\n\n${USAGE}`);
      process.exit(1);
    }
    files.push(own[i]);
  }
  if (!files.length) { console.error(USAGE); process.exit(1); }

  // Fail once up front with a clear message if npx isn't available at all.
  runEsbuild(['--version'], { quiet: true });

  for (const file of files) {
    const abs = resolve(file);
    const base = basename(abs);
    const dest = outDir ? resolve(outDir, minNameFor(base)) : resolve(dirname(abs), minNameFor(base));

    // JS entries are bundled (ESM, leaflet external); CSS entries are simply
    // minified in place — esbuild strips comments/whitespace from stylesheets
    // the same way. No bundling for CSS: index.html <link>s stay as-is.
    const isCss = base.endsWith('.css');
    const args = [abs, '--minify'];
    if (!isCss) args.push('--bundle', '--format=esm', '--external:leaflet');
    args.push(`--metafile=${dest}.meta.json`, `--outfile=${dest}`, ...passthrough);
    runEsbuild(args);

    const after = (await stat(dest)).size;
    const before = await sourceBytesFromMetafile(dest);
    const pct = before ? Math.round((1 - after / before) * 100) : 0;
    const detail = pct ? ` (${before} B source -> ${after} B, ${pct}% smaller)` : ` (${after} B)`;
    console.log(`${base} -> ${dest}${detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
