// Copies the built renderer (../dist from `npm run build` in the parent project) into ./app.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '..', '..', 'dist');
const dst = path.resolve(__dirname, '..', 'app');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`Renderer build not found at ${src}. Run "npm run build" in the machsim folder first.`);
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
// native dialog texts (single source: src/i18n/desktop-strings.json)
fs.copyFileSync(path.resolve(__dirname, '..', '..', 'src', 'i18n', 'desktop-strings.json'), path.join(dst, 'i18n-desktop.json'));
console.log(`Copied ${src} -> ${dst}`);
