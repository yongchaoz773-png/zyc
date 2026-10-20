# GitHub 与 Vercel 发布步骤

## 专项审计结论

- 当前项目可以按现有代码直接导入 Vercel：`public/` 是静态前端，根目录 `api/` 下七个文件分别是 Node.js Functions，包括金融数据、认证和任务接口。
- `server.js` 是本地及通用 Node 主机的长驻 HTTP 入口，Vercel 不启动它；七个函数直接复用 `lib/`，没有把 API 静态化。
- `npm run build` 会生成可独立启动的 `dist/` 便携包。它是构建/交付检查，不是 Vercel Build Output API；Vercel 的静态 Output Directory 是 `public`，函数仍从根目录 `api/` 构建。
- 已移除无必要的 `.js` 路由重写和错误的内置运行时写法 `nodejs20.x`。`package.json` 固定 Node.js `24.x`；`vercel.json` 固定 Other、`public`、20 秒函数上限，并显式将 `data/**` 放入函数包。
- 前端只同源访问 `/api/*`，因此无需开放跨域，也没有设置宽泛的 `Access-Control-Allow-Origin`。若未来拆分前后端域名，需按允许域名新增 CORS 与 `OPTIONS` 处理，不能直接使用 `*` 搭配敏感接口。
- DeepSeek 只由 `/api/analyze` 服务端 Function 调用；单次请求默认超时 6.5 秒，一次分析的模型总时限为 16 秒，至多重试一次可重试错误，低于函数 20 秒上限。未配置密钥或调用失败时只运行确定性规则引擎。
- `scripts/build.js` 不再把 `.env.example` 当成生产构建必需文件：模板存在时复制到通用 `dist/`，部署上下文缺失时打印提示并继续。因此先前 Vercel 日志中的 `.env.example ENOENT` 已从代码路径消除；模板本身也已提交且不含真实密钥。
- 应用层拒绝超过 100KB、畸形 JSON 和非对象 JSON；API 统一返回 JSON 错误。无客户端 History 路由，因此不需要 SPA catch-all 回退，避免覆盖 `/api/*`。
- 本轮 Node.js 24.11.0 与 20.18.0 均已完成 68/68 自动化测试及生产构建。这些结果不是 Vercel 线上验证、有效 DeepSeek Key 调用或真实 Supabase 数据库联调证明。
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
| Environment Variables | 规则/本地模式可为空；DeepSeek 与 Supabase 云端模式见下表；不要上传 `.env` |

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
4. 如启用 DeepSeek，只在 Project Settings → Environment Variables 添加下列服务端变量，不要使用 `NEXT_PUBLIC_`/`VITE_` 前缀：

| 变量 | Vercel 值 |
|---|---|
| `DEEPSEEK_API_KEY` | 你的真实密钥（Secret，不写入仓库） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `DEEPSEEK_TIMEOUT_MS` | 可选，默认 `6500` |
| `DEEPSEEK_TOTAL_TIMEOUT_MS` | 可选，默认 `16000` |

DeepSeek 官方在 2026-07-24 停用了 `deepseek-chat` / `deepseek-reasoner` 旧名称，因此此处使用当前 Chat Completions 模型 `deepseek-flash`。接口仍为 `POST /chat/completions`，并使用 `response_format={"type":"json_object"}`。
5. 如启用跨浏览器任务同步，先完成下节 Supabase 初始化，再添加 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和可选 `SUPABASE_TIMEOUT_MS=6000`。不要把 `sb_secret_*`、legacy `service_role` 或数据库密码放入项目。
6. 点击 Deploy。只有部署成功且完成下述验收后，才能把 Vercel 分配的 HTTPS 地址写成公开 Web URL。

## Supabase 初始化与回滚

1. 在 Supabase 创建项目；Auth → Providers 中保留 Email/Password。生产环境建议启用邮箱确认，并把真实 Vercel HTTPS 域名加入 Auth URL Configuration。
2. 在 SQL Editor 完整执行 `supabase/migrations/001_research_tasks.sql`。脚本可重复执行建表/索引/策略部分，并创建 `research_tasks` 表、更新时间触发器、授权和 owner-only RLS。
3. 在项目 Connect / API Keys 页面复制 Project URL 和 publishable key，分别配置为 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`。publishable key 不是数据授权边界；用户 JWT 与 RLS 才决定可访问行。
4. 如安装并关联 Supabase CLI，可在隔离环境执行 `supabase test db` 运行 `supabase/tests/research_tasks_rls.test.sql`。当前工作区未安装/关联 CLI，因此该 pgTAP 文件未实际执行。
5. 需要彻底回滚本功能时，先导出数据，再在 SQL Editor 审核并执行 `supabase/rollback/001_research_tasks.down.sql`。该操作删除任务表及其数据，不应在未备份的生产库直接执行。

表结构将 `user_id、client_task_id、claim、company、期间、metric_keys、status、schema_version、version、时间戳` 独立成列；子问题、证据、来源、结论、模型状态、规则结果、数据快照和完整任务使用各自 JSONB。唯一键 `(user_id, client_task_id)` 用于本地导入去重，数据库 `version` 用于乐观锁。

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

Invoke-RestMethod "$deployedBaseUrl/api/financial-data?company=300750.SZ"

$followupBody = @{ question = '投资收益是否影响利润归因？' } | ConvertTo-Json -Compress
Invoke-RestMethod "$deployedBaseUrl/api/followup" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($followupBody))
```

验收标准：`/` 为 200；health 的 `status=ok`、`dataFreshness=non-real-time`，且 health 只能显示配置/运行时记录，不能仅凭环境变量宣称外部服务已连接。financial-data 应返回 18 个快照事实，`structuredOnlineData=false`。实际提交一次 analyze 后，只有返回 `mode=deepseek+rules`、`llmStatus.connection=verified-this-request`、`semanticPlan`，才说明该请求真正收到合格模型响应。

云端同步必须另做真实验收：浏览器 A 注册/登录并保存任务，刷新后仍存在；浏览器 B 登录同一账户能读取并修改；另一个账户列表为空且伪造 record id 的读改删均被 RLS 过滤；同时编辑时后提交者收到 409；退出后 `/api/tasks` 返回 401。本地任务导入须由用户确认，重复导入应报告 skipped，localStorage 始终保留。当前没有 Supabase 项目凭证，以上真实数据库/跨浏览器验收尚未执行。

若 analyze 返回 `rules_only`，查看 `llmStatus.errorCode` 区分未配置、鉴权失败、余额、限流、超时、上游错误或格式校验失败；此时财务证据与规则裁决仍可用，但不得宣称模型调用成功。

## 何时改用其他平台

当前应用无 WebSocket、常驻内存任务、后台队列或本地持久磁盘依赖，Vercel Functions 适合现有架构。若未来必须让 `server.js` 长驻、维护连接或运行后台监测，应改用支持常驻 Node 进程的平台（如 Render、Railway 或 Fly.io），启动命令为 `npm start`，并另外配置持久数据库/队列；这类需求不应硬塞进短生命周期 Function。
