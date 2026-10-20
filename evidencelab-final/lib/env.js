'use strict';

const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function loadLocalEnv(root = path.join(__dirname, '..'), env = process.env) {
  const filename = path.join(root, '.env.local');
  if (!fs.existsSync(filename)) return { loaded: false, keys: [] };
  const values = parseEnv(fs.readFileSync(filename, 'utf8'));
  const keys = [];
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) { env[key] = value; keys.push(key); }
  }
  return { loaded: true, keys };
}

module.exports = { parseEnv, loadLocalEnv };
