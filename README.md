# AuditFlow v9.6.0

AuditFlow 是面向 Automotive SPICE、ISO 26262 功能安全和 ISO/SAE 21434 网络安全审核的本地单机工作台，覆盖范围、计划、证据解析、AI 候选、人工复核、项目元数据编辑、关闭与报告。

v9.6.0 removes the remote login and collaboration path that could fail with a cross-origin request rejection. Authentication is a local profile (name and email only), every profile is an Administrator, and projects remain editable in the browser workspace. The full `CEP XP ASPICE CL2 过程评估与整改` project is visible only for the three approved Johnson Electric email addresses; all other profiles receive the editable local default project.

本发布包是客户端扩展。ZIP 需要在 Edge 中加载解压缩目录，不能在 ECS 上用 Node.js 启动；项目、身份和证据元数据保存在本机工作区。Codex/Helix bridge 仍是按需启用的本机工具。

## v9.1 新增

- 后台监控默认绑定企业服务器地址并以英文启动；仅管理员可在“账户、AI 与本地解析设置 → 后台管理”配置。
- 登录界面提供中文/English 切换；所有本机档案均为 Administrator，工作台总览、新建评估和项目编辑均可用。
- 逐条评审的 Active indicator 位于 Process scope 右侧；Process / Indicator / BP 说明等 Trace 风格表格下移到工作区底部，保留可编辑 finding 和备注编号。
- 关联率与直接证据覆盖率按实际确认关系统计；AI 对每条 BP 最多自动选择一条直接证据，追加关联必须由评估师确认。
- PPTX 导出改为基于 Intacs 模板的六页精选领导汇报，保留 BP/GP 解释和机器可读摘要，不再直接导出整套模板。
- 资料上传不再拦截非 CEP 文件；资料组右侧增加一键删除（带确认和审计日志）。DOCM 按 DOCX 包解析，TR 报告按 CUS 客户需求拆分为下游追溯描述原子条目，且仅作关联佐证。
- Metrics 改为 finding types 分布与 Nonconformance 概览；关闭阻断树与不可变日志继续绑定版本功能。

## v9.2 新增

- CEP XP 项目按获授权邮箱显示；其他本机档案始终可见并可编辑默认项目。
- 高级独立工作台 `aspice-audit-master` 增加异步内容英文强制翻译，避免挑战问题和解析结果混入中文。
- 证据溯源确认关系绑定到单个文档原子条目，不再因点击一次确认而关联整份文件。
- DOCX/DOCM 内嵌图片保存为条目级附件；带图片的条目显示图片按钮，可在弹窗中同时查看正文、定位和图片。
- 文件删除按钮与展开按钮保持同一文件行右侧的相邻操作位置。
- 9.6.0 移除多人编辑、成员 ACL、编辑锁、存在状态和远端事件，工作区固定为本机单用户模式。

## v9.1 之前的能力基础

- English report preview mirrors the complete Chinese report structure and keeps direct/corroborating/index-only evidence roles plus assessor authority.
- Report preview exports an editable PPTX based on `templates/Intacs-Agile-SPICE-2021-04.pptx`.
- Grid View adds Trace-style process, indicator, BP/GP, evidence, finding number, NC and modifier columns with a 15-button field toolbar, Finding editor and new-number notes.
- Review progress includes a Metrics table; closure blockers and immutable logs are integrated into Version history.
- Account settings keep the local profile and Administrator status visible; no project ACL, member switcher or remote identity flow is exposed.

## v8.9 翻译层

- 英文模式使用本地语义词典、结构化英文字段和缓存翻译结果，覆盖 Grid View、List View、报告、ASPICE 标准知识库及动态评估记录。
- 语言切换只创建英文显示副本，不修改中文源数据、人工评分、证据确认、基线批准或关闭状态。
- 未配置在线模型时仍保持可用：HTML、代码、URL、过程 ID 和文件定位信息不会被翻译器破坏；无法识别的自由文本保留原文，不再用 `details` 作为占位符。

## 本版重点

- 项目面包屑固定显示“工作台 / ASPICE 评估 / 项目编号”，评估流程条在其下方保持可见，并保留页面流内占位，滚动时不覆盖当前阶段内容。
- `aspice-audit-master` 已作为“范围与资料”右上角的小型原生工具按钮集成。弹窗可选择已上传文件或 Helix 原子条目，逐项确认 Direct / Corroborating / Index-only，再执行 Qualified flow、Agree & summarize、Divide & control、Trace consistency 四遍分析。
- Audit Master 输出作为待人工复核候选保存，并以强制 Index-only 的 `AI Review Opinion` 证据回流到 AuditFlow；同时保留所选来源、定位、角色、正式范围、模型/本地执行方式、候选和独立版本，不自动覆盖人工评分。
- “版本”升级为“版本与基线”：评估版本继续用于比较候选变化；受控基线按 Draft → Independent Reviewer 独立复核 → Lead Assessor / Configuration Manager 批准推进，并保留 FNV-1a 清单摘要和角色任务轨迹。
- JEAuditFlow 便携版的五类资料/原子条目、WBS/OPL、AI 候选、基线与人工复核已映射到浏览器工作台；浏览器版使用本机身份、项目和证据工作区。

- 评估流程导航固定在项目每个阶段的最上方；除“项目概况”外，计划、范围、逐条评审、溯源、合并、AI 评审、版本、关闭和报告页不再重复项目总体信息，只显示当前阶段工作内容。
- “范围与资料”按真实来源文件折叠归并，文件行右侧提供展开按钮；同一 XLSX/DOCX 中导入的 `Imported assessment observation`、需求记录和表格行不再散落为大量平级文件。
- 文档解析新增原子条目模型。带 `SYS-####`、`SWE-####` 等 ID 的需求按条拆分，保存章节、定位、Allocation、ASIL、Origin、状态等元数据；项目计划、质量、配置、问题和变更资料分别形成 MAN.3 / SUP.1 / SUP.8 / SUP.9 / SUP.10 候选分类。
- “逐条评审”先显示当前过程域的全部文件条目，再显示 BP/GP 评定；审核员可逐条修改过程域和 Direct / Corroborating / Index-only 角色，所有更改记录操作人和时间。
- aspice-audit-master 的 Codex 结论区新增“导出 AuditFlow 评审文件”，生成 `auditflow-ai-review/v1` JSON；AuditFlow AI 评审页可导入该文件，按正式范围过程呈现候选并等待审核员修改或确认。导入不会覆盖已有人工结论。

- 参考 Sharpen360 Trace 的专业评估员操作逻辑，将 ASPICE 项目改造成顶部生命周期导航、左侧过程域轨道、中间逐条判断、右侧记录与证据上下文的沉浸式评估工作台。
- 顶部十个入口固定为：项目概况 → 计划评估 → 范围与资料 → 逐条评审 → 证据溯源 → 记录合并 → AI 评审 → 版本 → 关闭评估 → 报告。阶段 URL 可直接定位，切换阶段会重绘完整项目页。
- Scope 支持在正式过程域上下文中上传 Office/PDF/Helix/文本资料；Grid View 按 BP/GP 逐条评分并在右侧维护 C/R/O/W/S/Q；List View 将 Assessment Scope、Records 和 Evidence Inventory 并排用于证据关联溯源。
- 关闭评估与报告拆分为独立阶段：关闭页专注证据、复核、弱项和不可修改日志门禁；报告页持续允许 Draft 预览，并在门禁通过后显示正式报告就绪。
- 自定义审核内置“ISO/SAE 21434 网络安全审核”和“ISO 26262 功能安全审核”模板；两类项目均采用范围 → 计划 → 证据 → AI 分析 → 人工复核 → 关闭的六阶段操作流。
- 网络安全覆盖治理、项目管理、TARA/网络安全概念、产品开发、持续活动、发布与网络安全 Case；功能安全覆盖总体/项目安全管理、Item/HARA/FSC、系统/硬件/软件开发、V&V、配置/变更、供应商与安全 Case。
- 上传 DOCX、DOC、PPTX、XLSX/XLSM、PDF、CSV、JSON、HTML 或文本后，逐项区分 Direct、Corroborating 和 Index-only；旧版 `.doc` 采用启发式本地抽取，正式结论必须回到原文核对。
- 设置仅提供本机账户、AI、Helix、反馈和数据管理；项目元数据（名称、受评组织、范围、产品/项目等）可在本机编辑。
- 工作区不启用用户快照、成员 ACL、编辑锁、存在状态或事件轮询；原始证据文件和项目结果保留在当前浏览器配置文件。
- WBS/OPL 导入保留工作表/行定位，自动识别过程候选和问题状态；评估师确认后进入项目学习样本，在线 AI 仅返回待人工复核的专业意见和整改闭环建议。
- AI 评审页新增“评定结果（BP + GP · AI 初稿，可复核改定）”工作台：按正式范围过程和 PA 分组展示全部 BP/GP，可按过程、指标类型、复核状态、证据缺口和关键词筛选。
- 支持 MAN.3 / SUP.8 文件问题专项子项目：从首页项目列表一键生成，只继承选定证据和父项目已有问题；上传 Action Plan、项目计划或配置管理材料后，只识别文件中实际出现的问题，不补齐未出现的 BP/GP。
- 专项子项目用问题描述、审核说明、风险、行动和关闭证据智能匹配候选 BP/GP；在“评定结果（BP + GP · AI 初稿，可复核改定）”逐条人工确认后，可一键把草稿弱项、候选追溯和新增证据回写原项目，并保留原项目人工评分、正式范围和历史记录。
- 每条评定同时显示 8 档 AI 候选、置信度、Direct / Corroborating / Index-only 证据构成、主要缺口、人工最终评分和 AI 初稿/人工改定来源；评分下拉与核对详情共用当前评估版本数据。
- Codex 参考评审只接受正式范围内已知 BP/GP，并按合格输入输出、约定与汇总、分解与控制、追溯一致性检查上下游和 MAN.3 / SUP.1 / SUP.8 / SUP.9 / SUP.10；关联过程只形成佐证或“关联观察·不评级”。
- AI 预评估完成后直接进入评定结果；人工改定记录复核时间、评估师和操作日志。数据库版本由 25 升到 26。
- 评估流程顶部十阶段导航：点击阶段后完整重绘项目工作区并写入阶段深链接；关闭与报告图标背景与“版本”一致（灰色、同尺寸），仅在选中时高亮。
- 帮助中心以项目级 ASPICE 评估闭环重写：明确正式范围、PA/能力等级、直接证据与跨过程佐证、MAN.3 / SUP.1 / SUP.8 / SUP.9 / SUP.10 闭环、人工结论和关闭门禁；右上角问号可打开离线详细操作手册。
- 设置页新增“反馈建议”：填写功能/页面与建议内容，可保存多条、随时删除，数据保存在本地工作区。
- Codex 接口与 Helix 接口代码保持 v6.7 不变。
- 报告与总览按客户选择的过程域呈现：BP / PA / GP 评级矩阵只展示正式范围内过程，报告中跨过程分析与工作产品“关联过程”列同步过滤，不再出现未选择的过程域。
- 报告目录增加页码列：扩展报告页按 A4 页版自动计算并填充每个章节的页码；Word 导出内置真实目录域，打开后全选并按 F9 即可生成带页码目录。
- 证据页：每份客户上传的非 Helix 证据行右侧增加“预览抽取文本”和“删除”两个图标按钮；预览显示解析后喂给 AI 分析的正文/表格文本。
- 项目评估流程顺序调整为：项目概况 → 计划评估 → 范围与资料 → 逐条评审 → 证据溯源 → 记录合并 → AI 评审 → 版本 → 关闭评估 → 报告。
- 项目总览最下方增加当前版本 BP / PA / GP 评级矩阵。
- Codex 接口与 Helix 接口代码保持 v6.6 不变。
- 本地评分改为证据驱动：无证据默认 N，仅索引不超过 P+，单条直接证据不超过 L-，多条直接证据且证据充分时最高 L+；F 仅保留给模型复核确认跨周期稳定闭环后的人工结论。不再使用模板轮转生成“AI 候选”。
- PA 聚合增加否决门禁：任一 BP/GP 为 N 或 P 时，该 PA 不能达到 L；任一 BP 未达 F 时 PA 1.1 不能达到 F。CL1/CL2 结论不再被算术平均掩盖。
- 补齐 SYS.1/SYS.2/SYS.4/SYS.5、HWE.1~4、MLE.1~4、ACQ.4、SPL.2、REU.2、PIM.3 共 16 个过程的 BP 文本与证据指引，过程库从 12/28 提升到 28/28。
- 性能优化：启动不再整库回写 localStorage；保存防抖 200ms 并在页面隐藏/关闭前强制落盘；阶段切换完整重绘项目页，阶段内筛选和选中仍局部刷新；Dashboard 5 秒轮询带数据指纹脏检查；搜索输入 150ms 防抖；派生指标按渲染批次记忆化；页面脚本 defer 加载，外壳先绘制。
- 默认不启用外部 AI 传输：backend-config.json 中 ai.enabled=false，且默认地址为企业网关；只有显式配置后才发送证据摘录。
- 明确 CL3 边界：目标等级可选 Level 3，但本地引擎能力上限为 CL2，项目页与新建页均有提示。
- 已登录的本机 Codex CLI 可直接作为 AI 复核通道；没有显式 Virtual Key 时，“AI 检查全项目”不再误报后端模型不可用。CLI 仅接收经本机 bridge 传递的评估上下文，不读取、保存或显示账户和凭据。
- 评估流程新增“总览”，集中显示项目开发进度、已溯源 BP/GP、证据关系、直接证据覆盖、人工复核、开放弱项、计划和日程完成度，并用环形图和条状图呈现。
- 总览补充证据来源扇形图、解析状态直方图，以及 BP/GP 证据关联和评估师人工确认对比图。
- 原“计划”和“日程”合并为同一“计划和日程”流程阶段；已有计划卡、访谈和日程数据保持不变。
- GitHub Dark 夜间模式；白天模式、页面布局和功能位置保持不变。
- 右上角提供夜间模式和中英语言切换；英语模式将界面和模型评估统一为英文。
- 工具栏图标弹出项目选择窗口，可打开首页或正在进行的项目，并显示 AI 服务与 Helix Bridge 状态。
- 设置中的 Codex / Virtual Key 可打开组织 Virtual Keys 门户、检查本机 Codex 或 VS Code 相关配置是否存在，并配置模型复核。
- Virtual Key 仅保留在本机 AI 服务进程内存；浏览器工作区、扩展包和日志均不会保存或显示密钥。
- AI 服务不可用时，审核自动继续使用前端本地专业规则，不显示阻断性的后端连接错误。

## MAN.3 / SUP.8 支持域专项评估

1. 在“审核总览”或“ASPICE 评估”项目列表中找到父项目，点击图层图标“生成 MAN.3 / SUP.8 专项子项目”。
2. 选择需要复核的支持过程和父项目证据，创建后进入子项目“证据”阶段。也可以直接上传问题清单、项目计划或配置管理计划。
3. 点击“识别问题并配对 BP/GP”。结果只来自上传文件中真实出现的 Issue；Issue 记录只是问题佐证，不能单独证明目标过程已实施。
4. 在“评定结果（BP + GP · AI 初稿，可复核改定）”核对问题定位、候选指标、评分、理由、证据作用和最小关闭证据。未完成人工复核时，回写按钮保持禁用。
5. 全部问题复核后点击“一键回写原项目”。回写生成父项目草稿记录、候选追溯关系和必要的证据副本，不覆盖父项目已有人工评分；若支持过程不在父项目正式范围内，只作为关联观察。

该流程适合只评估 MAN.3 或 SUP.8 的材料复核，不等于完整过程能力评估。父项目仍需按十阶段 ASPICE 流程完成直接证据核实、评估师记录定稿、弱项关闭和质量门禁。

## 使用 AI 复核

1. 打开设置 → AI 与本地解析设置 → Codex / Virtual Key。
2. 使用打开 Virtual Keys 按钮进入组织门户；本机只检查 Codex 或 VS Code 配置、扩展的存在状态，不打开配置文件，也不读取凭据。
3. 输入 Virtual Key 并保存。配置仅用于当前本机服务会话；服务重新启动后需要重新输入。
4. 英语模式下，模型评估请求和模型输出均要求使用英文。没有模型服务时，本地规则仍可完成可复核的候选结论。

## 安装 Edge 扩展

1. 在 Edge 打开 edge://extensions。
2. 开启开发人员模式。
3. 选择加载解压缩的扩展，并选择本文件夹。
4. 固定 AuditFlow 图标；点击图标可从弹窗进入首页或选择正在进行的审核项目。

## 数据与隐私

- 项目、设置、证据索引、评估与记录元数据保存在扩展本地工作区。
- 评估师记录附件 Blob 保存在 IndexedDB。
- DOCX、DOC、PPTX、XLSX/XLSM、PDF、CSV、JSON、HTML 与文本证据在浏览器本地解析；旧版 DOC 的抽取结果带有人工核对警告。
- AI 服务仅用于已配置时的模型复核和服务端报告；前端工作流不依赖其连接状态。
- 本包不含任何 API Key、Virtual Key 或用户凭据。

## v7.3 → v7.4 升级说明

- 工作区数据库版本由 29 升到 30。首次打开 v7.4 会为既有证据补充文件内条目、分类候选和 AI 评审导入历史，不重建或覆盖既有项目、人工评分、证据链、记录、协作角色或历史版本。
- 需求类 DOCX 优先使用独立需求 ID 拆分。文件名和正文只用于候选过程分类；审核员必须在“逐条评审”确认过程归属和证据角色，关联过程资料不能替代目标过程直接实施证据。
- 若 v7.3 已以解压扩展加载，建议先导出工作区备份，再选择 v7.4 目录并点击“重新加载”。不要先移除旧扩展，以免浏览器清除该扩展 ID 的本地数据。

## v7.2 → v7.3 升级说明

- 工作区数据库版本由 28 升到 29。首次打开 v7.3 只写入 Trace 风格工作台版本和迁移日志，不重建或覆盖既有项目、证据、评估师记录、人工评分、追溯关系、协作角色或历史版本。
- 原“证据 / 执行 / 追溯”深链接分别兼容映射到“范围与资料 / 逐条评审 / 证据溯源”；原来的 AI 评审、合并、版本、关闭门禁与后端报告动作继续使用现有数据结构。
- 若 v7.2 已以解压扩展加载，建议先导出工作区备份，再在 `edge://extensions` 重新加载 v7.3 目录。不要先移除旧扩展，以免浏览器清除该扩展 ID 的本地数据。

## v7.1 → v7.2 升级说明

- 工作区数据库版本由 27 升到 28。首次打开 v7.2 时为既有项目补充专项子项目、问题来源、回写历史和支持过程字段，不重建或覆盖既有 ASPICE 项目、证据链、人工结论和版本。
- v7.1 已加载的协作成员、项目角色、修订事件和安全审核模板会原位保留；子项目会复制父项目的项目角色，仍受 Lead Assessor / Assessor / Data Logger / Viewer 权限护栏控制。
- 若 v7.1 已以解压扩展加载，可先导出工作区备份，再在 `edge://extensions` 重新加载 v7.2 目录。移除扩展前应先备份，以免浏览器清除该扩展 ID 的本地数据。

## v7.0 → v7.1 升级说明

- 工作区数据库版本由 26 升到 27。首次打开 v7.1 时补充两类安全审核模板、六阶段状态、协作成员、项目角色和修订事件，不重建或覆盖既有 ASPICE 项目、证据链、人工结论和版本。
- 若 v7.0 已以解压扩展加载，可用新目录替换原目录后在 `edge://extensions` 点击“重新加载”；移除扩展前应先导出工作区备份，以免浏览器清除该扩展 ID 的本地数据。
