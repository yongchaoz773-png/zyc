# 测试报告

## 环境与边界

- 日期：2026-10-20（Asia/Hong_Kong）
- OS：Windows / PowerShell
- Node.js：官方便携 v24.11.0 与 v20.18.0；系统 PATH 未安装 Node/npm
- 外部配置：无扶摇、iFinD MCP、DeepSeek 或 Supabase 凭证
- 数据模式：宁德时代历史公开财报结构化快照；不属于实时行情或在线结构化财务接口

## 本轮实际执行

| 命令/检查 | Node 24.11.0 | Node 20.18.0 | 结果说明 |
|---|---:|---:|---|
| `npm run check` | 通过 | 通过 | 32 个 JavaScript 文件可解析，5 个关键 UI 锚点存在 |
| `npm run check:vercel` | 通过 | 通过 | 7 个 Functions、`public` 输出、Node 24.x、`data/**` 与 20 秒上限一致 |
| `npm test` | 68/68 | 68/68 | 失败 0、跳过 0、todo 0 |
| `npm run build` | 通过 | 通过 | `dist/` 生成成功，并包含 `supabase/` 迁移材料 |
| `npm run verify` | 通过 | 通过 | check → Vercel check → test → build 全链路通过 |
| `npm run check:data-source` | 通过 | 未重复 | 两条巨潮 PDF 实际 HTTP 200；`structuredOnlineData=false`、事实 `dataMode=snapshot` |
| 本地 HTTP 首页 | 200 | 未重复 | Node 24 的 `server.js` 实际启动并返回首页 |
| `/api/health` | 200 | 未重复 | 服务正常；云存储状态为 not-configured |
| `/api/financial-data` | 200 | 未重复 | 返回 18 条可追溯快照事实，未标为在线数据 |
| `/api/analyze` 回归 A | 200 | 自动化覆盖 | UTF-8 请求返回 `refuted`、`missingFields=[]`、指标 `revenue,netProfit` |
| `/api/auth`（无配置） | 503 | 自动化覆盖 | `CLOUD_NOT_CONFIGURED`，未伪造登录成功 |
| `/api/tasks`（无配置） | 503 | 自动化覆盖 | `CLOUD_NOT_CONFIGURED`，未伪造数据库写入 |

真实来源检查发生于 2026-10-20 本地时区，对以下公开文件执行 HEAD（必要时 Range GET）并得到 HTTP 200：

- `https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF`
- `https://static.cninfo.com.cn/finalpage/2026-07-25/1225441586.PDF`

该结果只验证 URL 在当次检查时可访问。代码没有在线解析 PDF、没有从巨潮获得结构化 API 响应，也没有据此把历史快照升级成实时数据。

## 自动化覆盖

原有回归全部保留：命题解析、跨指标/复合指标比较、强因果门槛、证据方向、ResearchTask v2、财务计算、DeepSeek 契约与降级、异常映射、连续任务隔离和 Vercel 请求体边界。

本轮新增测试覆盖：

- 9 个指标的本期/比较期标准化为 18 条事实，逐条检查 12 个必需追溯字段。
- 公司搜索、披露材料查询以及未知公司/不覆盖期间的严格拒绝。
- 来源在线检查、函数实例内缓存、有限重试、网络失败和快照降级；在线可访问也不改变事实的 `snapshot` 标签。
- 分析结果到 ResearchTask DataSnapshot 的事实、数据模式和来源核验状态传递。
- 服务端从认证身份派生 `user_id`，忽略任务对象中的伪造用户字段。
- Data REST 请求使用 publishable key + 用户 JWT，不使用 service-role 密钥。
- 创建/查询/更新/删除、导入去重契约、更新与删除乐观锁、云服务未配置 503。
- Access Cookie 过期后的 Refresh Token 恢复、HttpOnly/Secure/SameSite 属性，以及跨站写请求 403 拒绝。
- 迁移脚本包含 `anon` 权限撤销、强制 RLS、四类 owner-only 策略、索引和回滚文件。
- `supabase/tests/research_tasks_rls.test.sql` 提供 owner/other/anon 的 pgTAP 场景，但因没有已关联的 Supabase 测试实例，本轮未执行该文件。

## Mock、静态检查与真实联调的区分

- DeepSeek 成功、401、超时、重试和非法响应是 Mock 合同测试；没有真实 DeepSeek 账户联调。
- Supabase Auth/Data REST 请求、导入和冲突是 Mock 合同测试；没有真实数据库、邮箱确认、刷新会话、RLS 或跨浏览器联调。
- SQL RLS 的 Node 测试只检查迁移文本的关键安全约束；不能替代 `supabase test db` 或真实数据库越权测试。
- 巨潮来源 URL 是本轮唯一实际外部网络检查；财务数字来自仓库中已存在的历史快照。
- Vercel 配置检查与 `npm run build` 是本地检查；本轮没有平台构建、部署或线上回归。

## 已知未覆盖项

1. 扶摇/iFinD 的真实接口文档、鉴权、许可、限流和 Schema 尚未提供，因此没有实现或测试真实结构化数据接入。
2. 真实 Supabase 项目尚未配置，未执行干净数据库迁移、回滚恢复、Auth 邮件、两浏览器同步、并发更新或真实 RLS 越权矩阵。
3. 未重新部署 Vercel，七个 Functions 的线上运行、Cookie 行为和公开 URL 未验证。
4. 未使用有效 DeepSeek Key，模型真实响应和账户限额未验证。
5. 未做压测、安全红队、灾备恢复或正式金融/数据许可合规审查。

这些未覆盖项均保留为待外部授权/环境的集成验收，不会描述成已经通过。
