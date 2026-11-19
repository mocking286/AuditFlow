# JEAuditFlow 7.9.5 本地启动器（macOS）使用说明

`JEAuditFlowLauncher.app` 会在本机启动 JEAuditFlow 7.9.5（MySQL、FileAnalyst、AuditFlow API、JiraFlow），然后在浏览器中打开工作台 `http://127.0.0.1:47983/index.html`。

它保留了原启动器的应用名称、Bundle ID（`local.maplemock.jeauditflowlauncher`）和图标。原来的 7.7 启动器是 Swift 编译的程序，里面写死了 7.6/7.7 的端口和迁移逻辑，而且无法在本次的构建环境中重新编译。所以 7.9.5 版改成了脚本启动器：同时支持 Apple 芯片和 Intel 芯片，不需要安装 Xcode。

## 一、准备（只需要做一次）

在“终端”里安装运行环境：

```sh
brew install node openjdk@21 mysql   # Node 必须 ≥ 26.13.1，Java ≥ 21，MySQL ≥ 8.0
```

不需要执行 `brew services start mysql`。启动器会自己运行一个专用的 MySQL 实例（端口 43327，数据保存在启动器的数据目录中），不会改动你已有的 MySQL。

## 二、安装启动器

1. 解压 `JEAuditFlowLauncher-7.9.5.zip`，把 `JEAuditFlowLauncher.app` 拖到“应用程序”文件夹（或 `~/Applications`）。
2. 修改过的应用需要重新签名，并去掉下载隔离标记，否则 macOS 会提示“已损坏”或“无法验证开发者”：

   ```sh
   xattr -dr com.apple.quarantine /Applications/JEAuditFlowLauncher.app
   codesign --force --deep -s - /Applications/JEAuditFlowLauncher.app
   codesign --verify --deep --verbose /Applications/JEAuditFlowLauncher.app   # 应显示 valid on disk
   ```

   这里用的是本机临时签名（ad-hoc），没有经过 Apple 公证。如果仍然被拦截，可以在 Finder 中按住 Control 点按应用并选择“打开”，或者到“系统设置 → 隐私与安全性”中点击“仍要打开”。

## 三、第一次运行

1. 双击 `JEAuditFlowLauncher.app`。
2. 如果还没有 7.9.5 程序目录，启动器会提示选择：
   - **选择安装包…**：选择 `JEAuditFlow-7.9.5-Server-Install.tar.gz`。启动器会先做 SHA-256 校验，再安装到 `~/JEAuditFlow/7.9.5`。
   - **选择已有目录…**：选择已经解压好的 7.9.5 目录（目录里应有 `server`、`fileanalyst`、`jiraflow`、`client`）。也可以选择旧的 7.x 项目目录（例如 `AuditFlowDesktop71`），启动器会自动查找其中的 `local-deploy/runtime/versions/7.9.5`。
3. 启动器会依次完成以下步骤（第一次大约需要 30 秒）：检查 Node 和 Java → 初始化并启动本地 MySQL → 建库并导入 schema → 启动 FileAnalyst → 启动 API 和 JiraFlow → 打开浏览器。
4. 第一次运行时会弹窗显示管理员账号和初始密码（默认账号为 `yumeng.li@johnsonelectric.com`）。这些信息同时保存在 `~/Library/Application Support/JEAuditFlow/7.9.5/admin-login.txt`（权限 600）。

数据库密码、MySQL root 密码和管理员初始密码都在你的电脑上随机生成，不包含在发布包里。

## 四、日常使用

- 双击启动器：服务没在运行就启动；已经在运行就直接打开工作台。弹窗中可以选择“打开工作台”“健康状态”“停止服务”或“完成”。
- 选“完成”只是关闭弹窗，服务会在后台继续运行；选“停止服务”会同时停止应用服务和本地 MySQL。
- 也可以在终端里用命令操作：

  ```sh
  L=/Applications/JEAuditFlowLauncher.app/Contents/MacOS/JEAuditFlowLauncher
  $L start | stop | stop-all | status | open | logs | choose-root
  $L install ~/Downloads/JEAuditFlow-7.9.5-Server-Install.tar.gz
  ```

## 五、端口与目录

| 项目 | 值 |
| --- | --- |
| 工作台（调试页面） | http://127.0.0.1:47983/index.html |
| 健康检查 | http://127.0.0.1:47983/api/health |
| FileAnalyst / JiraFlow | 47984 / 47985（只监听本机） |
| MySQL | 127.0.0.1:43327，数据库 `jeauditflow_795` |
| 程序目录 | `~/JEAuditFlow/7.9.5`（可以用 `choose-root` 修改） |
| 配置与数据 | `~/Library/Application Support/JEAuditFlow/7.9.5/` |
| 日志 | `~/Library/Logs/JEAuditFlow/7.9.5/` |

## 六、常见问题

- **提示需要 Node.js 26.13.1**：执行 `brew install node` 或 `brew upgrade node` 后重新打开启动器。
- **提示端口 43327 被另一个 MySQL 占用**：先停掉占用该端口的实例（例如 7.7 启动器创建的实例），再重新打开启动器。
- **想从头开始**：先执行 `stop-all`，再删除 `~/Library/Application Support/JEAuditFlow/7.9.5`。注意：这会删除本地数据库和附件。
- 7.9.5 使用的数据库、端口和目录都独立于 7.6/7.7。启动器**不会**迁移 7.7 的数据。
