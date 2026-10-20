# AI 使用与验证记录

## 实际使用

本次开发由 OpenAI Codex 辅助完成：读取原原型、提出产品与工程改造、生成/修改代码、补充测试和文档、运行本地服务、调用 API、执行 Chrome 无头浏览器截图并检查页面。最终业务逻辑仍由确定性代码和公开披露快照驱动。

## 人工/程序化复核

- 保留原 `evidencelab` 和 `evidencelab-source.zip`，只在独立 `evidencelab-final` 修改。
- 通过巨潮资讯搜索结果核验 2025 年年度报告和 2026 年半年度报告官方 PDF 地址，并用 HTTP HEAD 实测两条链接均返回 200、`application/pdf`。
- 交叉核对 2025 年营业收入 423,701,834 千元、归母净利润 72,201,282 千元及 17.04% / 42.28% 披露增速。
- 用代码重算同比、毛利率、百分点和非经常性损益增量占比，并对边界情况做单元测试。
- 实际启动 `http://localhost:4173`，验证 analyze / health / compare / followup 和全部异常模拟分支。
- 用本机 Chrome 无头模式在 1440×1200 生成 `artifacts/workspace.png` 并目视检查布局。
- 本轮新增金融数据适配层与 Supabase 持久化代码后，Node 24.11.0 和 20.18.0 分别执行 `npm run verify`；68/68 测试、Vercel 配置检查和生产构建通过。

## 模型输出校验

本机未配置 `DEEPSEEK_API_KEY`，因此本次没有真实 DeepSeek 账号调用记录，不能声称完成模型端到端验证。`lib/llm.js` 使用官方 Chat Completions JSON 模式；受控测试验证了请求 URL、服务端 Bearer 认证、模型参数、成功响应、401、503、超时、一次重试、非法 JSON/Schema、证据 ID 与数字白名单。Mock 成功只证明代码契约，不等于 DeepSeek 服务实际成功。

模型先提出命题结构，规则引擎只接受经过字段白名单且能在原命题/研究范围中直接确认的范围；财务事实、计算、证据方向和最终裁决不读取模型生成值。规则完成后，模型解释只能引用已有 Evidence ID，且作为 `modelExplanation` 与权威 `summary` 分离。任一模型阶段失败都会明确标记并回到规则结果。

## 已执行测试

测试覆盖原有命题/证据/DeepSeek/接口边界，并新增金融事实标准化、来源重试/缓存/超时/降级、服务端用户归属、Data REST JWT、会话刷新/失效清理、完整 CRUD、导入去重、乐观锁、CSRF 拒绝和 RLS 迁移约束。Node 24 与 Node 20 的 `npm run verify` 均为 68/68；最终数量和命令见 `TEST_REPORT.md`。

## 尚未验证

扶摇/iFinD 未授权；DeepSeek 有效 Key 未配置；Supabase 项目与密钥未提供。云端持久化代码、迁移和 Mock 契约已完成，但真实数据库/RLS/跨浏览器尚未联调；未登录时仍使用 localStorage。也未做本轮线上部署、系统化提示注入红队、PDF 页码级抽取或金融合规法律审查。
