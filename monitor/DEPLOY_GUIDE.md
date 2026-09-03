# AuditFlow 后台数据监控工作台 · 部署指南

为 **AuditFlow 8.9 插件 + 线上协作站点（MySQL 模式）** 提供后台数据只读监控：
**谁在何时改了哪个项目的哪个过程、AI 评估了哪些证据溯源**。

```
┌─────────────────┐        ┌──────────────────────────────┐        ┌──────────────────┐
│  浏览器（PC/手机） │  HTTPS │  监控桥接服务 monitor-server   │ 只读   │  MySQL（线上）     │
│  monitor.html    │ ─────▶ │  /api/monitor/* (JSON)       │ SELECT │  auditflow_projects│
│  演示/实时双模式   │        │  默认 127.0.0.1:4175          │ ─────▶ │  auditflow_project│
└─────────────────┘        └──────────────────────────────┘        │  _events/_locks…   │
        ▲                                                            └──────────────────┘
        │ 演示模式（内置示例数据）也可离线查看
```

- **监控桥接服务**：`monitor-server.mjs` —— 只做 SELECT，解析 `snapshot_json` 提取 AI 评估/证据溯源，托管监控页。
- **监控工作台**：`monitor.html` —— 单文件、全内联、零依赖，手机/电脑双适配，演示数据开箱即用。
- **测试**：`test-server.mjs` —— 13 项接口端到端测试（mock store，无需真实 MySQL）。

---

## 一、部署前置

| 项 | 要求 |
|---|---|
| 服务器 | 与协作服务器同机或同内网（能访问 3306） |
| Node.js | ≥ 18（服务器已有，`node -v` 确认） |
| 依赖 | 复用协作服务器 `node_modules`（含 `mysql2`），无需重新安装 |
| MySQL | 线上库，需管理员建只读账号 |

## 二、三步上线

### 第 1 步：建只读 MySQL 账号（安全红线，必做）

```bash
mysql -uroot -p < deploy/monitor-readonly-user.sql
# 执行前先把文件里的 CHANGE_ME_PASSWORD 改成强密码
```

### 第 2 步：放文件并接依赖

```bash
# 假设协作服务器在 /opt/auditflow（按实际调整）
mkdir -p /opt/auditflow/monitor
cp monitor-server.mjs monitor.html -t /opt/auditflow/monitor/
# 复用协作服务器已装好的 mysql2（关键：不重复安装）
ln -sfn /opt/auditflow/server/node_modules /opt/auditflow/monitor/node_modules
```

### 第 3 步：注册 systemd 服务

```bash
cp deploy/auditflow-monitor.service /etc/systemd/system/
# 编辑该文件：填 AUDITFLOW_MYSQL_URL 密码、AUDITFLOW_MONITOR_TOKEN、WorkingDirectory
systemctl daemon-reload
systemctl enable --now auditflow-monitor
journalctl -u auditflow-monitor -f        # 看启动日志
```

## 三、环境变量

| 变量 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `AUDITFLOW_MYSQL_URL` | — | ✅ | 如 `mysql://af_monitor:密码@127.0.0.1:3306/auditflow` |
| `AUDITFLOW_MONITOR_TOKEN` | 空 | 推荐 | 访问令牌；前端连接时填同一个值。配置后 `?token=` 或 `X-Monitor-Token` 头鉴权 |
| `AUDITFLOW_MONITOR_PORT` | `4175` | — | 监听端口 |
| `AUDITFLOW_MONITOR_HOST` | `127.0.0.1` | — | 建议保持本机，由 nginx 反代对外；配了 token 才考虑 `0.0.0.0` |
| `AUDITFLOW_MONITOR_ALLOWED_ORIGIN` | 空 | — | 跨域白名单（页面与 API 不同源时填页面 Origin） |
| `AUDITFLOW_MONITOR_HTML` | 同目录 | — | monitor.html 路径 |

## 四、对外访问（nginx 反代，可选但推荐）

把 `deploy/nginx-monitor.conf` 的 `/monitor/` location 片段放进 80/443 server 块：

- 工作台：`http://<服务器IP>/monitor/`
- 健康检查：`curl -s http://127.0.0.1:4175/api/monitor/health -H "X-Monitor-Token: <token>"`

## 五、在工作台里连接真实数据

1. 打开 `http://<服务器IP>/monitor/`（首次进入是**演示模式**，内置示例数据）
2. 右上角「连接」→ 服务地址填 `http://<服务器IP>/monitor`（或 `http://<服务器IP>:4175`）→ 访问令牌填 `AUDITFLOW_MONITOR_TOKEN` 的值
3. 「测试连接」通过后点「保存并连接」→ 顶部变为 **实时监控**
4. 可设 30 秒/60 秒自动刷新；连接失败自动降级为最近一次数据并提示

## 六、安全清单

- [ ] 只读账号仅授 6 张表的 SELECT，验证 UPDATE 被拒（SQL 文件末尾有验证命令）
- [ ] `AUDITFLOW_MONITOR_TOKEN` 已配置且为强随机值
- [ ] 监控服务只监听 127.0.0.1，由 nginx 反代对外
- [ ] 页面「导出 JSON 备份」定期使用（数据只在浏览器与只读接口间流转，监控不写库）
- [ ] 公网部署的页面不预填敏感信息（默认演示数据，安全）

## 七、验证命令速查

```bash
curl -s http://127.0.0.1:4175/api/monitor/health
curl -s "http://127.0.0.1:4175/api/monitor/overview?token=$TOKEN" | head -c 400
curl -s "http://127.0.0.1:4175/api/monitor/projects?token=$TOKEN"  | head -c 400
curl -s "http://127.0.0.1:4175/api/monitor/events?token=$TOKEN"    | head -c 400
curl -s "http://127.0.0.1:4175/api/monitor/trace-eval?token=$TOKEN"| head -c 400
# 无 token 应 401：
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4175/api/monitor/overview   # 401
```

## 八、常见问题

| 现象 | 处理 |
|---|---|
| 服务起不来：`Access denied for user 'af_monitor'` | 只读账号密码/库名不对；确认 SQL 已执行、URL 中 `auditflow` 为真实库名 |
| 页面连接失败 401 | token 不一致：前端「连接」填的值 = `AUDITFLOW_MONITOR_TOKEN` |
| 页面连接失败 CORS | 页面与 API 不同源时，设 `AUDITFLOW_MONITOR_ALLOWED_ORIGIN` 为页面 Origin；或走同源反代（推荐） |
| 项目列表为空但 health 正常 | 库名正确但表名前缀不同（如 `af_auditflow_projects`），需改 `monitor-server.mjs` 里的表名映射 |
| 大项目详情加载慢 | `snapshot_json` 较大属正常；监控只读不阻塞协作服务器 |

## 九、本地开发（本机预览，无需 MySQL）

```bash
cd monitor
node test-server.mjs        # 13 项 mock 测试（自检用，不连库）
# 或带 mock 数据手动预览：
AUDITFLOW_MONITOR_TOKEN=dev node -e "import('./monitor-server.mjs').then(m=>m.default ? 0 : 0)"
# 直接双击打开 monitor.html 即为演示模式；接真实数据需跑起桥接服务后「连接」
```
