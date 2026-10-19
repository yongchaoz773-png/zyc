'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testFiles = fs.readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join('tests', name));

if (!testFiles.length) throw new Error('没有找到 *.test.js 测试文件。');

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit'
});
process.exit(result.status === null ? 1 : result.status);
