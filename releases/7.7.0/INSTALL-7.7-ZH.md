# JEAuditFlow 7.7 本机安装和运行

7.7 的应用、数据库、文件目录和端口独立于 7.6。既有数据通过受控复制迁移，旧数据库和文件保留作为回退来源。

## 安装

发行目录为 artifacts/releases/7.7.0，含后端、Web Client、浏览器扩展、
原生数据库 schema、Deployment Support、macOS 启动器及公开源码。
Complete-Install.zip 汇总安装文件；SHA256SUMS.txt 用于逐件校验。
源码包不包含账号、凭据、客户审核数据、上传附件或运行日志。

启动器选择“安装发行包”，选择 7.7 发行目录，确认运行版本为 7.7.0。
运行时安装脚本校验 Node、JDK 和 JDBC 文件后使用版本固定的目录。
原生 MySQL 使用现有本机 MySQL Community Server 可执行文件，并启动专属于
7.7 的实例；不是更改已有 Homebrew 实例，也不是更改 Docker Jira。

## 迁移

停止 7.6 应用服务，保留它的 Docker MySQL。启动器的“迁移 7.6 数据到 7.7”
明确显示源 jeauditflow_760 和目标 jeauditflow_770。迁移要求目标为空，
先备份源表和文件，再比较表行数、内容 SHA-256 和全部嵌套文件。

迁移收据位于 local-deploy/runtime/backups/7.6-to-7.7/migration-receipt.json。
失败会保留现场并阻止 7.7 启动；不要删除旧库、旧文件或迁移备份。
完整脚本命令和回退说明见 local-deploy/DEPLOYMENT-SUPPORT-7.7.md。

## 入口和数据

| 项目 | 7.7 配置 |
| --- | --- |
| AuditFlow | http://127.0.0.1:47683/index.html |
| FileAnalyst | http://127.0.0.1:47683/fileanalyst/ |
| JiraFlow | http://127.0.0.1:47683/jiraflow/ |
| MySQL | 127.0.0.1:43324 / jeauditflow_770 |
| 数据目录 | local-deploy/runtime/native-mysql/7.7.0 |
| 用户文件 | local-deploy/runtime/data/7.7.0 |
| 私有配置 | local-deploy/config/7.7.local.env，权限 600 |

InnoDB 是 MySQL 的表存储引擎，负责行、索引、事务、行锁和崩溃恢复。
它使一次关联修改可以整体提交或回滚；它不是另一个数据库服务。
JiraFlow 当前在一张 InnoDB 表内保存带版本和 SHA-256 的应用快照，
尚未拆成独立的问题、项目等关系表。旧 store.bin 保留用于迁移核验。

## 连接配置

Polarion 已核验地址是 http://192.168.128.4/polarion/。VM 地址变化后需重新验证。
启动器可以配置固定地址；远端用户必须建立经授权的反向连接会话。

真实 Jira 的 PAT 或 Basic 凭据只放在本机私有配置；用
AUDITFLOW_JIRA_PROJECT_KEYS 限定允许项目。JiraFlow 使用独立的服务凭据。
Entra 和邮件字段见 7.7-sso-mail-setup.md；启用前应先核对该文件中的实测边界。

## 回退

停止 7.7 应用，切换启动器到 7.6，然后启动旧版本。7.7 新写入不会自动反向迁移。
回退前保留 7.7 的数据和备份；不要混用版本配置、端口或数据库。
