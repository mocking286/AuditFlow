# AuditFlow 版本记录

# v9.5.0

- 修复 Edge 扩展登录：将 `http://www.aspice-auditflow.cloud/*` 加入 MV3 主机权限；此前该域名虽然显示在登录页，却会在浏览器发出请求前被拦截。
- 登录页默认使用 `http://www.aspice-auditflow.cloud`，并仅在网络层无法访问官方域名时自动回退到 `http://120.25.197.24`。
- 无法连接时显示实际尝试的服务地址，移除错误的“必须部署 v9.4 server”提示；工作区数据库结构继续保持版本 57。

# v9.4.4

- 以用户提供的橙色代码文档与蓝紫云朵终端原始 PNG 更新 AuditFlow 插件图标及品牌图标资源，并同步更新工作台、弹窗、帮助页、下载页和 Audit Master 图标；源图在包内按原始字节保留，SVG 仅引用该原图，其他 PNG 图标仅做完整画面缩放。
- 保留 Codex 评估助手专用图标、Trace relations 中栏滚动条及 v9.4.3 的本机 Codex 超时修复。
- 扩展版本升级到 9.4.4；工作区数据库结构继续保持版本 57。

# v9.4.3

- 以用户提供的 `dataflow.png` 统一更新 AuditFlow 的扩展、弹窗、工作台、帮助页、下载页和 Audit Master 品牌图标；Codex 评估助手的 `codex-assistant-flow-*` 图标保持不变。
- 新增仅绑定 127.0.0.1 的本机 Codex bridge 启动脚本，并将 Codex 意见请求上限由 60 秒提高到 300 秒，以覆盖本机模型冷启动和较长上下文。
- 将“本机 Codex 模型请求超时”与“连接脚本未启动”分开提示，避免将模型超时错误地显示为连接脚本未就绪。
- 工作区数据库结构保持版本 57；继续保留 v9.4.2 的 Trace relations 中栏独立纵向滚动条。

# v9.4.2

- 将扩展、弹窗、工作台、帮助页、下载页和 Audit Master 的 AuditFlow 品牌图标更换为提供的 Codex 风格新 Logo。
- Codex 评估助手改用独立的蓝色数据流与金色节点图标，不再复用 AuditFlow 品牌图标。
- 修复“Trace relations”中栏卡片过多时被裁切的问题；中栏现在与左右两列一致，具有独立的纵向滚动条，所有 Finding 和六个关联操作均可访问。
- 扩展版本升级到 9.4.2；工作区数据库结构保持版本 57，以保留已有证据、关联、记录与评分。

# v9.4.1

- 使用用户提供的橙色 AI Logo 重新生成扩展标准图标（16/32/48/128 PNG）、Audit Master/Codex 品牌图标和 SVG 源文件。
- 修复 Edge Add-ons 清单描述超出 132 字符限制的问题，并将扩展版本提升为 9.4.1。

# v9.4.0

- 以新提供的剪贴板/报表图标替换扩展、弹窗、Audit Master 和 Codex 评估助手的旧图标。
- 英文模式为所有渲染后的按钮、链接和图标控件补充悬浮英文说明，并保留可访问名称。
- 提升顶行活动按钮的对比度，修复摘要、列表、面板等图标悬浮时变黑的问题。
- 将 Latest change、Project browser、Chat 放到“返回项目列表”下方；侧边栏折叠时竖向排列。
- Project browser 卡片支持直接跳转到对应标准评估项目。
- 文件跳转按钮移动到 Evidence Inventory 下方并支持横向滚动；中心 Finding 改为每行一个。
- Assessment Scope 增加可展开/折叠的 Process → PA → BP/GP 层级树和节点图标。
- 工作区数据库迁移版本升至 57，保留原有项目、人工评分、证据确认、基线和协作数据。

# v9.3.0

- Fixed atomic DOCX/DOCM embedded-image mapping, item-level image preview, and orphan image evidence recovery.
- Added objective-evidence ranking and weakest-indicator PA candidate gates aligned with ISO/IEC 33020 guidance.
- Added Trace-inspired gray/blue UI controls and the Latest change / Model browser / Chat utility rail.
- Replaced toolbar, popup, help, Audit Master and Codex assistant branding with the new AuditFlow logo.

## v9.2.1

- 修复 CEP 初始资料只保留单条空索引的问题：补齐缺失 Office 源文件，升级为逐文件恢复解析，并保留人工条目分类、证据关系与审核轨迹。
- 工作区数据库迁移至 53；CEP 初始资料解析版本为 2。

## v8.8.2

- 修复英文模式在 AI 评审、BP/GP 映射校准、评审弹窗和最终报告中的中文残留；普通 BP/GP 候选现在保存结构化英文标题、准则、理由、发现、访谈问题和关闭证据。
- 旧版 `.doc` 不再从 OLE 二进制盲目解码；仅接受经过可靠转换的 UTF-8 sidecar，无法转换时明确标记解析失败，避免乱码进入证据条目。
- CEP XP 工作区严格重建为 `CEP folder.zip` 中的 8 个文件，清除陈旧派生评估并为项目、来源文件和原子条目保证唯一编号。
- Scope & Evidence Inventory 的过程/证据角色修改采用原位更新，保留滚动位置和当前焦点，不再刷新整页。
- 扩展、协作服务、部署配置和下载入口统一升级到 8.8.2；数据库迁移版本由 46 升至 47。

## v8.8.0

- 参考 Trace 的 Tree View / Grid View / List View 工作台：过程 → PA → BP/GP 层级、逐条评审、证据库存、定位与 Direct / Corroborating / Index-only 角色保持一致。
- 英文界面作为新工作区默认语言；Forms、Version history、Close & report、Scope & evidence、Grid view、List view 和 Reports 使用与中文模式对应的英文标签。用户已有语言选择保持不变。
- AI 评审“核对详情”改为可直接编辑的本地乐观工作区，不再显示“关联证据链已被锁定”、不再因条目锁禁用评审按钮；人工评分、证据确认、映射、基线和关闭仍保留原有人工门禁。
- 用户上传的 DOCX/DOCM/XLSX/XLSM/PPTX/PDF/文本继续在浏览器解析，并按原子条目进入逐条评审和证据溯源；Direct / Corroborating / Index-only 证据边界不变。
- 扩展、协作服务、API、报告/基线元数据和公共下载首页统一升级为 8.8.0；工作区数据库由 45 迁移到 46。

## v8.7.0

- 扩展、协作服务和 API 版本统一为 8.7.0；工作区数据库由 44 迁移到 45，保留已有项目、人工结论、证据链、基线和协作状态。
- 修复扩展登录链路：manifest 精确允许配置的 ECS 登录端点 `http://120.25.197.24/*`，保留当前扩展 ID 的 CORS 和会话登录机制。
- 补回扩展引用的 JSZip/PDF.js 本地解析资源及许可证，避免安装后的 Office/PDF 解析资源 404。
- 客户端与协作服务器分包，服务器依赖由 `package-lock.json` 锁定并在目标目录执行 `npm ci --omit=dev`。

## v8.5.0

- 修复 Microsoft Edge Add-ons manifest 校验：扩展描述缩短为 130 字符，低于 132 字符上限；商店 ZIP 以 `manifest.json` 为根且排除 `__MACOSX`、`.DS_Store`、运行输出和嵌套压缩包。
- Codex Assessment Assistant 改为使用 AuditFlow 插件图标的全局右侧悬浮按钮；任意页面可打开、切换 ASPICE 项目、整体评估、追问和清空项目对话。
- 云端职责收敛为账号/成员、项目角色、过程权限、项目修订、presence、编辑租约、事件与受锁增量变更。
- 文件解析、证据正文、WBS 规则深化、BP/GP/PA 计算、Codex 上下文、报告、工作区导出和反馈均在用户电脑执行。
- 云快照强制 metadata-only，并移除证据正文/摘录/表格/原子条目、AI 评审历史、研究会话和笔记。
- 数据库迁移升级至 43，扩展、引擎、云 API 和部署配置升级为 8.5.0。

## v8.4.0

- 英文模式改用结构化双语字段；移除 `Original-language content` 占位策略，评估抽屉和英文报告保持字段一一对应。
- 分离关联率、直接证据覆盖率和评估师复核率，禁止用“已关联”替代“已证明”。
- 新增“主 BP/GP + 影响 BP/GP”映射校准、PA 独立证据复核、SUP 原生闭环链和按过程/PA/BP-GP 展开的关闭阻断树。
- 证据/快照指纹用于相似项确认与重复评估预防；快照记录数据版本、计算口径、签核与变更历史。
- 模型调用改为显式启用，移除通用 OpenAI 环境变量继承；回环 POST 增加来源校验，CSP 内联主题脚本移至外部文件。
- 数据库迁移升级至 42，扩展、后端引擎、云 API 和发布元数据升级为 8.4.0。

## v8.3.0

- Trace 三栏和 Evidence Inventory 支持独立上下滚动；链接确认按钮移动到 ID / locator 下方并放大。
- 六种关系标记支持实际保存；备注会打开内置表单并显示在关系卡片内，所有关系动作保留审计日志。
- 英文模式增加刷新后实时翻译进度条；增加 Trace、报告和证据 UI 术语翻译，原始证据文本不被改写。
- 数据库迁移升级至 41，扩展和后端引擎升级为 8.3.0。

## v8.2.0

- 新增 HF ASPICE 风格公共下载首页，提供插件、Windows 便携版和网页版入口；网页版进入应用后再由认证门显示登录/注册。
- 顶部导航使用两字短标签：评估、自定义、最近、应用、计划、空间、追踪、审查、缺陷、实践、变更、更多；完整功能和 tooltip 保持不变。
- 证据溯源和逐条评审三栏支持拖动分界线调整比例，配置仅保存于本地浏览器；窄屏自动切换为纵向布局。
- 版本升级为 8.2.0，数据库迁移版本升级为 40；ASPICE 直接/佐证/仅索引证据护栏和人工最终确认门禁保持不变。

## v8.1.0

- 证据关联溯源升级为三栏工作台：左侧按 Process → PA → BP/GP 展开评审目录，中间管理连接关系，右侧以表格展示文件条目的 type、文件类别、rank 和过程候选。
- 证据库增加 item/文件/内容搜索、文件归属页签、type/文件类别/rank 筛选；连接关系可使用备注、收藏、浏览中、差评、好评、有疑问六种状态标记。
- 上传文件自动分为评审问题/记录、需求文件、流程性文件、测试文件和追溯表格文件；原子条目分为 Information、Requirement、Process 和 Heading，支持评估师改定和设置自定义规则。
- 文件条目的删除操作移至每行右侧；删除单条 item 时保留原始上传文件和其他条目，并记录审计轨迹。
- 顶部第一行导航保留图标并增加简短功能名，“项目概况”更名为“评审进度”；人工评级、证据确认、批准、基线和关闭决定仍由评估师掌控。
- 设置页自定义分类规则支持同时指定五类文件、四类 item 和 ASPICE 过程候选；数据库迁移升级至版本 39，并保留既有证据、评分和协作记录。
- 扩展、后端引擎和发布元数据升级为 `8.1.0`，发布 smoke 精确校验 5 种文件类别、4 种条目类型、6 种关系标记、筛选契约和条目删除。

## v8.0.0

- 恢复左上角 AuditFlow / ASPICE 品牌文字；保留 7.9 的 13 个顶部导航功能图标，导航文字仅在悬浮或聚焦时显示。
- 覆盖 7.9 的窄屏隐藏规则，图标轨道在窄屏下保留并可横向浏览；英文模式固定按钮、过程域选择和工具提示统一使用英文。
- 顶部工作区导航保留图标并隐藏文字标签；悬浮/聚焦显示中英文功能提示，搜索、Codex 状态、通知、帮助、主题和语言控件始终可见。
- 修复英文界面状态标签覆盖和首行图标语义混乱；统一浅色/深色主题的表面、边框、文字和强调色，并覆盖窄屏工作区布局。
- DeepSeek 入口统一为 Codex 评估助手；本地规则评估、在线/本机 Codex 会话和人工评审门禁保持分离，Codex 只提供候选意见。
- 新增疑点（suspect）评论：可附加到人工或 AI 评审意见，支持同时生成记录表单引用，不改写人工评级、批准、证据确认或关闭状态。
- 协作设置新增头像上传、项目实时编辑 presence、管理员角色与管理员级项目/过程域权限；顶部显示其他活动成员头像。
- Helix 读取边界收紧为浏览器到本机 bridge 的纯前端通道，仅允许 localhost/127.0.0.1/[::1]；远程 Helix 数据先由本机 CMD/bridge 读取再导入证据。
- 协作服务与 Vercel/Postgres 契约增加 presence 心跳和疑点评论数据结构；工作区数据库升级至版本 36，版本号升级为 8.0.0。

## v7.9.0

- 项目页改为 Jira 项目布局：左侧新增项目侧边栏（项目头像/名称/编号/状态 + 「项目」导航 摘要/列表/面板/时间线/开发/表单/文档 + 「评估流程」十个阶段彩色图标按钮 + 计数徽章 + 悬停提示），内容区移至右侧。
- 移除顶部文字密集的评估流程命令栏与项目导航行，项目页首行只剩页头，界面更清爽。
- 侧边栏支持折叠为纯图标栏（仅彩色图标，悬停显示功能名），选择会持久保存。
- 激活态：浅色主题用 Jira 蓝（#0C66E4 / #E9F2FF），深色主题用 Atlassian 深色调（#669DF1 强调、rgba(206,206,217,.10) 高亮）。
- 窄屏下侧边栏自动堆叠到内容上方。
- 工作区数据库升级至版本 35；版本号升级为 7.9.0。

## v7.8.0

- 左侧边栏升级为 Jira 分区导航：导航（最近 / 应用 / 计划 / 空间）、专业工作台（项目追踪 / 技术审查 / 缺陷报告 / 实践报告 / 变更请求）、更多；激活项使用 Jira 蓝色高亮。
- 项目内新增 Jira 风格项目导航：项目编号徽章 + 摘要 / 面板 / 列表 / 表单 / 报告标签页；新增「记录表单」阶段，提供优势、弱项、建议、观察、访谈问题、缺陷报告、变更请求、通用备注八类 Jira Forms 风格表单，创建记录进入合并与关闭流程，不自动改分。
- 项目追踪：Jira Timeline 风格逐项目进度、计划、日程、里程碑、指标关联与门禁状态。
- 技术审查：Jira Board 三列（待处理/进行中/已完成）聚合独立复核任务、受控基线与 AI 评审，卡片可跳转项目对应页。
- 缺陷报告：Jira Board 四列看板（待处理/措施实施中/验证中/已关闭）汇总弱项记录与 CEP 问题，支持一键新建缺陷。
- 实践报告：跨项目按过程域的 PA 评级、证据覆盖与 S/W/R 统计，可下钻正式 GSWR 报告。
- 变更请求：SUP.10 变更请求列表（记录 + CEP 问题），支持新建并预填 SUP.10 指标与影响分析模板。
- 工作区数据库升级至版本 34；版本号升级为 7.8.0。

## v7.7.0

- 报告采用专业 ASPICE 评估报告（SWA 502089 风格）的配色与排版：品牌青色 #008C82 表头与标题、N/P/L/F 四色评级（红 #DD0028 / 橙 #FF9203 / 黄 #FCE514 / 绿 #2A9C2A）、#EDEDED 发现灰框与 #F2F2F2 斑马纹证据表；Word 导出与页面预览一致。
- 详细结果按专业报告节奏重组：Scope limitations → Level 1 Results（BPs - Base Practices 评级清单）→ PA1.1 → Level 2 Results（PA2.1 / PA2.2）。
- 新增 2.4 General Strengths, Weaknesses, and Recommendations 总览，并逐过程生成 GSWR：优势 / 弱项 / 建议全部来自评估工作区真实数据（评估师记录、BP/GP 评分、证据充分性与最小关闭证据）。
- 每个过程的 GSWR 附「分析过程」追溯框：证据解析 → 逐项评分分布 → PA 硬门禁聚合 → 记录合并（S/W/R 计数与未关闭弱项）→ 能力等级与证据覆盖，数值实时来自评估流程结果。
- 工作区数据库升级至版本 33；版本号升级为 7.7.0。

## v7.6.1

- 关闭评估页新增「Codex 评估助手」：通过 AuditFlow 本机连接脚本生成项目整体评估，并支持评估员在线追问 ASPICE 专业问题。
- 模型请求统一通过受控后端接口；浏览器不保存模型密钥，也不直接访问模型服务。
- 设置 → AI / MCP 显示 Codex 连接脚本、会话与传输状态；对话历史按项目保存在本地，可一键清空。
- 所有 Codex 输出均标记为 AI 参考意见，正式评级与关闭仍由评估师确认。

## v7.6.0

- Fixed the project assessment flow directly below the project breadcrumb while preserving normal-flow space so phase content is never covered.
- Embedded ASPICE Audit Master in Scope with selectable uploaded files and Helix items, assessor-controlled evidence roles, four-pass cross-process analysis and optional backend model deepening.
- Returned Audit Master results as Index-only `AI Review Opinion` evidence, AI review history and a separate reference version; formal ratings remain assessor-controlled.
- Added controlled baselines, Independent Reviewer tasks, Configuration Manager approval and multi-role response trails from the JEAuditFlow desktop workbench.
- Upgraded database migration to version 32 while preserving existing evidence, manual ratings, collaboration revisions, WBS learning samples and Microsoft sign-in settings.

## v7.5.0

- Trace-style fixed assessment command bar with dense phase, view, sync, sign-in, record and filter controls; content remains below the bar without overlap.
- Added Vercel Functions + Marketplace Postgres deployment contract, Microsoft Entra Authorization Code + PKCE, tenant-scoped project keys, database-backed RBAC, optimistic revisions and event polling.
- Added workbook WBS/OPL triage for issue status, process candidates, source sheet/row locators, scope suggestions, assessor confirmation and project-scoped learning examples.
- Added online AI issue deepening with untrusted-cell prompt boundaries, project examples, professional opinions, solution steps and closure evidence; ratings remain assessor-controlled.
- Default cloud evidence policy is metadata-only; local parsed evidence is restored after pulls and cloud snapshot requests are bounded at 3.5 MB.

## v7.4.0

- 固定项目评估流程导航，非概况阶段只展示阶段内容。
- 证据库存按来源文件折叠，文件内部条目统一展开查看。
- DOCX/XLSX/PDF/文本解析新增原子条目与 SYS/SWE/MAN/SUP 候选分类。
- 逐条评审支持人工调整每个文件条目的过程域和证据角色。
- aspice-audit-master 与 AuditFlow AI 评审页支持候选结论 JSON 导出/导入。

## v7.3.0

- 参考 Sharpen360 Trace 的评估操作流，将 ASPICE 项目阶段导航从左侧纵向栏改为项目页左上方的顶部十阶段命令栏，并为每个阶段增加可恢复的 URL 深链接。
- 新增 Scope 工作台：左侧保持正式过程域轨道，右侧在当前过程上下文中管理实例、Direct/Corroborating/Index-only 边界、Office/PDF/Helix/文本上传和 Evidence Inventory。
- Grid View 改造成过程域、BP/GP 评分表和当前指标检查器三栏布局；检查器持续显示 AI 候选、人工评分、C/R/O/W/S/Q 记录和证据关联。
- List View 改造成 Assessment Scope、Records & confirmed links、Evidence Inventory 三栏布局，保留 AI 建议、Map Set 和评估师人工确认/取消关联。
- 关闭评估和报告拆分为独立阶段；报告在门禁未通过时标记 Draft，关闭页继续执行证据、人工复核、记录定稿、弱项和 Guideline 门禁。
- 保留 AI 预评估、BP/GP AI 评审、合并、版本、MAN.3/SUP.8 专项子项目、协作角色和报告生成动作；旧 evidence/conduct/trace 链接自动映射到新阶段。
- 扩展、本机服务和数据库版本升级为 7.3.0 / 29。

## v7.2.0

- 新增 MAN.3 / SUP.8 支持域问题专项子项目：从首页项目列表一键生成，支持选择过程和继承证据。
- 从 DOCX、DOC、PDF、XLSX、CSV、JSON、HTML 或文本中识别实际出现的 Issue，不为未出现的问题补齐整套 BP/GP。
- 新增“评定结果（BP + GP · AI 初稿，可复核改定）”专项工作台，按问题来源、定位、证据作用、候选指标、评分和关闭证据逐项人工复核。
- 新增专项子项目一键回写父项目：生成草稿弱项、候选追溯和必要证据副本，保留父项目已有人工评分、正式范围和历史记录。
- 工作区数据库版本由 27 升到 28；既有项目、协作成员、角色、证据链和人工结论通过迁移原位保留。
- 帮助中心和离线操作手册新增支持域专项评估、问题驱动证据护栏和回写边界说明。

## v7.1.0

- 自定义审核新增 ISO 26262 功能安全与 ISO/SAE 21434 网络安全内置模板，覆盖各自生命周期、管理活动、核心分析、开发验证、支持过程与安全 Case。
- 安全审核采用范围、计划、证据、AI 分析、人工复核、关闭六阶段工作流；上传材料后逐项生成 Direct / Corroborating / Index-only 证据角色、候选评分、缺口、追问和最小关闭证据。
- 本地文件解析新增旧版 DOC 入口和显式解析警告；正式结论仍要求核对原始文档、版本、授权、配置状态和可定位内容。
- 设置新增项目协作与 Azure 部署准备：约 3 名审核员、项目级角色、当前操作人、修订号、事件日志、同步端点和非敏感 Azure 标识参数。
- Lead Assessor / Assessor / Data Logger / Viewer 对证据、AI 分析、人工改定和关闭动作实施本地权限限制；本机服务新增 `/api/collaboration/status` 部署探针。
- 扩展和本机服务升级到 7.1.0，工作区数据库升级到 27；既有 ASPICE 项目和人工结论原位保留。

## v7.0.0

- AI 评审阶段新增“评定结果（BP + GP · AI 初稿，可复核改定）”，按正式范围过程、PA 1.1/2.1/2.2 和 BP/GP 分组显示。
- 新增过程、BP/GP、复核状态、证据缺口与关键词筛选；每行显示八档候选、置信度、证据角色、主要缺口、人工评分与来源状态。
- 快速评分和核对详情均写回当前评估记录，人工改定保留评估师、时间、复核意见、引用、O/W/R 和操作日志。
- Codex 提示词执行四遍跨过程检查，只接受正式范围内已知 BP/GP；模型候选继续受证据护栏限制，范围外关联过程不评级。
- AI 预评估完成后直接进入评定结果；离线操作手册和设置帮助中心增加完整操作步骤。
- 扩展、后端引擎和受控桥接版本升级到 7.0.0；工作区数据库升级到 26，既有项目数据原位迁移。

# AuditFlow v6.9 · 阶段导航高亮、帮助中心与反馈建议

## v6.9

- 评估流程九阶段按钮：点击后同步高亮对应阶段区域（局部渲染路径下也保持高亮）。
- 关闭与报告按钮取消常亮红色样式：图标背景与“版本”按钮一致（灰色、同尺寸），仅选中时显示高亮。
- 设置页新增“帮助中心”：操作指南、九个评估流程说明、ASPICE 标准化审核配置和常见问题。
- 设置页新增“反馈建议”：功能/页面 + 建议内容，可保存多条并删除，本地持久化。
- Codex 与 Helix 接口代码未改动；数据库版本升级到 25。

# AuditFlow v6.7 · 范围化评级矩阵、目录页码与证据预览

## v6.7

- 报告首页与项目总览新增按客户选择过程域过滤的 BP / PA / GP 评级矩阵；未选择的过程域不在报告、总览和证据作用域选项中显示。
- 报告目录增加页码列：扩展报告页自动计算章节页码；Word 导出内置 TOC 域（Ctrl+A 后 F9 刷新）。
- 证据清单：非 Helix 上传证据行右侧新增“预览抽取文本”与“删除”图标按钮，预览展示解析后用于 AI 分析的正文/表格文本。
- 评估流程顺序调整：证据移到执行之前（总览 → 计划 → 证据 → 执行 → 追溯 → …）。
- 总览页最下方展示当前版本 BP / PA / GP 评级矩阵。
- Codex 与 Helix 接口代码未改动；数据库版本升级到 24。

# AuditFlow v6.6 · ASPICE 正确性加固与性能优化

## v6.6

- 本地规则引擎去模板轮转：评分由证据强度驱动（无证据 N、仅索引 P+ 上限、单直接证据 L- 上限、多直接证据 L/L+），F 保留给模型复核与人工确认；五维分数同步改为证据维度，移除 index 抖动。
- PA 聚合否决规则：N/P 单项使 PA 不能达到 L，BP 未达 F 使 PA 1.1 不能达到 F；CL1/CL2 门禁不再被平均分掩盖。
- 补齐 16 个过程的真实 BP 文本和 EVIDENCE_GUIDE，28 个过程全部具备可评估 BP。
- 性能：启动快速路径（版本一致时不整库回写）、保存防抖 200ms + beforeunload/visibilitychange 强制落盘、页签内容局部渲染、Dashboard 指纹脏检查、搜索防抖、渲染批次记忆化、脚本 defer。
- 隐私：backend-config 默认 ai.enabled=false，默认网关改为企业网关，避免证据摘录误出域。
- CL3 边界提示：本地引擎上限 CL2，新建项目和项目页明确提示。
- 工作区数据库版本升级到 23，迁移不重建既有评估。

# AuditFlow v6.5 · 回收站与项目操作体验

## v6.5

- 当前审核状态和 ASPICE 项目列表支持将项目移入本地回收站，不再直接丢弃项目数据。
- 设置页新增回收站，支持撤销删除和彻底删除两个选项卡；恢复时保留原项目内容和审核记录。
- 统一总览项目操作入口，修正进入项目与删除按钮的行内对齐。
- 修正执行页操作列两个按钮的垂直对齐，并为“关闭与报告”阶段使用淡红色背景。

## v6.4 · 项目级流程漏斗与折叠工作区

## v6.4

- 从审核总览移除“审核 Workflow 实时漏斗”，将九阶段流程进度放入每个项目的“评估问题与项目计划”折叠面板。
- 每个流程阶段可点击进入对应项目工作区，并显示当前缺少的进度。
- 关闭与报告阶段图标补充外框；审核总览的垃圾桶按钮与打开项目箭头保持同一行。
- 评估问题与项目计划面板支持下拉展开/折叠，降低对项目内容视角的干扰。

## v6.3

- AL 项目追溯检查优先使用本地 Codex CLI 的 `gpt-5.6-luna`，模型补充意见未返回时继续显示本地可复核结论。
- 新增“AI 评审”阶段：基于已定稿记录创建带 `aspice-audit-master` 来源的版本，并仅展示 ASPICE BP/GP Codex 参考评分候选。
- 已定稿记录可移回等待合并；版本比较增加版本内用户操作快照。
- 列设置改为漏斗图标，审核总览删除项目改为垃圾桶图标；总览进度条和解析/溯源统计改为有色、可解释的指标。

## v6.2

- 修复健康检查显示 AI 可用但点击“AI 检查全项目”仍返回模型不可用的问题：无显式 Virtual Key 时优先使用已认证的本机 Codex CLI 会话。
- 增强 Codex CLI JSON 输出解析，兼容文本、内容数组和嵌套响应结构，避免模型结果已返回但 UI 收到空响应。
- 总览新增证据来源扇形图、解析状态直方图，以及 BP/GP 的总量、证据关联和评估师人工确认对比图。
- 保持 6.1 的总览指标、计划和日程合并、数据迁移和主题适配功能。

# AuditFlow v6.1 · 本机 Codex bridge、项目总览与统一计划日程

## v6.1

- 本机 bridge 在没有显式 Virtual Key/API Key 时，安全复用已登录的 Codex CLI 会话处理“AI 检查全项目”；账户、令牌、配置原文和 CLI stderr 均不会发送到界面或写入扩展包。
- bridge 状态明确区分 Virtual Key、服务端凭据和本机 Codex CLI 会话，避免将“服务已启动”误报为“模型不可用”。
- 评估流程首位新增“总览”：以环形图和进度条展示开发进度、证据解析、双向追溯、人工复核、计划日程和记录定稿，并列出已溯源 BP/GP、证据关系和开放弱项。
- “计划”与“日程”合并为“计划和日程”，保留既有卡片、负责人、访谈和拖拽工作流。
- 工作区数据模型迁移到 v21，保留现有项目、证据、记录、版本、计划和日程数据。

# AuditFlow v6.0 · ASPICE 评估交互、版本比较与 Codex 上下文

## v6.0

- 修复执行页人工评分下拉框点击后被行选择重绘关闭的问题。
- 执行、当前审核状态、证据、版本、关闭与报告、Helix 导入页均支持拖动列宽、列显示开关、表头名称修改和恢复默认。
- 版本页新增与当前版本比较，汇总改善、回退和仍需关闭的 BP/GP 差距。
- 当前审核状态新增带二次确认的项目删除按钮。
- Helix 采用 Tag、Summary、REQ/RE/TASK Type、Status、Document List 五列，双击条目查看完整字段。
- Codex 上下文增加上传材料、表格、Helix 字段、确认追溯、开放弱项和版本趋势；新增本地桥接启动脚本。
- aspice-audit-master 左上角使用新的审核助手形象图标。

## v5.9

## 本版更新

- 移除页面级阻断性连接横幅和终端启动提示；AI 服务未就绪时以“本地评估”状态继续工作。
- 新增 Codex / Virtual Key 设置页，入口位于设置 → AI 与本地解析设置。
- Virtual Key 使用组织门户 https://llmcost.johnsonelectric.com/；Key 仅留在本机 AI 服务会话内存，重启即清除。
- 本机 Codex / VS Code 检测改为存在状态检查：不打开配置文件，不读取、不返回、不记录任何凭据。
- 右上角恢复 EN / 中语言开关。英语模式的 UI、评估展示和模型提示词统一使用英文；无法安全翻译的中文可编辑内容会被保护，切回中文后可继续查看和编辑原文。
- 恢复浏览器工具栏弹窗：显示正在进行的项目，可选择进入首页或项目，并显示 AI 服务与 Helix Bridge 的就绪状态。
- 夜间模式继续使用 GitHub Dark 令牌层；白天模式保持原有配色与布局。
- 清理浏览器工作区中的遗留 API Key 字段；扩展不会持久化模型凭据。

## 验证

- JavaScript、模块和扩展清单已完成语法验证。
- 本机服务健康检查确认版本为 5.9.0，健康响应不再暴露命令行字段或 Virtual Key 值。
- aspice-audit-master 封装为 H5 免登录嵌入，点击按钮直达项目过程评估页。
- Helix 联动升级：仅需输入密码即可选择项目并读取最多 1500 条 items（分页抓取）。
- 上传任意资料后自动分析并展示证据/Codex 建议页；暗黑模式风格统一（去除白块）。
- 修复扩展沙箱内初始化崩溃：aspice 页运行于无 `allow-same-origin` 的沙箱（不透明源），访问 `localStorage`/`sessionStorage` 会抛 SecurityError，导致「分析证据库」按钮与上传分析失效、AuditFlow 桥接未初始化（停留空白落地页）。已为所有存储访问增加 try/catch 保护（沙箱内存储无法持久化，但功能完整可用；`content_security_policy.sandbox` 按浏览器规范不得包含 `allow-same-origin`，故不添加）。
- 修复验证：模拟沙箱（存储访问抛错）环境下，上传文件自动分析、点击「分析证据库」、桥接初始化均正常；正常环境回归通过。
- 发布压缩包会排除运行时 output 目录与所有凭据。
## v8.9.0

- Reworked the English display layer with a local semantic translation vocabulary and memoized translation cache.
- Grid View, List View, assessment reports, evidence records, imported assessment observations, and the ASPICE standards library now render from an isolated English view model.
- Removed the legacy `[Source-language segment; translation unavailable]` fallback from visible English output; unknown free-text segments use the stable `Details` label while preserving source data for Chinese mode.
- Replaced `NodeFilter` globals with DOM traversal constants so extension pages translate reliably in runtimes that do not expose `NodeFilter` on the page global.
- Bumped the extension and workspace migration metadata to 8.9.0 / database version 48.
