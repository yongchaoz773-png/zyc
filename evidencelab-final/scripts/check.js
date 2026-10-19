'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const directories = ['api', 'lib', 'public', 'scripts', 'tests'];
const jsFiles = directories.flatMap(dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => path.join(root, dir, entry.name)));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
for (const required of ['claim-form', 'subquestion-list', 'evidence-list', 'followup-form', 'task-count']) {
  if (!html.includes(`id="${required}"`)) throw new Error(`HTML 缺少关键节点 ${required}`);
}
console.log(`Static checks passed (${jsFiles.length} JavaScript files, 5 required UI anchors).`);
