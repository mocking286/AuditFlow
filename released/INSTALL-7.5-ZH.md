# JEAuditFlow 7.5.0 安装与启动

本目录交付 JEAuditFlow 7.5.0 后端、Web 客户端、浏览器扩展、数据库初始化文件、部署支持脚本和 macOS 启动器。整套安装 ZIP 与各分包内容相同。

## 默认本地部署

解压并打开 `JEAuditFlowLauncher.app`，选择包含 `local-deploy` 的安装目录，运行版本选择 `7.5.0`。建议将安装目录放在当前用户可读写的位置；启动器可放在 `~/Applications/`。

- AuditFlow：`http://127.0.0.1:47483/landing.html`
- FileAnalyst：`http://127.0.0.1:47483/fileanalyst/`
- JiraFlow：`http://127.0.0.1:47483/jiraflow/`
- MySQL：`127.0.0.1:43322`，数据库 `jeauditflow_750`
- 数据卷：`jeauditflow_750_mysql_data`

启动器支持登录本机管理员、启动、重启、停止应用服务、健康检查和打开应用。管理员密码与连接凭据保存在本机私有配置中，不包含在交付 ZIP 内。重新打开启动器后，如会话未恢复，使用本机管理员账号登录。数据库连接参数可通过启动器的“打开数据库连接说明”查看。

7.5 使用独立数据库，不会自动迁移旧版本的业务数据。已有安装应先备份配置和数据库，再核实目标数据库与数据卷。本目录的 Database 包含 SQL schema、初始化脚本和显式导入工具，不含任何用户业务数据库备份。

## 在新目录安装

运行环境要求：Apple Silicon Mac、macOS 14 或更新版本，Node.js 20+、npm、Java 21+、Docker Desktop/Compose v2、tmux、Bash、curl 和 unzip。启动器是 arm64 预编译版本，并经本地 ad hoc 签名校验；没有经过 Apple 公证。依赖首次安装需要网络。

1. 解压 `JEAuditFlow-7.5.0-Complete-Install.zip`，或将各分包放在同一个目录。整套 ZIP 内的 `SHA256SUMS.txt` 校验内部交付文件；Release 单独提供的同名文件还包含整套 ZIP 的校验值。
2. 在分包目录运行校验：

   ```bash
   shasum -a 256 -c SHA256SUMS.txt
   ```

3. 解压部署支持包，并安装同目录的后端、Web 客户端及数据库文件：

   ```bash
   unzip -q JEAuditFlow-7.5.0-Deployment-Support.zip
   cd JEAuditFlow-7.5.0-Deployment-Support
   bash local-deploy/scripts/jeauditflow-local.sh install \
     --backend ../JEAuditFlow-7.5.0-Backend.zip \
     --web-client ../JEAuditFlow-7.5.0-Web-Client.zip \
     --database ../JEAuditFlow-7.5.0-Database.zip
   ```

4. 私有配置自动生成于安装目录的 `local-deploy/config/7.5.local.env`。首次安装使用其中的管理员邮箱和随机生成的密码。检查配置后，针对以下精确目标启动：

   ```bash
   JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_750 ON jeauditflow_750_mysql_data' \
     bash local-deploy/scripts/jeauditflow-local.sh start --version 7.5.0
   bash local-deploy/scripts/jeauditflow-local.sh health --version 7.5.0
   ```

5. 解压 `JEAuditFlow-7.5.0-macOS-Launcher.app.zip`，打开启动器并选择包含 `local-deploy` 的安装目录；刷新并选择 `7.5.0`，登录本机管理员。macOS 如请求目录访问，请通过正常系统授权流程处理。

已经运行的环境可使用“重启”。停止应用服务会保留 MySQL 数据卷，不应使用 `docker compose down -v` 进行日常停止。

## 浏览器扩展

解压 `JEAuditFlow-7.5.0-Browser-Extension.zip`，通过 Edge 或 Chrome 的扩展开发者模式加载解压目录。新扩展默认连接 `http://127.0.0.1:47483`。本次验收使用临时隔离浏览器配置。扩展包包含产品内置的 FileAnalyst 演示数据，不包含本次验收的用户上传附件或运行数据库。

## 本次功能入口

- NC / Finding 跟踪位于项目的“记录表单”；打开后自动准备 JiraFlow 项目映射并同步 NC，另提供“导入 JiraFlow issues”按钮。
- “范围与资料”保留上传、解析、分类和追溯准备。
- “记录合并”提供完整证据目录、稳定过程编号、原始 ID、来源定位、过程/类型/文件/实例/角色筛选和预览。
- JiraFlow 的状态同步不等同于正式关闭 NC。正式评分、证据确认及关闭门禁仍由评估员控制。
- AI 模型凭据单独配置；本次未配置付费模型，也未执行真实付费推理。
