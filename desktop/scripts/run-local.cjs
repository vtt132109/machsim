// Runs the desktop app for development/testing.
// Drive D:\ on this machine carries an AppContainer ACL that makes Electron refuse to start from it,
// so the Electron runtime is copied once to %LOCALAPPDATA%\MachSim-dev\electron and launched from there.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const srcDist = path.dirname(require('electron'));
const target = path.join(process.env.LOCALAPPDATA || require('node:os').tmpdir(), 'MachSim-dev', 'electron');
const stamp = path.join(target, '.version');
const version = require('electron/package.json').version;
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== version) {
  console.log(`Copying Electron ${version} runtime to ${target} ...`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(srcDist, target, { recursive: true });
  fs.writeFileSync(stamp, version);
}
const args = [path.resolve(__dirname, '..'), ...process.argv.slice(2)];
const child = spawn(path.join(target, 'electron.exe'), args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
