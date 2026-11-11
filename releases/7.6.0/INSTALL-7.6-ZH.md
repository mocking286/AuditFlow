# JEAuditFlow 7.6.0 本机安装

## 文件

完整安装包包含 Backend、Web Client、Browser Extension、Database、Deployment Support 和 macOS Launcher。数据库文件是结构和工具，不包含现有用户数据库的内容。

解压后先在发行目录运行：

```sh
shasum -a 256 -c SHA256SUMS.txt
```

## 隔离安装

使用项目内的部署脚本：

```sh
bash local-deploy/scripts/jeauditflow-local.sh install --release-dir artifacts/releases/7.6.0
JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_760 ON jeauditflow_760_mysql_data' \
  bash local-deploy/scripts/jeauditflow-local.sh start --version 7.6.0
bash local-deploy/scripts/jeauditflow-local.sh health --version 7.6.0
```

首次启动会生成本机私有配置。不要把 `local-deploy/config`、`local-deploy/runtime` 或 MCP 连接文件上传到 GitHub。

| 服务 | 地址或标识 |
| --- | --- |
| 登录与工作台 | `http://127.0.0.1:47583/` |
| 明确访问宣传页 | `http://127.0.0.1:47583/landing.html` |
| FileAnalyst | `http://127.0.0.1:47583/fileanalyst/` |
| JiraFlow | `http://127.0.0.1:47583/jiraflow/` |
| MySQL | `127.0.0.1:43323` |
| 数据库 | `jeauditflow_760` |
| MySQL 卷 | `jeauditflow_760_mysql_data` |

启动器选择 `7.6.0` 后，打开 AuditFlow 应进入登录与工作台入口。7.5 的配置、数据库和卷继续独立存在。

## AI 模型

在设置中配置自己的 OpenAI 兼容 API 地址、模型与 Key。Key 只通过受保护的本机配置接口处理，不写入发行文件。未配置时 Harness 会记录未执行推理，不应把此状态当作已完成 AI 审核。真实模型测试可能产生费用，需要用户授权后进行。

## 公网桥接

公网端和 Mac 本机均需运行 7.6。先在公网工作台右上角创建会话，再将一次性连接信息填入 Mac 工作台的“本机服务桥接”。Mac 连接器主动连接公网 HTTPS 地址；之后可从会话链接访问本机 Jira 与 Confluence。

本机服务固定为 `127.0.0.1:8080` 和 `127.0.0.1:8090`。公网服务不会直接拨号访问 `192.168.8.42`。停止连接器或撤销会话会终止访问；此功能不修改 Atlassian 的安装目录或数据库。

本次交付的本机验证、模拟中继验证和公网实际部署状态分别记录于验证文件。
