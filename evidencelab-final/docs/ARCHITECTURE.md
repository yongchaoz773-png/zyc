# 系统架构

## 组件与数据流

浏览器通过同源 API 访问后端。本地由 `server.js` 提供长驻 Node HTTP 服务并加载未提交的 `.env.local`；Vercel 直接托管 `public/`，将七个 `api/*.js` 分别构建为 Functions，不运行 `server.js`。`api/analyze.js` 组合金融 Provider、可选 DeepSeek 语义结构、确定性规则引擎与 ResearchTask v2。`api/auth.js` 代理 Supabase Auth 并把 access/refresh token 放入 HttpOnly、SameSite=Lax Cookie；`api/tasks.js` 从服务端验证的用户会话取得 user id，再以用户 JWT 调用 Supabase Data REST。数据库 RLS 是最终的数据隔离边界。

```text
Browser UI ── unauthenticated: localStorage v2
       │     authenticated: same-origin cloud API
       │
       ├── POST /api/analyze ── input guard ── optional DeepSeek semantic parser
       │                                  └── schema / field allowlist
       │                                           └── deterministic engine
       │                                                ├── traceable financial facts
       │                                                ├── finance rules
       │                                                └── conflict rules
       │                                                     └── optional DeepSeek explanation
       │                                                          └── Evidence ID / numeric allowlist
       ├── GET  /api/compare
       ├── POST /api/followup
       ├── GET/POST /api/financial-data ── source URL verification + instance cache
       ├── GET/POST /api/auth ── Supabase Auth ── HttpOnly cookies
       ├── CRUD /api/tasks ── user JWT ── PostgREST ── PostgreSQL RLS
       └── GET /api/health
```

## 证据链模型

ResearchTask 包含 Thesis、SubQuestion、SourceDocument、Evidence、Conclusion、ConflictRecord、ChangeCondition、DataSnapshot、AuditEvent 与最多 10 个重验摘要。Evidence 同时保存方向、类型、报告期、发布日期、获取时间、来源 URL、原始数值/摘录、公式、规则解释、局限和可靠性。DataSnapshot 保存本次采用的数据模式及标准化事实。Conclusion 只引用 Evidence ID，不复制不可追踪的“事实”。重新验证不会静默抹去上一版结论、证据和数据快照。

## 冲突规则

1. 正式财报/公告优先于二手解读，但不自动否定后者提出的待核问题。
2. 先核对报告期、单位、累计/单季度、合并/母公司和指标定义。
3. 检查披露日期、数据所属期和后续更正。
4. 区分证据是否回答同一子问题。
5. 相关性不直接升级为因果性。
6. 反向证据若限制“全部/主要”等强命题，则保留限定结论。
7. 无法消除的冲突写入 ConflictRecord，不由模型补齐。

## 命题裁决分层

命题先区分单指标变化、复合指标方向、跨指标比较、匹配性、一般因果归因和“全部由/完全来自”等排他性因果。直接指标和同口径比较可以用披露值计算真假；复合命题逐子句核验且只有全部子命题成立才整体成立。相关指标同时改善只能支持背景子命题。价格、销量、结构或成本因果必须有目标驱动数据与利润桥；排他性因果还需排除替代解释。缺任一关键环节时最终结论为证据不足。`Evidence.supportsWholeClaim=false` 的材料不会进入结论的 `supportEvidenceIds`。

## 金融计算

`lib/finance.js` 处理同比、毛利率、百分点变化和披露值复核。零基数、负数基数、由负转正、缺失值、单位冲突及期间类型冲突返回结构化错误，而不是机械输出增速。

## 错误处理

API 统一返回 `{error, message}`；数据源失败带 `evidenceImpact: unknown-not-opposition`。请求体限制 100KB，命题限制 1200 字符，追问限制 500 字符。部分来源失败的设计原则是保留成功证据并降低完整性。浏览器本地存储含 schemaVersion，损坏内容先隔离再回到空列表。

## 数据源适配器

`lib/financial-data.js` 实现当前唯一可用的 `public-disclosure-snapshot` Provider：

- `searchCompanies(query)` 只返回快照真实覆盖的公司和期间。
- `getFinancialData()` 返回逐指标本期/比较期事实以及状态；事实始终标记 `dataMode=snapshot`。
- `getDisclosures()` 返回正式披露材料链接、发布日期和获取时间。
- `refresh=true` 只在线验证 PDF 是否可访问；3.5 秒超时、一次有限重试、15 分钟函数实例内缓存。成功状态为 `source-verified-snapshot`，不代表在线结构化数据。
- `/api/health` 的最近检查时间只代表当前 Function 实例内存，字段明确标为 non-durable；Serverless 冷启动或不同 Function 之间不会伪装成全局持久状态。
- 公司、期间不覆盖时返回明确 404；来源失败时保留快照并标记 fallback，不把失败解释为反证。

扶摇与 iFinD MCP 仅保留配置名和 `not-configured` 健康状态。缺少真实接口文档与授权，所以没有虚构端点、字段或调用结果。

## 云端任务与认证

Supabase 方案不新增运行时依赖，使用官方 Auth REST 与 PostgREST：

- publishable/legacy anon key 仅识别应用组件；每次数据请求还必须携带已登录用户 JWT。代码不需要且不接受 service-role 密钥。
- 浏览器只访问同源 `/api/auth` 和 `/api/tasks`；JWT 位于 HttpOnly Cookie，不由页面 JavaScript读取。
- 写请求除 `SameSite=Lax` Cookie 外还校验 `Origin`/`Sec-Fetch-Site`；跨站浏览器请求在认证和数据库操作前返回 403。
- 服务端忽略前端任何 `userId`，只使用 `/auth/v1/user` 返回的稳定用户 id。
- `research_tasks` 将检索字段独立列出，并把子问题、证据、来源、结论、模型状态、规则结果、数据快照和完整可恢复任务分别保存为 JSONB。
- `(user_id, client_task_id)` 唯一约束实现导入幂等；更新和删除均强制携带数据库 `version` 条件，冲突返回 409，缺少版本返回 422。
- 表启用并强制 RLS，四类策略均限定 `to authenticated` 和 `auth.uid() = user_id`；`anon` 权限被撤销。
- localStorage 只作未登录降级和用户确认后的导入来源；导入失败或成功都不自动删除本地副本。

## 安全与部署

本地服务设置 nosniff、Referrer-Policy、CSP 和路径穿越防护；Vercel 通过 `vercel.json` 设置同类响应头、函数资源与超时。`api/` 使用平台自动路由，不添加 `.js` 重写；`data/**` 显式打入函数包。真实密钥只来自服务端环境变量，前端不接触 DeepSeek 域名、Supabase JWT 或 Authorization；`.env*`、日志和依赖目录不提交（仅空值 `.env.example` 例外）。当前同源调用无需 CORS。数据库迁移和回滚位于 `supabase/`；当前工作区没有真实 Supabase 配置，因此数据库代码已测试但真实跨浏览器联调仍待外部环境。
