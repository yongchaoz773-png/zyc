'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const requiredApiRoutes = ['health', 'analyze', 'compare', 'followup', 'financial-data', 'auth', 'tasks'];
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (config.framework !== null) throw new Error('Vercel Framework Preset 必须固定为 Other (null)。');
if (config.buildCommand !== 'npm run build') throw new Error('Vercel Build Command 与审计配置不一致。');
if (config.outputDirectory !== 'public') throw new Error('Vercel 静态输出目录必须为 public。');
if (config.rewrites) throw new Error('api/ 路由由 Vercel 自动映射，不应添加 .js 重写。');
if (pkg.engines.node !== '24.x') throw new Error('Vercel Node.js 大版本必须固定为 24.x。');

const functionConfig = config.functions && config.functions['api/*.js'];
if (!functionConfig) throw new Error('缺少 api/*.js 的函数配置。');
if (functionConfig.runtime) throw new Error('内置 Node.js 版本不应写成自定义 runtime。');
if (functionConfig.includeFiles !== 'data/**') throw new Error('函数包必须显式包含历史快照 data/**。');
if (functionConfig.maxDuration < 15) throw new Error('函数超时必须覆盖 12 秒的可选模型请求。');

for (const route of requiredApiRoutes) {
  const file = path.join(root, 'api', `${route}.js`);
  if (!fs.existsSync(file)) throw new Error(`缺少 Vercel Function: api/${route}.js`);
  if (typeof require(file) !== 'function') throw new Error(`api/${route}.js 未导出请求处理函数。`);
  if (fs.readFileSync(file, 'utf8').includes('.listen(')) throw new Error(`api/${route}.js 不得启动长驻 HTTP 服务。`);
}

for (const required of ['public/index.html', 'public/app.js', 'public/styles.css', 'data/evidence.json']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`缺少部署文件: ${required}`);
}

console.log(`Vercel compatibility checks passed (${requiredApiRoutes.length} Functions, public output, Node 24.x, data bundle, 20s limit).`);
