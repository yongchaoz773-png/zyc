# 提交核对清单

## 已完成

- [x] 原项目与原 ZIP 未删除、未覆盖；最终交付在独立目录。
- [x] Windows 本地可启动，无第三方运行时依赖。
- [x] 命题提交、澄清、修订、拆解和子问题编辑。
- [x] 支持、反对、无法验证三类证据和筛选。
- [x] 公式、来源、报告期、发布日期、局限和可靠性追溯。
- [x] 冲突记录和非数量投票裁决。
- [x] 结构化结论、适用边界和可编辑变化条件。
- [x] 跨期比较和引用证据 ID 的追问。
- [x] localStorage v2 保存/恢复/完成/重验、损坏隔离和旧版迁移。
- [x] Markdown 与 JSON 导出。
- [x] 两个可运行示例命题。
- [x] 空输入、超长、未知公司、重复提交、401/403/429/500/503、空数据、错误 Schema 等边界。
- [x] 金融计算、ResearchTask Schema、合规拒答和接口异常自动化测试。
- [x] 静态检查、测试、生产构建和实际浏览器截图。
- [x] README、产品说明、架构、AI 使用记录、测试报告和 90 秒演示脚本。
- [x] `.env.example` 无真实密钥，`.gitignore` 排除密钥与临时文件。
- [x] 提交前在 Node.js 24.11.0 与 20.18.0 重新执行 `npm run verify`：31/31 测试、静态检查、Vercel 配置检查和生产构建全部通过。
- [x] 生产构建从 `dist/` 启动，首页、健康检查和三项核心 API 实测通过。
- [x] 两条巨潮官方 PDF 再次验证为 HTTP 200、`application/pdf`。
- [x] 凭证、环境变量、实时数据声明和来源 URL 审计完成，未发现真实密钥或虚构公开 URL。
- [x] 本地 Git 仓库使用 `main` 分支，可直接添加 GitHub 远程并推送。
- [x] Vercel 部署模型已明确：`public/` 静态前端 + 四个 `api/*.js` Functions；`server.js` 仅用于本地/通用 Node 主机。
- [x] 已固定 Other、Node 24.x、`public` 输出、`data/**` 函数资源和 20 秒上限，并验证请求体与错误边界。
- [x] 本轮最终 ZIP 在独立临时目录解压，文件完整，并再次完成 31/31 测试、Vercel 配置检查与生产构建。

## 外部权限限制 / 待人工完成

- [ ] 扶摇 API 与 iFinD MCP：需要有效授权、接口协议和数据许可。
- [ ] GitHub 仓库：系统未安装 `gh` 且没有 GitHub Token；需在网页创建空仓库并推送本地 `main`。
- [ ] 可选：推送前把仓库级占位 Git 作者改为你的 GitHub 显示名与验证邮箱，并按部署文档重写本地提交的作者。
- [ ] Web 公开 URL：Vercel CLI 64.5.0 实测令牌无效；需通过网页导入 GitHub 仓库、部署并做线上回归。
- [ ] 60–180 秒演示视频：已提供 90 秒脚本，需人工录屏上传。
- [ ] 可选 LLM 线上验证：需在服务端配置合法 API Key 后补做 Schema/超时/注入测试。
- [ ] 正式投研上线前的数据许可、隐私、安全与金融合规审查。

## 最少人工操作

1. 安装 Node.js 24 LTS；本轮已用 v24.11.0 和 v20.18.0 完成验证，提交前可再执行一次 `npm run verify`。
2. 按 `DEMO_SCRIPT.md` 录制并上传 90 秒视频。
3. 打开 <https://github.com/new>，创建名为 `evidencelab` 的空 Public 仓库，不初始化 README、`.gitignore` 或 License。
4. 在项目目录执行 `git remote add origin <GitHub 页面给出的真实 URL>` 和 `git push -u origin main`。
5. 在 Vercel 网页选择 Add New → Project，导入该仓库；Preset 选 Other、Root 为 `./`、Build Command 为 `npm run build`、Output Directory 为 `public`、Node.js Version 为 `24.x`。
6. 部署后验证首页和四个 API，把真实 GitHub/Web/视频 URL 写回 README 与本清单。
