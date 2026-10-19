# 系统架构

## 组件与数据流

浏览器通过同源 API 访问后端。本地由 `server.js` 提供长驻 Node HTTP 服务；Vercel 直接托管 `public/`，并将四个 `api/*.js` 分别构建为 Functions，不运行 `server.js`。两种入口复用相同业务模块。`api/analyze.js` 先做输入与异常校验，再由 `lib/engine.js` 从 `data/evidence.json` 构造确定性分析；`lib/research.js` 映射为 ResearchTask v2；如配置模型，`lib/llm.js` 仅附加语义计划。`compare` 与 `followup` 分别提供同口径比较和证据限定回答。

```text
Browser UI / localStorage v2
       │
       ├── POST /api/analyze ── input guard ── optional LLM semantic parser
       │                                  └── deterministic engine
       │                                           ├── public snapshot
       │                                           ├── finance rules
       │                                           └── conflict rules
       ├── GET  /api/compare
       ├── POST /api/followup
       └── GET  /api/health
```

## 证据链模型

ResearchTask 包含 Thesis、SubQuestion、SourceDocument、Evidence、Conclusion、ConflictRecord、ChangeCondition、DataSnapshot 与 AuditEvent。Evidence 同时保存方向、类型、报告期、发布日期、获取时间、来源 URL、原始数值/摘录、公式、规则解释、局限和可靠性。Conclusion 只引用 Evidence ID，不复制不可追踪的“事实”。

## 冲突规则

1. 正式财报/公告优先于二手解读，但不自动否定后者提出的待核问题。
2. 先核对报告期、单位、累计/单季度、合并/母公司和指标定义。
3. 检查披露日期、数据所属期和后续更正。
4. 区分证据是否回答同一子问题。
5. 相关性不直接升级为因果性。
6. 反向证据若限制“全部/主要”等强命题，则保留限定结论。
7. 无法消除的冲突写入 ConflictRecord，不由模型补齐。

## 金融计算

`lib/finance.js` 处理同比、毛利率、百分点变化和披露值复核。零基数、负数基数、由负转正、缺失值、单位冲突及期间类型冲突返回结构化错误，而不是机械输出增速。

## 错误处理

API 统一返回 `{error, message}`；数据源失败带 `evidenceImpact: unknown-not-opposition`。请求体限制 100KB，命题限制 1200 字符，追问限制 500 字符。部分来源失败的设计原则是保留成功证据并降低完整性。浏览器本地存储含 schemaVersion，损坏内容先隔离再回到空列表。

## 数据源适配器设计

正式接入扶摇/iFinD 时在服务端实现统一 ProviderResult：`status`、`provider`、`retrievedAt`、`period`、`unit`、`fields`、`sourceDocument`、`rawResponseDigest`、`warnings`。认证信息只读环境变量；需要超时、有限重试、429 退避、字段 Schema 校验、单位标准化和许可审计。

## 安全与部署

本地服务设置 nosniff、Referrer-Policy、CSP 和路径穿越防护；Vercel 通过 `vercel.json` 设置同类响应头、函数资源与超时。`api/` 使用平台自动路由，不添加 `.js` 重写；`data/**` 显式打入函数包。`.env*`、日志和依赖目录不提交。当前同源调用无需 CORS、无需数据库；生产任务协作应改用有访问控制和版本审计的后端存储。
