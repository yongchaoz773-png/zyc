# 测试报告

## 环境

- 日期：2026-10-19（Asia/Hong_Kong）
- OS：Windows / PowerShell
- Node.js：v24.11.0（Vercel 当前默认大版本）与 v20.18.0 便携运行时；系统 PATH 未安装 Node/npm
- 浏览器：本机 Google Chrome，无头模式，1440×1200
- 数据模式：历史公开披露快照；无扶摇/iFinD/模型密钥

## 实际执行

| 命令/检查 | 预期 | 实际结果 |
|---|---|---|
| `node scripts/check.js` | JS 可解析、关键 UI 节点存在 | 通过，19 个 JS 文件、5 个 UI 锚点 |
| `node scripts/vercel-check.js` | Vercel 路由、函数、静态输出、Node 版本、数据打包与超时配置一致 | 通过；4 个 Functions、`public` 输出、Node 24.x、`data/**`、20 秒上限 |
| `node scripts/test.js` | 规则、计算、Schema、异常及 Vercel 请求契约通过 | Node 24 与 Node 20 均通过，31/31，失败 0，跳过 0 |
| `node scripts/build.js` | 生成独立生产包 | 通过，产物位于 `dist/` |
| 启动 `node server.js` | 监听 4173 | 通过 |
| `/api/analyze` | 返回 ResearchTask v2 | 通过；支持命题返回 8 条证据、1 条冲突 |
| `/api/health` | 返回快照和适配器状态 | 通过 |
| `/api/compare` | 返回 4 个同口径指标 | 通过 |
| `/api/followup` | 覆盖问题返回证据 ID | 通过，归因问题引用 O1/O2/S2/S3 |
| 异常模拟 | 映射状态且不当作反证 | 401/403/429/500/503/空数据/错误 Schema 全部通过 |
| Chrome 截图 | 页面可渲染、无静态白屏 | 通过，见 `artifacts/workspace.png` |
| 两个巨潮 PDF 链接 | HTTP 200 且为 PDF | 通过；文件大小约 1.95MB / 1.57MB |
| `dist/` 生产包启动 | 首页与核心 API 可用 | 通过；首页 200、health 200、analyze 返回 8 条证据/1 条冲突、compare 4 项、followup 引用 O1/O2/S2/S3 |
| 敏感信息扫描 | 不含密钥或硬编码凭证 | 通过；未发现 credential-like value |
| Node 24 本地 HTTP 回归 | 首页和四个 API 可用 | 通过；首页 200、health 为非实时快照、analyze 为 8 条证据/1 条冲突、compare 4 项、followup 引用 O1/O2/S2/S3 |
| Vercel 请求体边界 | 兼容平台解析后的对象/字符串并稳定报错 | 通过；字符串 JSON、畸形 JSON、非对象 JSON、超过 100KB、错误方法均覆盖 |
| Vercel CLI 本地构建尝试 | 用平台 CLI 继续验证配置 | CLI 64.5.0 在 Node 24 下启动，但因令牌无效在加载团队阶段终止；未构建、未部署、未做线上验证 |
| 交付 ZIP 解压回归 | 压缩包完整且可复现 | 通过；独立目录含源码、文档、`dist/`、截图与 Git 历史，解压副本 31/31 测试、Vercel 检查和生产构建再次通过 |

## 用例覆盖

主链路覆盖命题输入、结构化任务、澄清、拆解、证据三分、结论、冲突、变化条件、比较、追问、保存/恢复逻辑与导出代码路径。金融计算覆盖正常同比、零/负基数、缺失值、百分点、累计期/单季度冲突、单位冲突和披露值不一致。合规覆盖未知公司不复用宁德时代证据、缺证不下确定结论、接口失败不当反证、追问证据外拒答、演示快照不冒充实时。

## 发现与修复

1. 系统 PATH 没有 Node/npm：使用官方 Node 24.11.0 与 20.18.0 便携运行时完成实际验证；交付不捆绑运行时。
2. Node 24 不再把 `node --test tests` 当作测试目录：新增跨版本测试启动脚本，显式枚举 `tests/*.test.js`。
3. API 首次加入 ResearchTask 时出现循环引用，导致 JSON 序列化 500：把任务内 analysis 改为深拷贝后复测通过。
4. 原 CSS 使用外部 Google Fonts，与严格 CSP 冲突：移除外部字体导入，保留系统字体回退。
5. README 曾保留过时的“公告摘要转录入口”描述：已改为当前实际使用的两条巨潮官方 PDF。
6. 原 `vercel.json` 使用 `runtime: nodejs20.x` 并把无扩展名 API 重写到 `.js`；按 Vercel 当前约定移除，改由 `api/` 自动路由及 `engines.node=24.x` 选择内置运行时。
7. Node 24 在当前 Windows 中文目录下使用 `fs.cpSync` 复制构建目录出现 `EIO`；改为逐文件递归复制后，Node 24/20 构建均通过。
8. Vercel CLI 64.5.0 读取到无效令牌，无法执行平台本地构建；该项如实保留为待授权线上验证，不以 `npm run build` 冒充。

## 未覆盖与风险

未执行扶摇/iFinD 真实鉴权与限流、可选模型在线调用、Playwright 自动点击流、跨浏览器矩阵、Vercel 平台构建及线上回归、真实 PDF 失效模拟、压测、安全红队和法律合规审查。浏览器端保存/导出主要通过代码检查和实际页面回归验证，未引入 Playwright 依赖；建议部署后补充。
