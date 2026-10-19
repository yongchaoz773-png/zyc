'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

function copyTree(source, destination) {
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) {
    fs.copyFileSync(source, destination);
    return;
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    copyTree(path.join(source, entry), path.join(destination, entry));
  }
}

if (path.dirname(dist) !== root) throw new Error('Unsafe build target');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const entry of ['api', 'data', 'lib', 'public', 'server.js', 'package.json', 'package-lock.json', 'vercel.json', '.env.example']) {
  copyTree(path.join(root, entry), path.join(dist, entry));
}
const manifest = { name: 'EvidenceLab', builtAt: new Date().toISOString(), node: process.version, mode: 'historical-public-snapshot' };
fs.writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Production bundle created: ${dist}`);
