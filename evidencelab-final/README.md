# 证研 EvidenceLab

面向投研助理、研究员与希望检验投资观点的用户，将自然语言命题转成可证伪的子问题，再用“支持 / 反对 / 无法验证”三类证据形成可追溯结论。产品只辅助研究，不给买卖建议，不承诺收益。

## 一分钟体验

要求：Node.js 24 LTS（与 Vercel 部署运行时一致），无第三方 npm 依赖。核心回归也已在 Node.js 20.18.0 通过。

```powershell
npm install
npm run dev
```

打开 <http://localhost:4173>。默认示例是“宁德时代 2025 年盈利改善主要来自主营业务，而非非经常性损益”。

```powershell
npm run check   # JavaScript 语法和关键 UI 节点
npm test        # 规则、计算、Schema、接口异常、合规边界与 Vercel 请求契约
npm run check:vercel # Vercel 路由、函数、静态目录与资源打包检查
npm run build   # 生成 dist/
npm run verify  # 依次执行静态检查、Vercel 检查、测试和构建
```

Windows 也可双击 `start.bat`。若 `node` 不在 PATH，请安装 Node.js 24 LTS 后重开终端。

当前自动化回归共 68 项；新增覆盖金融事实标准化、来源缓存/重试/超时/降级、Supabase 请求契约、服务端用户归属、会话刷新/失效清理、完整 CRUD、导入去重、乐观锁冲突、CSRF 拒绝和 RLS 迁移约束。Vercel 平台构建、真实 DeepSeek Key、真实 Supabase 项目及线上跨浏览器联调仍需在有授权的环境完成，不能由本地或 Mock 结果替代。

## 核心使用流程

1. 输入包含公司、期间和指标的投资命题；系统拒绝空输入、超长输入和重复提交。
2. 查看系统识别出的歧义；公司、报告期或指标缺失时补充澄清。
3. 编辑 3–6 个子问题及判定标准，保存后生成新的命题/任务版本与审计事件。
4. 按方向、类型和来源筛选证据，展开公式和原始输入，跳转原始材料。
5. 查看证据冲突；系统按一手材料、口径一致性、期间匹配和因果边界裁决，不按数量投票。
6. 查看/编辑结论变化条件。当前只支持手动重新验证，不宣称实时监控。
7. 继续跨期比较或追问；回答优先引用证据 ID，超出证据范围时明确拒答并列出缺失信息。
8. 保存、恢复、标记完成或重新验证任务，并导出 Markdown / JSON。

## 已实现功能

- 专业金融研究工作台与移动端适配。
- 公司、期间、多指标和关系的结构化命题解析；只对真正缺失的字段发起澄清。
- 跨指标同比比较、复合指标方向、单指标变化验证，以及相关性/一般因果/排他性因果的分级裁决。
- 支持、反对、无法验证三类证据；原始事实与规则解释分层展示。
- Evidence 唯一 ID、来源、发布日期、获取日期、报告期、公式、局限和可靠性说明。
- 显式冲突记录：双方能证明什么、适用证据、未解决部分和待补数据。
- 结构化结论、适用边界和可编辑反转条件。
- 2026H1 / 2025H1 同口径跨期比较。
- 有证据引用的追问，以及证据外问题的“证据不足”回答。
- Supabase Auth + PostgreSQL 云端任务 CRUD、RLS 用户隔离、乐观锁和跨浏览器恢复代码；未配置时明确回退到 localStorage v2。
- 用户确认后的 localStorage 导入、字段校验、按 `(user_id, client_task_id)` 去重；失败不删除本地副本。
- 公开披露快照 Provider：公司覆盖查询、逐指标标准化事实、原始报告入口、来源可用性刷新、15 分钟缓存、超时/一次重试与失败降级。
- Markdown 与完整 JSON 导出。
- 401、403、429、500、503、空数据和错误 Schema 的可视化异常演练；接口失败不会变成反证。
- 可选 DeepSeek 服务端语义解析与证据约束解释；鉴权、超时、一次重试、JSON/字段校验和显式规则降级均在服务端完成。

## 技术架构

项目采用零运行时依赖的 Node.js 与原生 HTML/CSS/JavaScript，并保留两套薄部署入口：本地由 `server.js` 启动长驻 HTTP 服务；Vercel 直接托管 `public/`，并把 `api/*.js` 分别构建为七个 Node.js Functions。两套入口复用同一组 `lib/` 业务逻辑，Vercel 不会启动 `server.js`。

```text
public/              响应式工作台、编辑/筛选/保存/导出交互
api/                 analyze / compare / followup / health / financial-data / auth / tasks
lib/engine.js        确定性证据与结论规则
lib/thesis.js        公司、期间、多指标、关系与命题类型解析
lib/finance.js       同比、毛利率、百分点与披露值校验
lib/research.js      ResearchTask v2 数据模型、冲突与审计
lib/llm.js           DeepSeek Chat Completions、结构校验、超时/重试与解释边界
lib/financial-data.js 公开披露快照 Provider、事实标准化、来源刷新和缓存
lib/supabase.js      Supabase Auth、HttpOnly 会话、刷新与 Data REST 基础请求
lib/task-store.js    用户级任务 CRUD、导入去重与乐观锁
lib/env.js           仅本地服务加载未提交的 .env.local
data/                已核验历史快照与两个示例任务
supabase/            可重复数据库迁移、回滚和 RLS pgTAP 测试
tests/               规则、计算、模型和接口异常测试
scripts/             静态检查和生产构建
docs/                产品、架构、AI、测试、演示和提交材料
artifacts/           实际浏览器回归截图
dist/                `npm run build` 的生产构建产物
```

核心实体包括 `ResearchTask`、`Thesis`、`SubQuestion`、`Evidence`、`SourceDocument`、`Conclusion`、`ConflictRecord`、`ChangeCondition`、`DataSnapshot` 和 `AuditEvent`。API 返回的 `researchTask.schemaVersion` 当前为 2。

`dist/` 是供本地/通用 Node 主机使用的便携包，不是 Vercel 的 Output Directory。Vercel 的静态输出目录固定为 `public`，`api/` 按平台约定单独打包；`data/**` 由 `vercel.json` 显式加入函数包。

## AI 与规则引擎边界

默认模式 `rules_only` 完全离线可运行。配置 DeepSeek 后，`/api/analyze` 先通过服务端调用 `POST https://api.deepseek.com/chat/completions`，校验公司、期间、指标、命题类型、子命题和缺失字段，再把白名单范围传给现有规则引擎。规则裁决完成后可再请求一段解释；解释必须引用现有 Evidence ID，且不得出现规则结果中不存在的数字。模型输出与静态快照在数据结构上分离，不能生成财务事实、替换来源、决定数据真假或覆盖规则结论。

每次分析都返回独立状态：`llmStatus` 表示当前请求是否真实收到并校验模型响应；`mode=deepseek+rules` 只在本次语义请求成功时出现。仅仅存在环境变量不会显示“已连接”。`financialData.status` 单独标记快照、来源已核验快照和失败回退；即使 PDF 在线可访问，结构化数值仍为 `snapshot`。任务只有在认证且服务端写入成功后才显示云端成功，其他情况明确为本地模式或失败。

财务数值计算使用 `lib/finance.js`。它明确处理缺失值、零基数、负数基数、由负转正、单位不一致和累计期/单季度混用，并区分百分比和百分点。

## 数据来源与时效边界

已接入的是历史公开披露快照，不是实时接口：

- [宁德时代 2025 年年度报告全文](https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF)，宁德时代 / 巨潮资讯网，2026-03-10。
- [宁德时代 2026 年半年度报告全文](https://static.cninfo.com.cn/finalpage/2026-07-25/1225441586.PDF)，宁德时代 / 巨潮资讯网，2026-07-25。

关键字段保存在 `data/evidence.json`，单位为千元；派生值由代码重算。`lib/financial-data.js` 将每个本期/比较期事实标准化为包含 `evidenceId、companyCode、metric、value、unit、period、accountingScope、sourceName、sourceUrl、publishedAt、fetchedAt、dataMode` 的记录。`npm run check:data-source` 会真实访问两个巨潮 PDF 以检查原始材料可用性，但不会从 PDF 自动抽取或更新结构化数值。现阶段没有扶摇、iFinD MCP 的接口文档、凭证或已授权工具，因此未实现猜测性调用，也不展示实时估值/行情。

未来适配器应覆盖 `searchMarketData`、`getFinancialStatements`、`getFinancialMetrics`、`getValuationHistory`、`searchAnnouncements`、`searchResearchReports` 和 `getIndustryData`，并统一处理鉴权、限流、超时、空数据、字段缺失、格式错误、单位和期间口径。

## 环境变量

复制 `.env.example` 为 `.env.local`，只在确有授权时填写；`npm run dev` 会在加载 API 路由前读取它，且不会覆盖已存在的系统环境变量。当前本地快照与规则模式无需任何密钥。

| 变量 | 用途 |
|---|---|
| `FUYAO_API_BASE_URL` / `FUYAO_API_KEY` | 扶摇适配器预留；当前不读取、不代表已接入 |
| `IFIND_MCP_URL` / `IFIND_MCP_TOKEN` | iFinD MCP 预留；当前不读取、不代表已接入 |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，仅由服务端读取；模板留空 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash`；旧名 `deepseek-chat` 已于 2026-07-24 停用 |
| `DEEPSEEK_TIMEOUT_MS` | 单次请求超时，默认 6500 ms |
| `DEEPSEEK_TOTAL_TIMEOUT_MS` | 一次分析中模型调用总时限，默认 16000 ms |
| `FINANCIAL_SOURCE_VERIFY_TIMEOUT_MS` | 单次公开来源可用性检查超时，默认 3500 ms |
| `FINANCIAL_CACHE_TTL_MS` | 来源检查的函数实例内缓存时长，默认 900000 ms |
| `SUPABASE_URL` | Supabase 项目 HTTPS URL；服务端读取 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key；用于 Auth/Data API，数据权限依赖用户 JWT + RLS |
| `SUPABASE_ANON_KEY` | legacy anon key 兼容项；仅在没有 publishable key 时读取 |
| `SUPABASE_TIMEOUT_MS` | Supabase 请求超时，默认 6000 ms |

不要把 `.env`、真实密钥、账号信息或有许可限制的数据提交到 Git。

## 部署

### 本地

`npm run dev` 后访问 `http://localhost:4173`，健康检查为 `http://localhost:4173/api/health`。

### Vercel

1. 在 GitHub 的 “New repository” 页面创建空仓库，建议名称 `evidencelab`、可见性 `Public`；不要勾选 README、`.gitignore` 或 License。
2. 在本目录执行 GitHub 创建页给出的两条命令：`git remote add origin <真实仓库URL>`、`git push -u origin main`。
3. 打开 Vercel Dashboard → Add New → Project，导入刚创建的 GitHub 仓库。
4. Framework Preset 选 `Other`；Root Directory 为 `./`；Install Command 使用默认 `npm install`；Build Command 为 `npm run build`；Output Directory 为 `public`；Node.js Version 为 `24.x`。这些值已写入 `vercel.json` / `package.json`，网页中不要设置相互冲突的 Override。
5. 如需云端任务，先在 Supabase SQL Editor 执行 `supabase/migrations/001_research_tasks.sql`，再在 Vercel 服务端配置 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`；不要配置 service-role/secret key。
6. 如启用 DeepSeek，只在 Vercel 服务端配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`、`DEEPSEEK_MODEL=deepseek-flash`；不得使用 `NEXT_PUBLIC_`/`VITE_` 前缀。
7. 部署后复测 `/`、七个 `/api/*` 路由、注册/登录/退出、两浏览器任务同步、两个来源链接及移动端布局，再把真实 URL 写回本文档。

当前本地仓库已准备为 `main` 分支，可直接添加远程并推送；但本地没有 GitHub 远程，Vercel CLI 保存的令牌无效，也没有提供可核验的现有部署 URL。用户说明项目已有 Vercel 部署，但本轮源码尚未重新部署和线上验证；本文不会用本地结果冒充线上结果。详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 已知限制

- 仅覆盖宁德时代两个历史报告期，第二个示例复用同一公司的现金流数据；对其他公司返回证据不足。
- 没有扶摇、iFinD MCP、实时行情、研报检索、PDF 页码级自动定位或后台定时监测。
- 云端同步代码和迁移已完成，但当前工作区没有 Supabase 项目配置，未做真实数据库、邮箱确认或两浏览器联调；未登录时仍只使用 localStorage。
- 来源在线检查只验证原始 PDF 可访问，不会在线解析结构化财务字段；结构化数据仍只覆盖当前宁德时代快照。
- 当前环境未配置真实 `DEEPSEEK_API_KEY`；已验证请求格式、成功响应、无效 Key、超时、重试、非法 JSON/Schema 和规则降级的受控测试，但尚未完成真实 DeepSeek 账户联调。
- 已准备本地 Git 仓库，但未创建 GitHub 远程仓库、未部署公开 URL、未录制视频；已提供 90 秒演示脚本和实际浏览器截图。

更完整的设计、验证与交付说明见 [`docs/`](docs/)。
