# 提交核对清单

## 已完成

- [x] 保留现有页面、DeepSeek 链路、命题解析、规则引擎、证据链和错误降级，没有重写核心系统。
- [x] 公开披露快照 Provider 支持覆盖公司查询、指定期间事实、报告材料、标准化字段、来源刷新、缓存、超时、一次重试和失败降级。
- [x] 18 条本期/比较期事实均含 ID、公司、指标、值、单位、期间、会计口径、来源、URL、发布日期、获取时间和数据模式。
- [x] 分析与 ResearchTask 保存当次金融事实和数据状态；来源可访问也不会把快照写成实时/在线结构化数据。
- [x] 两条巨潮 PDF 本轮真实检查为 HTTP 200；该结果只代表原始文件可访问。
- [x] 扶摇/iFinD 保持 `not-configured`，没有虚构接口、字段、授权或连接结果。
- [x] 新增 Supabase Auth 服务端代理、HttpOnly Cookie 会话、刷新逻辑和登录/注册/退出 UI。
- [x] 新增当前用户任务列表、详情、创建、更新状态、删除、恢复和重新验证保存接口。
- [x] 服务端从已验证会话取得 user id，不信任前端 `userId`；Data REST 使用用户 JWT。
- [x] PostgreSQL 迁移将检索字段独立成列，业务结构分别存储为 JSONB；包含索引、唯一键、版本号和更新时间触发器。
- [x] 撤销 anon 权限，启用/强制 RLS，并为 SELECT/INSERT/UPDATE/DELETE 创建 owner-only 策略。
- [x] 提供回滚 SQL 和 owner/other/anon 的 pgTAP RLS 测试文件。
- [x] 本地任务仅在用户确认后导入云端；字段校验、重复跳过、失败保留本地副本均已实现。
- [x] 乐观锁冲突返回 409；重新验证会归档上一版结论、证据与 DataSnapshot 摘要。
- [x] Cookie 使用 HttpOnly、SameSite=Lax、生产 HTTPS Secure；写接口增加 Origin/Sec-Fetch-Site 同源校验，删除也强制版本条件。
- [x] 未配置 Supabase 时明确回退本地模式；认证/任务接口返回 503，不谎报云端成功。
- [x] `.env.example` 只含空值/非敏感默认值，`.gitignore` 排除 `.env*`、构建产物和日志。
- [x] Vercel 模型保持 `public/` 静态前端 + 7 个 Functions，Other、Node 24.x、20 秒上限与 `data/**` 打包一致。
- [x] Node 24.11.0 与 20.18.0 均执行 `npm run verify`：68/68，静态检查、Vercel 检查和生产构建全部通过。
- [x] Node 24 本地首页、health、financial-data、analyze、未配置 auth/tasks 状态已实际验证。
- [x] README、架构、部署指南、测试报告和本清单已更新。

## 待外部配置或授权

- [ ] 扶摇/iFinD 真实结构化数据：需要官方接口文档、账号、数据许可和凭证。
- [ ] Supabase 真实联调：需要创建项目、执行迁移、配置 Auth 和 publishable key；当前仅完成代码/Mock/迁移静态测试。
- [ ] `supabase test db`：需要本地或隔离 Supabase 测试实例；当前 pgTAP 文件未执行。
- [ ] 跨浏览器验收：真实项目配置后测试同账号同步、异账号隔离、伪造 ID、并发 409、退出登录与本地导入。
- [ ] DeepSeek 真实调用：当前没有有效 Key；受控 Mock 不能替代账户联调。
- [ ] Vercel 平台构建与线上回归：本轮未登录、未部署、未修改线上环境变量。
- [ ] GitHub 远程和推送：本轮不得推送，且当前没有远程仓库配置。
- [ ] 演示视频和最终数据/隐私/金融合规审查。

## 最短人工步骤

1. 在 Supabase 创建项目，在 SQL Editor 执行 `supabase/migrations/001_research_tasks.sql`。
2. 保留 Email/Password Auth；生产启用邮箱确认并配置真实 Vercel Site URL。
3. 在 Vercel 添加 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`，不要添加 service-role/secret key。
4. 如需 DeepSeek，再添加相应服务端变量；如需扶摇/iFinD，必须先按真实官方文档完成新适配器，不能只填预留变量。
5. 重新部署后验证 `/`、`/api/health`、`/api/financial-data`、`/api/analyze`、`/api/compare`、`/api/followup`、`/api/auth`、`/api/tasks`。
6. 用两个浏览器和两个账户完成同步与隔离矩阵；确认保存提示只在服务端 2xx 后出现。
7. 执行 `npm run check:data-source` 复核来源可用性，并继续确认所有指标仍显示快照而非实时数据。
