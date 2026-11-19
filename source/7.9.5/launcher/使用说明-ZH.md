# JEAuditFlow 7.9.5 本地启动器（macOS）使用说明

双击 `JEAuditFlowLauncher.app`，就会把这台 Mac 作为 JEAuditFlow 7.9.5 服务器启动（FileAnalyst、AuditFlow API、JiraFlow），并在浏览器中打开工作台。数据库直接使用 **TablePlus 中已经配置好的本机 MySQL 连接**，正常情况下不需要选择目录、确认数据库或手动登录测试台。

启动器保留了原 7.7 启动器的名称、Bundle ID（`local.maplemock.jeauditflowlauncher`）和图标，安装后直接替换原来的应用。

## 一、安装（只做一次）

在“终端”中执行（路径换成本仓库在你电脑上的位置）：

```sh
bash source/7.9.5/launcher/install-launcher.command
```

它会：

1. 退出正在运行的 7.7 启动器窗口（已经在运行的服务不受影响），把旧应用打包备份到 `~/Library/Application Support/JEAuditFlow/launcher-backups/`；
2. 把新启动器复制到 `/Applications`（没有写权限时用 `~/Applications`）；
3. 去掉隔离标记，并做本机临时签名（生成 `Contents/_CodeSignature/CodeResources`），macOS 不会再提示“已损坏”；
4. 打开启动器。

运行环境：Node.js ≥ 26.13.1、Java ≥ 21。启动器会优先使用项目里已经准备好的工具链（`AuditFlowDesktop71/local-deploy/runtime/toolchains`），其次是 Homebrew（`brew install node openjdk@21`）。

## 二、双击后会发生什么

1. **找到 7.9.5 程序**：依次查找上次使用的目录、`~/JEAuditFlow/7.9.5`，以及 7.7 启动器记住的项目目录（例如 `AuditFlowDesktop71/local-deploy/runtime/versions/7.9.5`）。都没有时，会自动安装放在应用旁边、`下载`、`桌面` 或项目 `artifacts/releases` 中的 `JEAuditFlow-7.9.5-Server-Install.tar.gz`（先做 SHA-256 校验）。
2. **选择数据库**（第一次选好后会记住）：
   1. TablePlus 中本机（`127.0.0.1` / `localhost`、不经过 SSH）的 MySQL / MariaDB 连接。数据库名为 `jeauditflow_795`、名称含 7.9.5、端口 43327 的连接优先；
   2. 项目配置 `local-deploy/config/7.9.5.local.env`（7.x 测试台创建的同一个库）；
   3. 以上都没有时，启动器自己建一个专用 MySQL（127.0.0.1:43327，需要 `brew install mysql`）。

   如果有多个同样合适的 TablePlus 连接，只会在第一次弹出一个列表让你选。
3. **读取密码**：TablePlus 的密码保存在钥匙串里。第一次会出现“security 想要使用钥匙串中的机密信息”的提示，点 **允许**。之后密码保存在启动器配置中（权限 600），不会再提示。如果钥匙串里没有找到，启动器会请你输入一次密码。
4. **数据库服务器没在运行时**：自动启动项目内的 MySQL 实例、对应端口的 Docker 容器，或 Homebrew 的 MySQL（3306）。
5. **准备数据库**：如果该连接上还没有 `jeauditflow_795` 或其中没有数据表，**只在第一次**弹窗确认一次，然后执行 `CREATE DATABASE/TABLE … IF NOT EXISTS`。不会删除或修改已有的库和数据，也不会迁移 7.7 的数据。库和表已存在时不弹窗。
6. **启动服务并打开工作台** `http://127.0.0.1:47983/index.html`（使用项目配置时为其中的端口）。第一次创建管理员时会弹窗显示账号和初始密码，同时保存在 `~/Library/Application Support/JEAuditFlow/7.9.5/admin-login.txt`。

## 三、本机作为服务器（同一 Wi-Fi 的同事访问）

- 启动器会自动识别本机的 Wi-Fi 地址（只用私有网段，如 192.168.x.x），同事在浏览器打开 `http://<本机 Wi-Fi 地址>:47983/` 即可访问。地址会显示在启动完成的通知和弹窗里。
- 第一次可能出现“是否允许 node 接受传入的网络连接”的提示，请点 **允许**。
- Wi-Fi 地址变化后，再双击一次启动器会自动重启服务并改用新地址。
- 只允许本机访问时，在 `~/Library/Application Support/JEAuditFlow/7.9.5/launcher.conf` 中加一行 `LAN=off`。
- 健康检查、首次管理员初始化等接口仍然只允许在本机访问。

## 四、日常使用

- 服务已经在运行时再双击：直接打开工作台，并弹出一个 20 秒后自动关闭的小窗口，可以选择“复制局域网地址”或“停止服务”。
- “停止服务”只停止 JEAuditFlow 的服务，TablePlus 对应的 MySQL 保持运行。
- 终端命令：

  ```sh
  L=/Applications/JEAuditFlowLauncher.app/Contents/MacOS/JEAuditFlowLauncher
  $L start | stop | restart | status | open | logs
  $L database          # 显示当前使用的数据库连接
  $L choose-database   # 重新选择 TablePlus / 项目配置中的数据库连接
  $L stop-all          # 同时停止由启动器启动的 MySQL（不会停止你自己启动的 MySQL）
  $L choose-root       # 重新选择 7.9.5 程序目录
  $L install ~/Downloads/JEAuditFlow-7.9.5-Server-Install.tar.gz
  ```

## 五、端口与目录

| 项目 | 值 |
| --- | --- |
| 工作台 | http://127.0.0.1:47983/index.html |
| 同一 Wi-Fi 访问 | http://<本机 Wi-Fi 地址>:47983/ |
| FileAnalyst / JiraFlow | 47984 / 47985（只监听本机） |
| 数据库 | TablePlus 中的本机 MySQL 连接，库名 `jeauditflow_795` |
| 启动器配置 | `~/Library/Application Support/JEAuditFlow/7.9.5/launcher.conf`（权限 600） |
| 数据目录 | 项目内为 `local-deploy/runtime/data/7.9.5`，否则为 `~/Library/Application Support/JEAuditFlow/7.9.5/data` |
| 日志 | `~/Library/Logs/JEAuditFlow/7.9.5/` |

使用项目配置 `7.9.5.local.env` 时，端口、管理员初始密码以及 Jira、SSO、邮件、AI 等设置都沿用其中的值，与 7.x 测试台启动时一致。

## 六、常见问题

- **提示“上次使用的数据库没有在运行”**：先在 TablePlus 对应的 MySQL（Docker、Homebrew 或项目内实例）启动后再双击；或者在弹窗中点“重新选择数据库”。
- **提示账号没有创建数据库的权限**：按弹窗中的 SQL 在 TablePlus 中用管理员账号执行一次，再重新打开启动器。
- **端口被占用**：通常是 7.x 测试台启动的旧服务，先在测试台中停止它。
- **需要 Node.js 26.13.1 / Java 21**：执行 `brew install node openjdk@21`，或先用 7.x 测试台准备项目工具链。
- **想换数据库**：执行 `$L choose-database`，启动器会切换并重启服务。
