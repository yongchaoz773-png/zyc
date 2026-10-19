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

本轮部署专项验收在 Node.js 24.11.0 与 20.18.0 下均为 31/31 自动化测试通过；Vercel 平台构建及线上回归仍待账号授权，不能由本地结果替代。

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
- 命题解析、有限澄清、子问题编辑和版本审计。
- 支持、反对、无法验证三类证据；原始事实与规则解释分层展示。
- Evidence 唯一 ID、来源、发布日期、获取日期、报告期、公式、局限和可靠性说明。
- 显式冲突记录：双方能证明什么、适用证据、未解决部分和待补数据。
- 结构化结论、适用边界和可编辑反转条件。
- 2026H1 / 2025H1 同口径跨期比较。
- 有证据引用的追问，以及证据外问题的“证据不足”回答。
- localStorage v2 持久化、旧版迁移、损坏数据隔离、保存/恢复/完成/重新验证。
- Markdown 与完整 JSON 导出。
- 401、403、429、500、503、空数据和错误 Schema 的可视化异常演练；接口失败不会变成反证。
- 可选服务端模型语义解析；事实、计算、证据方向和最终裁决仍由数据与规则控制。

## 技术架构

项目采用零运行时依赖的 Node.js 与原生 HTML/CSS/JavaScript，并保留两套薄部署入口：本地由 `server.js` 启动长驻 HTTP 服务；Vercel 直接托管 `public/`，并把 `api/*.js` 分别构建为四个 Node.js Functions。两套入口复用同一组 `lib/` 业务逻辑，Vercel 不会启动 `server.js`。

```text
public/              响应式工作台、编辑/筛选/保存/导出交互
api/                 analyze / compare / followup / health
lib/engine.js        确定性证据与结论规则
lib/finance.js       同比、毛利率、百分点与披露值校验
lib/research.js      ResearchTask v2 数据模型、冲突与审计
lib/llm.js           可选命题语义解析（不生成财务事实）
data/                已核验历史快照与两个示例任务
tests/               规则、计算、模型和接口异常测试
scripts/             静态检查和生产构建
docs/                产品、架构、AI、测试、演示和提交材料
artifacts/           实际浏览器回归截图
dist/                `npm run build` 的生产构建产物
```

核心实体包括 `ResearchTask`、`Thesis`、`SubQuestion`、`Evidence`、`SourceDocument`、`Conclusion`、`ConflictRecord`、`ChangeCondition`、`DataSnapshot` 和 `AuditEvent`。API 返回的 `researchTask.schemaVersion` 当前为 2。

`dist/` 是供本地/通用 Node 主机使用的便携包，不是 Vercel 的 Output Directory。Vercel 的静态输出目录固定为 `public`，`api/` 按平台约定单独打包；`data/**` 由 `vercel.json` 显式加入函数包。

## AI 与规则引擎边界

默认模式 `rules_only` 完全离线可运行。配置模型后，大模型只做命题归一化、实体/歧义识别、子问题建议和反证信号建议；输出经过字段白名单和长度校验。模型不能生成财务数值、替换来源、决定数据真假或覆盖规则结论。

财务数值计算使用 `lib/finance.js`。它明确处理缺失值、零基数、负数基数、由负转正、单位不一致和累计期/单季度混用，并区分百分比和百分点。

## 数据来源与时效边界

已接入的是历史公开披露快照，不是实时接口：

- [宁德时代 2025 年年度报告全文](https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF)，宁德时代 / 巨潮资讯网，2026-03-10。
- [宁德时代 2026 年半年度报告全文](https://static.cninfo.com.cn/finalpage/2026-07-25/1225441586.PDF)，宁德时代 / 巨潮资讯网，2026-07-25。

关键字段保存在 `data/evidence.json`，单位为千元；派生值由代码重算。静态快照已核对官方 PDF 地址及 2025 年营业收入、归母净利润和披露增速。现阶段没有扶摇、iFinD MCP 的凭证或已授权工具，因此未伪称接通，也不展示实时估值/行情。

未来适配器应覆盖 `searchMarketData`、`getFinancialStatements`、`getFinancialMetrics`、`getValuationHistory`、`searchAnnouncements`、`searchResearchReports` 和 `getIndustryData`，并统一处理鉴权、限流、超时、空数据、字段缺失、格式错误、单位和期间口径。

## 环境变量

复制 `.env.example` 为 `.env.local`，只在确有授权时填写。当前本地快照模式无需任何密钥。

| 变量 | 用途 |
|---|---|
| `FUYAO_API_BASE_URL` / `FUYAO_API_KEY` | 扶摇服务端适配器预留 |
| `IFIND_MCP_URL` / `IFIND_MCP_TOKEN` | iFinD MCP 服务端适配器预留 |
| `OPENAI_API_KEY` | 可选命题语义解析；只在服务端读取 |
| `OPENAI_MODEL` | 可选模型名 |

不要把 `.env`、真实密钥、账号信息或有许可限制的数据提交到 Git。

## 部署

### 本地

`npm run dev` 后访问 `http://localhost:4173`，健康检查为 `http://localhost:4173/api/health`。

### Vercel

1. 在 GitHub 的 “New repository” 页面创建空仓库，建议名称 `evidencelab`、可见性 `Public`；不要勾选 README、`.gitignore` 或 License。
2. 在本目录执行 GitHub 创建页给出的两条命令：`git remote add origin <真实仓库URL>`、`git push -u origin main`。
3. 打开 Vercel Dashboard → Add New → Project，导入刚创建的 GitHub 仓库。
4. Framework Preset 选 `Other`；Root Directory 为 `./`；Install Command 使用默认 `npm install`；Build Command 为 `npm run build`；Output Directory 为 `public`；Node.js Version 为 `24.x`。这些值已写入 `vercel.json` / `package.json`，网页中不要设置相互冲突的 Override。
5. 当前快照模式不需要环境变量。如启用外部服务，只在 Vercel Project Settings → Environment Variables 配置密钥。
6. 部署后复测 `/`、`/api/health`、`/api/analyze`、`/api/compare`、`/api/followup`、两个来源链接及移动端布局，再把真实 URL 写回本文档。

当前本地仓库已准备为 `main` 分支，可直接添加远程并推送；但环境没有 GitHub 授权。Vercel CLI 64.5.0 在 Node.js 24 下检查明确返回令牌无效，因此没有创建或编造仓库/线上 URL。当前结论是“代码与配置具备直接导入条件”，不是“线上已验证”。详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 已知限制

- 仅覆盖宁德时代两个历史报告期，第二个示例复用同一公司的现金流数据；对其他公司返回证据不足。
- 没有扶摇、iFinD MCP、实时行情、研报检索、PDF 页码级自动定位或后台定时监测。
- localStorage 仅限当前浏览器/设备，不提供账号同步和多人协作。
- 可选 LLM 未在本次环境中配置真实密钥，因此没有记录虚构的模型调用。
- 已准备本地 Git 仓库，但未创建 GitHub 远程仓库、未部署公开 URL、未录制视频；已提供 90 秒演示脚本和实际浏览器截图。

更完整的设计、验证与交付说明见 [`docs/`](docs/)。
