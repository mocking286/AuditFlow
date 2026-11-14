# JEAuditFlow 7.7.0

验证日期：2026-11-14；桥接后续验证至 2026-11-15，Asia/Shanghai。

## 本次变更

- 启动器增加 Polarion 固定目标配置；页面右上方增加 Polarion 入口。远端通过登录用户所属的反向桥接会话访问，Polarion 仍使用自己的登录认证。
- Trace Assessment Excel Report 的 Records 表保留参考工作簿前 14 列，并增加证据正文、定位、角色、Owner、期限、复核状态、评估名称和原始记录链接。Evidence 表导出实际可保留的内容；没有正文时明确说明内容不可用，不以文件名替代。
- 本地 Atlassian Jira 与 JiraFlow 各有独立接口。Lead Assessor 可预览已复核的 Finding/NC，选择 Jira 项目、工单类型及可选负责人登录名，再确认建单。创建后必须读回核对，才回写为 corroborating 佐证。
- Jira 与 JiraFlow 状态同步只更新工单证据和关联元数据。评分、人工确认、正式 Finding 关闭状态继续由评估师和关闭门禁控制。
- 记录表单增加审核任务分派弹窗，支持备注、期限和审核项。Assessor 可向同项目、同授权过程范围内的 Assessor 分派；Lead 可分派过程、BP/GP 和问题任务。评审进度包含过程域 dashboard、任务状态及 Recent Activity。
- 接入 Microsoft Entra OIDC 配置和任务邮件通知。支持 Microsoft Graph 与显式启用的本机 Outlook desktop 适配器。接口接受邮件仅记录 accepted，不表示邮件已到达收件箱。
- 7.7 使用独立的本机 MySQL 数据目录和 jeauditflow_770 数据库，AuditFlow、FileAnalyst、JiraFlow 均使用该实例。JiraFlow 保持应用快照结构，并以带修订和校验的 InnoDB 事务保存。
- 使用版本固定的 Node.js 26.13.1、OpenJDK 27.0.1.0.3 和 MySQL Connector/J 26.10.0。运行时下载记录包含官方地址及 SHA-256。Docker Jira 的运行时和数据库不在升级范围。

## 验证

初始功能基线应用回归：528/528 通过（Node.js 26.13.1）；npm run check 和新增模块语法检查通过。
六种公开模板的清理与实际导出验证 3/3 通过。
部署脚本、JiraFlow 旧快照兼容、原生 MySQL 启停及重复 schema 应用另有隔离验证。
本机升级已完成：22 张表 / 927 行、16 个文件迁移核验通过；重启后
AuditFlow、FileAnalyst、JiraFlow 和 AI bridge 均健康。6 个账号、
8 个 AuditFlow 项目和 744 条 assessor records 保留，源库哈希未变化。
JiraFlow 的 9 个项目、16 个问题、4 个用户、8 个事件在重启后保留。
启动器 7.7 的签名和发行包文件一致性检查通过；公开源码包的 216 项测试通过。

## Jira 与 Polarion 后续修复联调

以下是 2026-11-14 后续修复的当前状态，与上述原升级、迁移及功能基线验证分开记录。

- 修复 Polarion Cookie 路径重复拼接：上游 `Path=/polarion` 映射到当前桥接会话的正确路径，继续保持会话隔离。
- 处理 Foundation URLSession 将多条 `Set-Cookie` 合为字符串的情况，分别保留会话及 CSRF Cookie，并兼容 `Expires` 日期和带引号值中的逗号。
- Atlassian 启动器可从明确配置的环境变量、有效已保存地址或当前 JEAuditFlow 项目的版本配置中自动填写 Polarion 地址。保留有效的用户选择，校验后仅保存在本机；公开源码不固化虚拟机私网 IP。地址校验使用实际 IP 解析，仍限制为可信私网或 loopback 及固定 `/polarion/` 路径。
- 排查确认先前运行的后端早于 Cookie 修复，运行目录仍是旧逻辑。因此源码和发行包校验通过不能代替本机服务更新后的验收。
- 修复大型页面静态资源 HTTP 429：无正文的浏览器资源使用独立、有上限的并发和频率预算；API/写请求保留原限额。
- 修复约 7.08 MB 的 GWT 主脚本在 Base64 校验时触发栈溢出、最终桥接 504 的问题；保留既有 8 MiB 响应上限，不扩大上传范围。
- 修复 Polarion GWT XSRF RPC 的模块地址不匹配：只把当前会话的模块基址与匹配请求头还原为 `/polarion/gwt/...`，保留认证、XSRF、序列化策略及业务参数。
- 44/44 桥接、完整 HTTP 链路及桥接面板测试通过；启动器 XCTest 12/12 通过。安装后的真实 Edge + Atlassian 启动器桥接已通过管理员登录、E-Library 内容显示及文档导航；源码与运行目录的两个服务模块一致。
- 动态更新的图标和链接纳入当前会话路径重写，图片 `src` 预加载在发出请求前重写；最终页面可见缺图数为 0。部分离线 HTML 菜单预加载仍留有根路径 404 历史记录，不宣称 Network 零错误。
- 启动器重开后 Polarion 地址已填好；服务状态能显示三项路由和最近 HTTP 响应。虚拟机地址仅保存在本机配置中。
- 操作者完成的 Jira 登录已证明认证有效，但原生页面仍跳到工作台根路径 `/default.jsp`；ASPICE 面板的动态 `/s/...` 资源也绕过桥接而返回 404。现已精确修正 Jira 原生 WRM context 数据与旧版 `window.contextPath` 初始化值，覆盖登录后导航和延迟资源加载，保留服务相对的 `os_destination`，避免重复前缀。最终登录页中两项原生路径已读回正确；重载后新会话的已认证看板/侧边栏验收等待操作者登录。
- 后续真实登录已自动进入桥接内的 System Dashboard。看板还需在原生加载前修正 `script.src` 和 `link.href`，而不能只依赖加载后的 DOM 观察器。临时回环预览已显示项目侧边栏、四列共 20 张卡片，并可点击打开问题详情；关键脚本和样式资源加载无失败。该补丁已加载到正常端口并读回确认，临时预览已停止；最终正常端口的看板验收等待新会话登录。
- 本轮后端、Web、扩展、支持与源码候选包已重建；源码 ZIP 完整性、384 个内部校验项及变更文件逐字节核对通过。按清单安装依赖后，公开源码语法检查及 227/227 项测试通过。完整看板预览已通过，正常端口最终新会话的登录验收单独标记为待确认。
- 2026-11-15 00:41（Asia/Shanghai）已在原 `JEAuditFlow-v7.6.0` 发布页替换 `JEAuditFlow-7.7.0-Source.zip`；远端大小、SHA-256 与本机一致。未新建版本，其他 17 个附件及发布说明保持不变。源码包为 142,623,800 字节，SHA-256 为 `b410a8e3416fe14a2948d4466bd6cd50bcd5ca9fadd909598520c412e789785b`。

## 仍需外部配置的部分

- Entra 的 tenant、client、凭据与回调注册未在本机配置，因此 SSO 登录未实测。
- Outlook 只读脚本连接返回 -1712 超时；没有发送真实邮件，也没有证明收件。
- 真实 Jira REST 凭据未配置，隔离测试没有向生产 Jira 创建工单。浏览器内的 Jira 登录不等同于 REST 凭据。
- Polarion 私网地址已实连；另一个公网 JEAuditFlow 服务器仍需安装 7.7、启用 Polarion 路由并建立本机连接器，才能验证完整远端流程。
- Windows LYM 中没有找到 LLM Cost Dashboard 扩展。已保留实际 Codex 配置路径和无密钥检查截图，未虚构该扩展 API。

详细字段说明见 7.7-report-field-mapping.md；接口见 7.7-jira-finding-channel.md；
SSO/邮件见 7.7-sso-mail-setup.md；Windows/Polarion 实测见
7.7-windows-polarion-verification.md。
