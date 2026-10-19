# GitHub 与 Vercel 发布步骤

## 专项审计结论

- 当前项目可以按现有代码直接导入 Vercel：`public/` 是静态前端，`api/health.js`、`api/analyze.js`、`api/compare.js`、`api/followup.js` 是四个独立 Node.js Functions。
- `server.js` 是本地及通用 Node 主机的长驻 HTTP 入口，Vercel 不启动它；四个函数直接复用 `lib/`，没有把 API 静态化。
- `npm run build` 会生成可独立启动的 `dist/` 便携包。它是构建/交付检查，不是 Vercel Build Output API；Vercel 的静态 Output Directory 是 `public`，函数仍从根目录 `api/` 构建。
- 已移除无必要的 `.js` 路由重写和错误的内置运行时写法 `nodejs20.x`。`package.json` 固定 Node.js `24.x`；`vercel.json` 固定 Other、`public`、20 秒函数上限，并显式将 `data/**` 放入函数包。
- 前端只同源访问 `/api/*`，因此无需开放跨域，也没有设置宽泛的 `Access-Control-Allow-Origin`。若未来拆分前后端域名，需按允许域名新增 CORS 与 `OPTIONS` 处理，不能直接使用 `*` 搭配敏感接口。
- 可选 OpenAI 请求的代码超时为 12 秒，函数上限为 20 秒；未配置密钥时只运行确定性规则引擎。当前历史快照模式不需要生产环境变量。
- 应用层拒绝超过 100KB、畸形 JSON 和非对象 JSON；API 统一返回 JSON 错误。无客户端 History 路由，因此不需要 SPA catch-all 回退，避免覆盖 `/api/*`。
- 本地 Node.js 24.11.0 与 20.18.0 均已完成 31/31 自动化测试及生产构建；Node.js 24 本地 HTTP 复测覆盖首页与四个 API。这些结果不是线上验证。
- Vercel CLI 64.5.0 可运行，但读取到的令牌无效，`vercel build --yes` 在加载团队阶段终止；没有部署、没有公开 Web URL，也没有伪造线上结果。

相关平台约定以 Vercel 官方文档为准：

- Node.js Functions 与 `/api` 自动路由：<https://vercel.com/docs/functions/runtimes/node-js>
- 支持的 Node.js 版本与 `engines.node`：<https://vercel.com/docs/functions/runtimes/node-js/node-js-versions>
- `functions.includeFiles` / `maxDuration`：<https://vercel.com/docs/project-configuration/vercel-json>
- Other 预设与 `public` 输出目录：<https://vercel.com/docs/builds/configure-a-build>

## 最终配置基线

在 Vercel 导入页采用以下值；项目文件已固定同样的设置，建议关闭网页 Override，避免控制台值覆盖仓库配置。

| 配置项 | 值 |
|---|---|
| Framework Preset | `Other` |
| Root Directory | `./`（仓库根目录） |
| Install Command | 默认，等价于 `npm install` |
| Build Command | `npm run build` |
| Output Directory | `public` |
| Node.js Version | `24.x` |
| Functions | 根目录 `api/*.js`，自动映射到 `/api/<文件名>` |
| Function Max Duration | `20` 秒 |
| Environment Variables | 快照模式为空；不要上传 `.env` |

不要把 Output Directory 改成 `dist`。这样会混淆 Vercel 的源码函数发现流程；当前 `dist/` 的用途是通用 Node 部署包。

## 创建 GitHub 仓库

1. 登录 <https://github.com/new>。
2. Repository name 填 `evidencelab`，Description 可填 `Traceable investment thesis verification workbench`。
3. 选择 `Public`。
4. 不勾选 Add a README、Add .gitignore、Choose a license，避免与本地提交冲突。
5. 点击 Create repository。
6. 如需让本地提交关联到你的 GitHub 账号，先设置真实身份并重写作者（可选）：

```powershell
git config user.name "你的 GitHub 显示名"
git config user.email "你的 GitHub 验证邮箱"
git rebase --root --exec "git commit --amend --no-edit --reset-author"
```

7. 在本项目目录执行 GitHub 页面显示的 HTTPS 命令：

```powershell
git remote add origin https://github.com/<你的用户名>/evidencelab.git
git push -u origin main
```

8. 打开真实仓库页面，确认 README、`api/`、`public/`、`tests/`、`docs/` 可见，且 `.env`、`dist/`、`.vercel/` 和 ZIP 不在仓库中。

## 通过 Vercel 网页部署

1. 登录 Vercel Dashboard，选择 Add New → Project。
2. 连接 GitHub 并导入刚创建的 `evidencelab`。
3. 核对上表配置；不要将本地 `dist` 设为 Output Directory。
4. 快照模式不添加环境变量。如启用可选模型，只在 Project Settings → Environment Variables 添加合法的 `OPENAI_API_KEY` 和可选 `OPENAI_MODEL`，不要使用 `NEXT_PUBLIC_`/`VITE_` 前缀暴露密钥。
5. 点击 Deploy。只有部署成功且完成下述验收后，才能把 Vercel 分配的 HTTPS 地址写成公开 Web URL。

如选择 CLI，当前阻塞是本机保存的 Vercel 令牌无效。最短恢复步骤是先由你完成登录与项目关联，再做平台构建；这些命令会访问/变更你的 Vercel 账号，本次未代为执行：

```powershell
npx vercel login
npx vercel link
npx vercel pull --yes --environment=production
npx vercel build
npx vercel deploy --prebuilt --prod
```

如果只想先确认平台构建，到 `npx vercel build` 成功即可暂不执行最后一行。

## 部署后验收

先把 `$deployedBaseUrl` 换成 Vercel 给出的真实 HTTPS 地址：

```powershell
$deployedBaseUrl = 'https://<真实项目域名>'
curl.exe -I "$deployedBaseUrl/"
curl.exe "$deployedBaseUrl/api/health"

$analysisBody = @{
  claim = '宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。'
  company = '300750.SZ'
} | ConvertTo-Json -Compress
Invoke-RestMethod "$deployedBaseUrl/api/analyze" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($analysisBody))

Invoke-RestMethod "$deployedBaseUrl/api/compare"

$followupBody = @{ question = '投资收益是否影响利润归因？' } | ConvertTo-Json -Compress
Invoke-RestMethod "$deployedBaseUrl/api/followup" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($followupBody))
```

验收标准：`/` 为 200；health 的 `status=ok`、`dataFreshness=non-real-time`；analyze 返回 `schemaVersion=2`、8 条证据、1 条冲突；compare 返回 4 项指标；followup 引用 `O1/O2/S2/S3`。随后在浏览器验证默认命题、证据切换、来源链接、冲突、跨期比较、追问、保存/恢复、异常演练、导出及移动端布局。

## 何时改用其他平台

当前应用无 WebSocket、常驻内存任务、后台队列或本地持久磁盘依赖，Vercel Functions 适合现有架构。若未来必须让 `server.js` 长驻、维护连接或运行后台监测，应改用支持常驻 Node 进程的平台（如 Render、Railway 或 Fly.io），启动命令为 `npm start`，并另外配置持久数据库/队列；这类需求不应硬塞进短生命周期 Function。
