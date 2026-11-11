# JEAuditFlow 7.6.0 本机部署支持

此支持包提供安装脚本、MySQL Compose、非机密配置模板及 macOS 启动器源码。请使用同一发行目录中版本为 7.6.0 的 Backend、Web Client、Database、Browser Extension 和 Launcher 分包。

## 校验与安装

在下载目录执行：

```bash
shasum -a 256 -c SHA256SUMS.txt
unzip -q JEAuditFlow-7.6.0-Deployment-Support.zip
cd JEAuditFlow-7.6.0-Deployment-Support
shasum -a 256 -c SHA256SUMS.txt
bash local-deploy/scripts/jeauditflow-local.sh install --release-dir ..
bash local-deploy/scripts/jeauditflow-local.sh config --version 7.6.0
```

依赖 Node.js 20+、npm、Java 21+、Docker Compose v2、tmux、Bash、curl 和 unzip。

启动前审阅本机生成的 `local-deploy/config/7.6.local.env`，保留其中随机生成的密码和 MCP 密钥。非机密模板不能替代完整私有配置。仅在确认以下隔离目标后启动：

```bash
JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_760 ON jeauditflow_760_mysql_data' \
  bash local-deploy/scripts/jeauditflow-local.sh start --version 7.6.0
bash local-deploy/scripts/jeauditflow-local.sh health --version 7.6.0
```

7.6 使用数据库 `jeauditflow_760`、Docker 卷 `jeauditflow_760_mysql_data`、Compose 项目 `jeauditflow760-local`。MySQL 只监听 `127.0.0.1:43323`。AuditFlow 为 `47583`，FileAnalyst 为 `47584`，JiraFlow 为 `47585`，AI bridge 为 `47586`。

默认访问 `http://127.0.0.1:47583/index.html`，匿名用户先登录。宣传页保留为显式 `landing.html` 入口。FileAnalyst/JiraFlow 通过同源 `/fileanalyst/`、`/jiraflow/` 打开。

## 数据与权限

7.6 不自动复制、迁移或覆盖 7.5 的数据库、卷或用户附件。数据库包提供初始化 schema 和显式导入工具，不含业务数据。停止应用使用 `stop --version 7.6.0`，不要执行删除 Docker 卷的命令。

反馈截图和图像标注默认保存在当前浏览器本机；提交当前服务器须由用户审阅后显式操作。AI provider 在受保护配置流程中设置，真实模型推理可能产生费用。安装包不包含 provider 密钥或用户业务备份。

本机 Jira/Confluence 桥接由 Mac 主动连接受信任 HTTPS 服务器建立，只允许预设 Jira/Confluence 目标，不能将私网地址直接配置为公网服务的抓取目标。公网部署需要独立配置有效 HTTPS、账户权限和反向连接；仅安装本机分包不代表公网连接已建立。

## 启动器

解压 `JEAuditFlow-7.6.0-macOS-Launcher.app.zip`，打开启动器，选择包含 `local-deploy` 的项目目录，刷新版本并选择 `7.6.0`。启动器会针对所选数据库与卷要求确认。新电脑可能需要用户授予 Downloads 目录访问权限。

启动器的本地 ad hoc 签名与 Apple Developer ID 签名、公证不同。发行验收范围以随包验证记录为准，不能将本机通过视为新电脑或生产环境验收。
