# JEAuditFlow 7.7.0 入口与管理员恢复

文档修订日期：2026-11-15。适用范围：本机 7.7.0，原生 MySQL 数据库 `jeauditflow_770`、端口 `43324`。数据库密码、管理员密码和账号备份均为本机私有数据，不进入发行包。

## 访问流程

1. 打开 `http://127.0.0.1:47683/`，先显示产品宣传页。
2. 点击“进入工作台”进入同源 `index.html?fromLanding=1#/dashboard` 的登录界面。
3. 使用已有账号登录。认证成功后进入工作台；会话有效时刷新可继续访问。
4. 原有 `index.html#/...` 工作台深链接仍保留登录保护及目标位置。

启动器的“打开 AuditFlow”使用宣传页入口。启动服务和升级不再通过输入框或旧的密码同步环境标记修改已有账号密码。首次空库初始化与已有数据恢复是不同操作。

## 管理员恢复

该恢复工具只处理本机 7.7 配置指定的现有管理员账号：

- 仅接受 `jeauditflow_770` 和 MySQL 端口 `43324`。
- 从私有 `local-deploy/config/7.7.local.env` 中读取已有管理员邮箱和配置密码。
- 配置解析仅接受简单字面值、单引号和双引号以及相应反斜杠转义；不执行 shell。变量展开、命令替换、命令语句、重复赋值或不支持的拼接语法会被拒绝，避免恢复成与实际配置含义不同的密码。
- 不生成、显示或通过命令参数接收密码；不会创建新账号或重新启用已停用账号。
- 在锁定目标账号的事务内先保存原账号记录，再更新密码并撤销该账号的旧会话。
- 保留账号 ID、成员身份、项目、权限、证据、人工评分和历史记录。
- 提交前重新验证密码摘要；验证失败则回滚。提交结果不确定时应先只读核验，不能盲目重试。

先从项目根目录只读检查：

```sh
node local-deploy/scripts/recover-configured-admin.mjs --check --restore-configured-admin
```

输出只含数据库身份、账号是否存在/启用、配置密码是否匹配的布尔值，不输出密码。`--check` 可在应用在线时执行。只有确认要将该账号恢复为**配置文件中已有的密码**时，先停止 7.7 应用服务，保留 MySQL 运行：

```sh
bash local-deploy/scripts/jeauditflow-local.sh stop --version 7.7.0
```

确认期间没有其他启动器或进程自动重启服务，然后执行恢复。写入命令会先探测配置的 `AUDITFLOW_PORT` 在 IPv4、IPv6 回环地址上的监听状态；端口仍被占用或无法确认停止时会拒绝写入。这段维护期间不要启动任何指向该库的认证服务，避免旧密码登录请求与会话撤销并发：

```sh
JEAUDITFLOW_CONFIRM_ACCOUNT_RECOVERY='RESET jeauditflow_770 <配置中的管理员邮箱>' \
  node local-deploy/scripts/recover-configured-admin.mjs --apply --restore-configured-admin
```

将上例中的邮箱替换为私有配置内的准确值。确认字符串不包含密码。命令默认只检查；必须同时提供 `--apply`、`--restore-configured-admin` 和匹配的确认字符串才会写入。

恢复明确成功后，再启动原有 7.7 服务并以该账号验收登录：

```sh
JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_770 ON native' \
  bash local-deploy/scripts/jeauditflow-local.sh start --version 7.7.0
```

启动确认仅适用于本段开头指定的本机原生 7.7 目标。如果恢复报告提交结果未知，保持应用停止，先执行只读 `--check` 并核对私有恢复记录，不要再次执行 `--apply`。

旧凭据备份保存在 `local-deploy/backups/account-recovery/account-recovery-*/account-before.json`，文件权限 `0600`、单次任务目录权限 `0700`。备份包含旧密码摘要和盐，应与数据库备份同等级保护，不能上传 GitHub、反馈或共享网盘。`recovery.json` 记录状态及撤销会话数量，不含密码。

回滚密码恢复时，管理员应在停用目标账号会话后，使用本机私有备份核对账号 ID，仅恢复旧的 `password_hash` / `password_salt`；不能整体覆盖账号表或恢复旧会话令牌。其他数据库和项目数据无需回退。此工具不自动执行回滚。

## 与数据迁移的边界

密码恢复不是数据迁移，不会把 7.1、7.6 数据复制到 7.7。已有 7.7 库可能包含升级后的新增工作，禁止用旧库整库覆盖。迁移、兼容与回滚策略见 `JEAuditFlow-7.7.0-Data-Upgrade-ZH.md`；先生成只读差异预检，再处理冲突和选择权威数据来源。
