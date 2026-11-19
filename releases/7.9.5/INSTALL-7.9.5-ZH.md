# JEAuditFlow 7.9.5 服务器安装指南（Linux）

本指南把 JEAuditFlow 7.9.5 的后端（AuditFlow API、FileAnalyst、JiraFlow）和 Web 前端直接安装到一台 Linux 服务器上：Node.js 和 MySQL 直接装在系统上（裸机方式），用 systemd 管理服务，nginx 对外提供 HTTPS。如果更习惯用 Docker 跑 MySQL，见第 9 节。

已在 Ubuntu 24.04 + MySQL 8.0.46 + OpenJDK 21 + Node.js 26.13.1 上完整验证：从全新安装到浏览器登录、建项目、上传附件、打开 JiraFlow 都已跑通。

> 想把一台 Mac 当作服务器（数据库用 TablePlus 中已配置的本机 MySQL，双击即启动）：见 `source/7.9.5/launcher/使用说明-ZH.md`。

## 1. 发布包

| 文件 | 用途 |
| --- | --- |
| `JEAuditFlow-7.9.5-Server-Install.tar.gz` | **推荐。** 一体化安装包，内含下面三个 zip、`install.sh`、`deploy/` 和本文档 |
| `JEAuditFlow-7.9.5-Backend.zip` | API 服务（`server/`）、FileAnalyst（`fileanalyst/`）、JiraFlow（`jiraflow/`），已内置生产依赖 `node_modules`，可离线安装 |
| `JEAuditFlow-7.9.5-Web-Client.zip` | 浏览器前端（工作台、宣传页、FileAnalyst 界面） |
| `JEAuditFlow-7.9.5-Database.zip` / `.tar.gz` | MySQL 建库脚本与 schema（内容相同） |
| `SHA256SUMS.txt`、`release-manifest.json` | 校验和与版本清单 |

先校验：

```sh
sha256sum -c SHA256SUMS.txt
```

> Web 前端说明：这次上传的文件里没有 7.9.5 的 Web-Client 包，所以前端是用仓库里已发布的 7.7.0 前端源码重新打包的，版本号已改为 7.9.5，并与 7.9.5 API 做了兼容验证。如果手上有原版 `JEAuditFlow-7.9.5-Web-Client.zip`，可以直接替换 `/opt/jeauditflow/7.9.5/client` 目录的内容。浏览器插件包（Browser-Extension.zip）同样未提供，本次不包含。

## 2. 前置条件

- Linux x86_64 或 arm64，并且有 systemd（Ubuntu 22.04/24.04、RHEL 9 等）
- **Node.js ≥ 26.13.1**。系统自带的 Node 一般版本太旧；可以让安装脚本自动下载（`--install-node`，会校验官方 SHA256），也可以先手动下载 tar 包
- **Java ≥ 21**（OpenJDK，供 JiraFlow 使用）：`sudo apt install openjdk-21-jre-headless`
- **MySQL ≥ 8.0**（InnoDB、utf8mb4），监听 `127.0.0.1:43327`
- 工具：`unzip`、`curl`、`python3`
- 对外访问：nginx 和域名 TLS 证书。API 只监听 `127.0.0.1`，这是有意的设计

## 3. 安装 MySQL（端口 43327）

Ubuntu 示例：

```sh
sudo apt install -y mysql-server
# 在 /etc/mysql/mysql.conf.d/mysqld.cnf 的 [mysqld] 段设置：
#   port = 43327
#   bind-address = 127.0.0.1
sudo systemctl restart mysql
```

如果服务器上已有 MySQL 跑在 3306，也可以单独起一个 43327 实例，或用第 9 节的 Docker 方式。

## 4. 安装程序

```sh
tar xzf JEAuditFlow-7.9.5-Server-Install.tar.gz
cd JEAuditFlow-7.9.5-Server-Install
sudo bash install.sh --install-node      # 已装好 Node ≥ 26.13.1 时可以省略 --install-node
# 服务器不能上网时：sudo bash install.sh --node-tarball node-v26.13.1-linux-x64.tar.xz
```

安装脚本会做这些事：校验包、检查 Node/Java、创建系统用户 `jeauditflow`，然后把文件放到下面的位置，并安装 systemd 服务和 `jeauditflowctl` 命令。

| 位置 | 内容 |
| --- | --- |
| `/opt/jeauditflow/7.9.5/` | 程序：`server/` `fileanalyst/` `jiraflow/` `client/` `database/` `deploy/` |
| `/opt/jeauditflow/node/` | Node.js 26.13.1 |
| `/var/lib/jeauditflow/7.9.5/` | 数据（权限 700，属主 jeauditflow） |
| `/etc/jeauditflow/7.9.5.env` | 配置（权限 640） |

重复执行安装脚本时，已有的配置和数据都会保留；旧程序目录会改名为 `7.9.5.previous-<时间>`。

## 5. 建库和导入 schema

```sh
D=/opt/jeauditflow/7.9.5/database
# ① 用 MySQL 管理员账号建库建用户（管理员凭据放在 600 权限的 cnf 文件里）
sudo MYSQL_ADMIN_DEFAULTS_FILE=/root/.my.cnf MYSQL_PASSWORD='<应用数据库密码>' \
  bash $D/create-database.sh --confirm "CREATE jeauditflow_795"
# ② 给应用账号写客户端配置
sudo install -m 600 /dev/null /etc/jeauditflow/mysql-client.cnf
sudo tee /etc/jeauditflow/mysql-client.cnf >/dev/null <<'EOF'
[client]
user=jeauditflow
password=<应用数据库密码>
EOF
# ③ 导入 schema 并检查
sudo MYSQL_DEFAULTS_FILE=/etc/jeauditflow/mysql-client.cnf bash $D/install-schema.sh --confirm "APPLY jeauditflow_795"
sudo MYSQL_DEFAULTS_FILE=/etc/jeauditflow/mysql-client.cnf bash $D/healthcheck.sh
# 正常输出：jeauditflow_795  43327  InnoDB  1
```

7.9.5 沿用 schema 29，没有表结构变化。`migrate.sh` 只是重新执行幂等的 schema；API 启动时会自动补齐运行期需要的列和索引。它**不会**迁移 7.7 的数据。

## 6. 配置 `/etc/jeauditflow/7.9.5.env`

所有 `<...>` 占位符都要改成真实值。占位符没改完时，`jeauditflowctl start` 会拒绝启动。

| 变量 | 说明 |
| --- | --- |
| `AUDITFLOW_MYSQL_URL`、`FILEANALYST_MYSQL_URL` | `mysql://jeauditflow:<密码>@127.0.0.1:43327/jeauditflow_795`。密码里的 `@ : / ? # %` 等字符要做 URL 编码，例如 `@` 写成 `%40` |
| `JIRAFLOW_MYSQL_PASSWORD` | 同一个数据库密码，原文填写，不编码 |
| `AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL` / `AUDITFLOW_ADMIN_NAME` / `AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD` | 首次启动时、库里还没有任何账号的情况下，用这三项创建管理员。密码 10–200 位。**不设置的话就没有任何账号可以登录。** 首次登录成功后，建议删掉密码那一行再重启 |
| `AUDITFLOW_PORT=47983`、`FILEANALYST_PORT=47984`、`JIRAFLOW_PORT=47985` | 都只监听本机回环地址 |
| `JIRAFLOW_JAVA` | 安装脚本会自动填成本机的 Java 路径 |
| `AUDITFLOW_TRUSTED_PROXY_HOSTS` / `AUDITFLOW_TRUSTED_PROXY_SECRET` | 可选，nginx 反代时使用（见第 8 节） |
| `AUDITFLOW_JIRA_*` | 可选，Jira REST 通道。**Jira 必须监听在本服务器的 127.0.0.1**（代码只连回环地址），或者由用户通过已授权的反向连接器转发 |
| `AUDITFLOW_SSO_ENTRA_*`、`AUDITFLOW_MAIL_*` | 可选，Microsoft Entra 单点登录 / Graph 邮件；回调地址为 `https://<域名>/api/auth/sso/callback` |
| `DEEPSEEK_API_KEY` 等 | 可选，AI 功能，不配置就保持关闭 |

## 7. 启动、停止、查看

```sh
sudo jeauditflowctl start      # 启用并启动 jeauditflow-fileanalyst 和 jeauditflow-api，然后做健康检查
sudo jeauditflowctl stop
sudo jeauditflowctl restart
sudo jeauditflowctl status
sudo jeauditflowctl health
sudo jeauditflowctl logs 200   # 查看 journald 日志
```

JiraFlow 由 API 服务自动拉起，它的日志在 `/var/lib/jeauditflow/7.9.5/auditflow/logs/jiraflow.log`。

## 8. nginx 与域名

```sh
sudo cp /opt/jeauditflow/7.9.5/deploy/nginx/jeauditflow-7.9.5.conf /etc/nginx/conf.d/
# 把 auditflow.example.com 和证书路径改成你自己的
sudo nginx -t && sudo systemctl reload nginx
```

nginx 必须转发 `Host` 和 `X-Forwarded-Proto`（配置文件里已经写好），否则登录时会报“Cross-origin request rejected”。走 HTTPS 时会话 Cookie 会自动加上 `Secure`。这份配置还屏蔽了旧版桌面运维面板（`/api/v1/auth|admin`、`/ops.html`）：那个面板会把第一个注册的人设为运维管理员，不适合暴露到公网。

## 9. 可选：用 Docker 运行 MySQL

```sh
cd /opt/jeauditflow/7.9.5/deploy/docker
sudo cp ../../database/.env.example .env && sudo chmod 600 .env   # 填入真实密码
sudo docker compose --env-file .env up -d
```

这个容器会自动创建数据库和用户，之后只需要执行第 5 节的第 ② 步和第 ③ 步。（这份 compose 文件本次没能在 Docker 环境里实际运行过。）

## 10. 安装后验证

```sh
sudo VERIFY_EMAIL='<管理员邮箱>' VERIFY_PASSWORD='<管理员密码>' bash /opt/jeauditflow/7.9.5/deploy/verify.sh
# 走 nginx 验证：…/verify.sh https://auditflow.example.com
```

全部显示 PASS 才算正常。然后用浏览器打开 `https://<域名>/`（宣传页）→ “Open workspace” → 登录 → 工作台；`/fileanalyst/` 和 `/jiraflow/` 应该能正常打开。

浏览器控制台里会看到访问 `127.0.0.1:46976 / 4173 / 8787` 等地址失败（ERR_CONNECTION_REFUSED），这是前端在探测用户本机的可选 AI/Codex 桥接服务，不影响使用。

## 11. 安全提示

- `/api/auth/register` 允许任何人自助注册（7.x 一贯如此）。新账号在被负责人加入项目之前看不到任何项目。如果不希望开放注册，可以在 nginx 里加 `location = /api/auth/register { return 404; }`
- 不要把 43327、47983–47985 端口开放到公网
- 备份：`mysqldump jeauditflow_795` 加上 `/var/lib/jeauditflow/7.9.5/` 目录

## 12. 必须由使用方提供的内容

数据库密码（以及 MySQL 管理员凭据）、管理员邮箱和初始密码、服务器域名和 TLS 证书。按需提供：Jira PAT 或用户名密码、项目 Key 白名单、Entra 租户 / 客户端 ID / 密钥、发件邮箱、AI 服务的 API Key。这些都不在发布包里。
