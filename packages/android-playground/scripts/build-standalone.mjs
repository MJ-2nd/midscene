#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../node_modules/.pnpm/esbuild@0.23.1/node_modules/esbuild/package.json',
  ),
);
const { build } = require('esbuild');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
const outDir = path.join(pkgDir, 'standalone');

mkdirSync(outDir, { recursive: true });

// ESM banner: provide __dirname / __filename shims for code that uses them,
// and keep import.meta available for code that needs it.
const esmBanner = [
  '#!/usr/bin/env node',
  'import { createRequire as __bundled_createRequire } from "node:module";',
  'import { fileURLToPath as __bundled_fileURLToPath } from "node:url";',
  'import { dirname as __bundled_dirname } from "node:path";',
  'const __filename = __bundled_fileURLToPath(import.meta.url);',
  'const __dirname = __bundled_dirname(__filename);',
  'const require = __bundled_createRequire(import.meta.url);',
].join('\n');

// 1. Bundle bin.ts into a single ESM file
await build({
  entryPoints: [path.join(pkgDir, 'src/bin.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(outDir, 'bin.mjs'),
  format: 'esm',
  banner: { js: esmBanner },
  sourcemap: false,
  minify: false,
});

console.log('Bundle created: standalone/bin.mjs');

// 2. Copy wasm files required at runtime
const wasmSrc = path.resolve(
  pkgDir,
  '../../node_modules/.pnpm/@silvia-odwyer+photon-node@0.3.3/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
);
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, path.join(outDir, 'photon_rs_bg.wasm'));
  console.log('Copied photon_rs_bg.wasm');
} else {
  console.warn('WARNING: photon_rs_bg.wasm not found at expected path');
}

// 3. Copy yadb binary required at runtime for text input.
// The bundled code falls back to looking for bin/yadb relative to bin.mjs.
const androidBinDir = path.resolve(pkgDir, '../android/bin');
const standaloneBinDir = path.join(outDir, 'bin');
mkdirSync(standaloneBinDir, { recursive: true });

for (const binFile of ['yadb', '.yadb-version']) {
  const src = path.join(androidBinDir, binFile);
  if (existsSync(src)) {
    cpSync(src, path.join(standaloneBinDir, binFile));
    console.log(`Copied bin/${binFile}`);
  } else {
    console.warn(`WARNING: bin/${binFile} not found at ${src}`);
  }
}

// 4. Copy static assets alongside the bundle
const staticSrc = path.join(pkgDir, 'static');
const staticDest = path.join(outDir, 'static');

if (existsSync(staticSrc)) {
  if (existsSync(staticDest)) {
    rmSync(staticDest, { recursive: true });
  }
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log('Static files copied to standalone/static/');
} else {
  console.warn(
    '\nWARNING: static/ directory not found. Build the playground app first:\n' +
      '  npx nx build playground\n' +
      'Then re-run this script.\n',
  );
}

console.log(
  '\nDone! Copy the standalone/ folder to the target machine and run:',
);
console.log('  node bin.mjs --manager');
