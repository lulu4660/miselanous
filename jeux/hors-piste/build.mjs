// Bundles src/ into a single self-contained page (dist/index.html) for the Artifact,
// plus dist/play.html (same page wrapped in a full document) for opening locally.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
// Only the bare 'three' module is loaded from the CDN; three/examples addons and other npm
// libraries are bundled (their own `import 'three'` is redirected to the same CDN URL).
const threeFromCdn = {
  name: 'three-cdn',
  setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: THREE_URL, external: true })); },
};
const res = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', write: false, minify: true,
  plugins: [threeFromCdn], target: ['es2020', 'safari15'], legalComments: 'none',
});
let js = res.outputFiles[0].text;
if (/from\s*"three"/.test(js) || /import\("three"\)/.test(js)) throw new Error('unresolved three import');
js = js.replace(/<\/script/gi, '<\\/script');
const tpl = readFileSync('src/template.html', 'utf8');
const page = tpl.replace('<!--BUNDLE-->', () => `<script type="module">${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', page);
writeFileSync('dist/play.html', `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n</head>\n<body>\n${page}\n</body>\n</html>\n`);
console.log(`dist/index.html ${(page.length / 1024).toFixed(1)} KB (bundle ${(js.length / 1024).toFixed(1)} KB)`);
