# JEAuditFlow 7.9.5 服务器安装问题修复清单

这里列出的是原 7.9.5 候选包无法直接装到服务器上的原因，以及对应的修复。修复后已在 Ubuntu 24.04 上按 `INSTALL-7.9.5-ZH.md` 从零完成安装、启动和验证。

| # | 问题 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | 交付文件里缺少 `Web-Client.zip`（清单和 SHA256SUMS 里都登记了）；后端默认去 `../client` 找前端 | 访问 `/` 返回 403，没有可用的前端 | 用仓库中已发布的 7.7.0 前端源码重新打包 Web-Client，并加上 API 会在 `/` 返回的宣传页资源（`landing.html`、`assets/`、`next-static/` 等）。版本统一标为 7.9.5，与 7.9.5 API 做了兼容验证（7.9.5 前端源码不存在，这一点见“剩余事项”） |
| 2 | 后端包中没有 FileAnalyst 前端（`client/`）；FileAnalyst 鉴权地址默认指向 4180 端口，而 API 实际在 47983；服务器模式下 API 不会自动拉起 FileAnalyst，又没有提供 systemd 服务 | FileAnalyst 一直显示 unavailable，附件功能不可用 | FileAnalyst 前端随 Web-Client 一起发布（`client/fileanalyst`）；新增 `jeauditflow-fileanalyst.service`，并在配置模板里写全 FileAnalyst 的端口、鉴权地址和 MySQL 存储参数 |
| 3 | `ops-service.mjs` 在 Linux 上把 Windows 的 `AppData/Local/...` 目录建在当前工作目录下，也就是程序目录 | 以非 root 用户运行、程序目录只读时，API 启动直接报 `EACCES` 崩溃 | 非 Windows 系统改用 `$XDG_DATA_HOME` 或 `~/.local/share`；配置模板中显式设置 `AUDITFLOW_DATA_DIR` 和 `AUDITFLOW_RELEASES_DIR` |
| 4 | **安全问题**：`/jiraflow/*` 代理会给每个请求附上 JiraFlow 服务令牌，但不检查用户是否已登录 AuditFlow | 部署到服务器后，匿名访问者可以读写 JiraFlow（实测匿名请求创建了 issue） | 在非桌面模式下，代理前必须有有效的 AuditFlow 会话，否则返回 401；桌面启动器的行为保持不变 |
| 5 | `jiraflow/lib/mysql-connector-j-26.10.0.jar` 在 zip 里的权限是 600 | 由 root 解压、再以服务用户运行时，JiraFlow 读不到 JDBC 驱动，MySQL 存储失败 | 打包时统一把权限设为 644/755；安装脚本统一设置为 `root:jeauditflow` 640/750 |
| 6 | 没有 JiraFlow 使用 MySQL 的配置（`JIRAFLOW_STORAGE`、`JIRAFLOW_MYSQL_*`） | JiraFlow 退回本地文件存储，没有写入 `jiraflow_state` 表 | 配置模板补齐这些参数，已实测状态写入了 MySQL |
| 7 | `server/package.json` 和 `fileanalyst/package.json` 里的 `npm run check` 引用了根本不存在的文件（`api/index.mjs`、`cloud/lib/*`、`deploy/*`、`app.js`、`client/*`） | 安装后自检失败 | 改为检查包内实际存在的全部模块；构建时会执行 `npm ci` 和 `check` |
| 8 | 数据库包缺少建库和建用户的步骤；`migrate.sh` 和 `install-schema.sh` 字节完全相同，没有任何说明 | 全新服务器上不知道如何开始，`install-schema.sh` 会因为库不存在而失败 | 新增 `create-database.sh`（需要确认短语）；`migrate.sh` 写明 7.9.5 没有表结构变化；README 改写为完整流程 |
| 9 | `Database.tar.gz` 是在 macOS 上打的包，带有 `LIBARCHIVE.xattr.com.apple.provenance` 扩展头 | 用 GNU tar 解压时出现几十行警告 | 改用 GNU tar `--no-xattrs` 和 root 属主重新打包 |
| 10 | 校验和与清单不一致：`SHA256SUMS-a.txt` 和 `release-manifest.json` 登记了没有交付的 Web-Client 与 Browser-Extension 包，并标注 `integrity: passed` | 按清单校验会失败 | 重新生成全部 SHA256SUMS 和 `release-manifest.json`；未交付的包单独列在 `notIncluded` 中 |
| 11 | 没有服务器部署方式：只有 macOS 启动器（`jeauditflow-local.sh`），没有 systemd、反向代理和安装脚本；API 只监听 127.0.0.1 | 无法在 Linux 服务器上安装，也无法通过域名访问 | 新增 `install.sh`、两个 systemd 服务、`jeauditflowctl`、nginx 配置（已屏蔽旧运维面板的注册和管理接口）、`verify.sh` 和可选的 MySQL Docker Compose |
| 12 | 后端依赖在安装时需要联网执行 `npm ci` | 内网服务器装不上 | Backend.zip 内置生产 `node_modules`（全部是纯 JS 依赖），与 lockfile 一致 |
| 13 | 宣传页仍显示 “JEAuditFlow 7.7.0 / v7.7.0” | 版本显示混乱 | 打包时统一改为 7.9.5（帮助手册和手册 PDF 的内容本身就是 7.7 版，保留 7.7.0） |

另外核对过、确认没有问题的项：上传的零散文件 `server.mjs`、`requirements.mjs` 等与 Backend.zip 内 `fileanalyst/` 里的文件逐字节相同，并不比包内的新；`SHA256SUMS-b.txt` 就是 Backend.zip 自带的校验清单；`jiraflow.jar` 与清单中的哈希一致，源码哈希 `7070c021…` 与仓库中 7.7.0 的 JiraFlow 源码一致；Node 26.13.1 是真实存在的 LTS 版本，`engines` 要求合理。

## 剩余事项

- **Web 前端是 7.7.0 代码**：没有 7.9.5 的前端源码，也没有原版 Web-Client 包。核心功能（登录、项目、协作、FileAnalyst、JiraFlow）已验证可用；7.9.5 新增的 Cursor Agent 提供方和 AI 外发确认流程，7.7 前端里没有对应界面。
- **浏览器插件包**（Browser-Extension.zip）没有提供，无法重建。
- 没有 systemd 环境验证 `systemctl` 本身：本次在没有 systemd 的容器里，用与 unit 文件完全相同的用户、环境文件、工作目录和启动命令运行验证。nginx 和 Docker Compose 也没有实际运行过。
