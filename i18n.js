/* AuditFlow UI language layer.
 *
 * Application data remains unchanged.  This layer translates rendered UI
 * strings only, so changing language never mutates projects, evidence, or
 * assessment records saved in the workspace.
 */
(function () {
  "use strict";

  const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
  const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
  const PLACEHOLDER = /\[Source-language segment; translation unavailable\]/gi;
  const PLACEHOLDER_TEST = /\[Source-language segment; translation unavailable\]/i;
  const SHOW_TEXT = 4;
  const FILTER_ACCEPT = 1;
  const FILTER_REJECT = 2;
  const textSource = new WeakMap();
  const attributeSource = new WeakMap();
  const controlSource = new WeakMap();
  const protectedControls = new Set();
  const translationCache = new Map();
  const attributes = ["aria-label", "placeholder", "title", "alt"];
  let language = "en";
  let observer = null;
  let scheduled = false;
  let originalTitle = document.title;

  const exact = new Map(Object.entries({
    "审核总览": "Audit overview",
    "ASPICE 评估": "ASPICE assessment",
    "自定义审核": "Custom audits",
    "最近": "Recent",
    "应用": "Apps",
    "计划": "Plans",
    "空间": "Spaces",
    "项目追踪": "Project tracking",
    "技术审查": "Technical review",
    "缺陷报告": "Defect reports",
    "实践报告": "Practice reports",
    "变更请求": "Change requests",
    "导航": "Navigation",
    "主导航": "Primary navigation",
    "专业工作台": "Professional workbench",
    "更多": "More",
    "设置": "Settings",
    "工作台": "Workspace",
    "本地评估": "Local evaluation",
    "AI 就绪": "AI ready",
    "AI 分析中": "AI analysing",
    "后端就绪": "AI service ready",
    "后端离线": "Local evaluation",
    "后端已连接": "AI service connected",
    "重新检查": "Refresh status",
    "关闭": "Close",
    "通知": "Notifications",
    "展开导航": "Expand navigation",
    "搜索": "Search",
    "AI 状态": "AI status",
    "AI 服务就绪": "AI service ready",
    "打开 AuditFlow 操作手册": "Open the AuditFlow user manual",
    "操作手册": "User manual",
    "搜索项目、证据、过程和评估师记录": "Search projects, evidence, processes and assessor records",
    "实时掌握审核状态、证据链和关闭风险": "See audit status, evidence chains and closure risk in real time",
    "新建 ASPICE 评估": "New ASPICE assessment",
    "ASPICE 过程评估": "ASPICE process assessments",
    "以 Automotive SPICE 4.0 PAM 和专业评估准则为基线，完成范围规划、访谈执行、证据判断、记录合并与报告输出。": "Plan scope, conduct interviews, evaluate evidence, consolidate records and publish reports against Automotive SPICE 4.0 PAM and professional assessment rules.",
    "标准库": "Standard library",
    "新建评估项目": "New assessment",
    "全部项目": "All projects",
    "当前工作区中的标准审核": "Standard assessments in this workspace",
    "评估进行中": "Assessments in progress",
    "含 AI 初评和人工复核阶段": "Includes AI draft and human review stages",
    "本月完成": "Completed this month",
    "已具备可导出的报告版本": "Report version ready for export",
    "证据文件": "Evidence files",
    "PDF、Office、Helix 导出及文本": "PDF, Office, Helix exports and text",
    "搜索审核项目…": "Search assessment projects...",
    "全部状态": "All statuses",
    "导出清单": "Export list",
    "项目": "Project",
    "受审组织 / 产品": "Assessed organisation / product",
    "范围": "Scope",
    "目标": "Target",
    "进度": "Progress",
    "状态": "Status",
    "更新时间": "Updated",
    "完成度": "Completion",
    "支持域子项目": "Support-process subproject",
    "文件问题专项": "File-issue assessment",
    "打开": "Open",
    "一键回写原项目": "Merge into parent project",
    "生成 MAN.3 / SUP.8 专项子项目": "Create MAN.3 / SUP.8 subproject",
    "复制": "Duplicate",
    "移入回收站": "Move to recycle bin",
    "没有匹配项目": "No matching projects",
    "进入审核项目": "Open audit project",
    "进行中的审核": "Active audits",
    "本地解析覆盖": "Local parsing coverage",
    "待人工复核": "Awaiting human review",
    "当前阻塞项": "Current blockers",
    "审核 Workflow 实时漏斗": "Live audit workflow",
    "上传证据包": "Upload evidence package",
    "本地解析与映射": "Local parsing and mapping",
    "全过程 AI 复核": "Full AI review",
    "SUP 闭环检查": "SUP closure check",
    "依赖与影响分析": "Dependency and impact analysis",
    "评估师确认与导出": "Assessor confirmation and export",
    "账户与角色": "Account and roles",
    "AI / MCP": "AI / MCP",
    "Helix 表格解析": "Helix table parsing",
    "数据与隐私": "Data and privacy",
    "个人资料": "Profile",
    "评估角色与权限": "Assessment roles and permissions",
    "本地后端配置": "Local AI service configuration",
    "后端状态": "AI service status",
    "启用后端 AI 引擎": "Enable local AI service",
    "后端地址": "AI service URL",
    "保存配置": "Save configuration",
    "检查解析器": "Check parser",
    "保存设置": "Save settings",
    "导出备份": "Export backup",
    "评估护栏": "Assessment guardrails",
    "本地规则": "Local rules",
    "AI 评估已完成": "AI assessment completed",
    "已切换本地评估": "Switched to local assessment",
    "新建自定义审核方案": "New custom audit scheme",
    "发起自定义审核": "Start custom audit",
    "返回项目": "Back to project",
    "返回总览": "Back to overview",
    "未找到该内容": "Content not found",
    "目标可能已被删除或链接已失效。": "The target may have been deleted or the link has expired.",
    "取消": "Cancel",
    "创建项目": "Create project",
    "创建方案": "Create scheme",
    "创建任务": "Create audit",
    "保存资料": "Save profile",
    "导出 Word": "Export Word",
    "导出 PDF": "Export PDF",
    "当前版本": "Current version",
    "历史版本": "Version history",
    "证据": "Evidence",
    "版本": "Versions",
    "关闭与报告": "Close and report",
    "关闭与报告输出": "Close and report output",
    "执行": "Conduct",
    "计划": "Plan",
    "日程": "Schedule",
    "追溯": "Traceability",
    "合并": "Consolidate",
    "草稿": "Draft",
    "待评估": "Ready",
    "AI 评估中": "AI assessment running",
    "待复核": "Awaiting review",
    "已完成": "Completed",
    "已归档": "Archived",
    "已关闭": "Closed",
    "未连接": "Not connected",
    "就绪": "Ready",
    "无": "None",
    "是": "Yes",
    "否": "No",
    "今天": "Today",
    "昨天": "Yesterday",
    "天前": "days ago",
    "评估": "Audit",
    "自定义": "Custom",
    "追踪": "Track",
    "审查": "Review",
    "缺陷": "Defects",
    "实践": "Practice",
    "变更": "Change",
    "评审进度": "Review progress",
    "范围与资料": "Scope & evidence",
    "逐条评审": "Item review",
    "证据溯源": "Evidence trace",
    "记录合并": "Consolidate",
    "记录表单": "Record forms",
    "关闭评估": "Close assessment",
    "报告": "Reports",
    "证据关联溯源": "Evidence traceability",
    "Trace relations": "Trace relations",
    "Evidence Inventory": "Evidence inventory",
    "备注": "Note",
    "收藏": "Favorite",
    "浏览中": "Browsing",
    "差评": "Dislike",
    "好评": "Like",
    "有疑问": "Question",
    "确认关联": "Confirm link",
    "已确认": "Confirmed",
    "关系备注已保存": "Relation note saved",
    "关系备注已清除": "Relation note cleared",
    "关系标记已添加": "Relation mark added",
    "关系标记已取消": "Relation mark removed",
    "文件内 item、type、rank 和过程候选": "File items, type, rank and process candidates",
    "搜索 item、文件或内容": "Search item, file or content",
    "搜索关系、记录或证据": "Search relations, records or evidence",
    "全部文件类别": "All file classes",
    "全部类型": "All types",
    "全部 rank": "All ranks",
    "ID / locator": "ID / locator",
    "Item": "Item",
    "File class": "File class",
    "Process": "Process",
    "Action": "Action",
    "文档类别": "Document class",
    "条目类型": "Item type",
    "过程域": "Process",
    "证据角色": "Evidence role",
    "评审问题/记录": "Assessment records",
    "需求文件": "Requirements",
    "流程性文件": "Process and governance",
    "测试文件": "Test files",
    "追溯表格文件": "Traceability tables",
    "文件类别": "File class",
    "关系备注": "Relation note",
    "拖动调整分栏宽度": "Drag to resize pane",
    "CEP XP ASPICE CL2 过程评估与整改": "CEP XP ASPICE CL2 Process Assessment and Remediation",
    "评定结果": "Assessment results",
    "（BP + GP · AI 初稿，可复核改定）": "(BP + GP · AI draft, subject to assessor amendment)",
    "只评定正式范围内指标；跨过程与 MAN.3 / SUP.1 / SUP.8 / SUP.9 / SUP.10 证据仅作一致性佐证，不能替代目标过程直接证据。": "Only indicators in the formal scope are rated. Cross-process and MAN.3 / SUP.1 / SUP.8 / SUP.9 / SUP.10 evidence corroborates consistency and never replaces direct target-process evidence.",
    "范围内评定": "In-scope assessments",
    "人工已复核": "Assessor reviewed",
    "证据充分": "Evidence sufficient",
    "证据部分充分": "Evidence partially sufficient",
    "项目候选等级": "Project candidate level",
    "受 PA 否决门禁约束": "Subject to PA veto gates",
    "过程": "Process",
    "全部正式范围": "All formal-scope processes",
    "仅 BP": "BP only",
    "仅 GP": "GP only",
    "复核状态": "Review status",
    "AI 初稿待复核": "AI draft awaiting review",
    "证据有缺口": "Evidence gap",
    "AI 初稿": "AI draft",
    "达成能力等级": "Achieved capability level",
    "过程实施（BP）": "Process performance (BP)",
    "项目管理": "Project Management",
    "需求挖掘": "Requirements Elicitation",
    "系统需求分析": "System Requirements Analysis",
    "系统架构设计": "System Architectural Design",
    "系统集成与集成验证": "System Integration and Integration Verification",
    "软件需求分析": "Software Requirements Analysis",
    "质量保证": "Quality Assurance",
    "配置管理": "Configuration Management",
    "问题解决管理": "Problem Resolution Management",
    "变更请求管理": "Change Request Management",
    "待评估师复核": "Awaiting assessor review",
    "Local Preview · 退出": "Local Preview · Sign out"
    ,"84 条仍有缺口": "84 items still have evidence gaps"
    ,"指标": "Indicator"
    ,"84 条范围内评定": "84 in-scope assessments"
    ,"PA 1.1 过程实施（BP）": "PA 1.1 Process performance (BP)"
    ,"CEP XP 问题 3": "CEP XP Issue 3"
    ,"CEP XP 问题 4": "CEP XP Issue 4"
    ,"CEP XP 问题 5": "CEP XP Issue 5"
    ,"CEP XP 问题 6": "CEP XP Issue 6"
    ,"CEP XP 问题 7": "CEP XP Issue 7"
    ,"CEP XP 问题 8": "CEP XP Issue 8"
    ,"Codex 参考评审与版本": "Codex reference review and versions"
    ,"仅已定稿记录进入模型上下文；每次运行保存独立版本，不覆盖人工正式结论。": "Only finalised records enter the model context. Each run saves an independent version and never overwrites the formal human conclusion."
    ,"模型输入": "Model input"
    ,"请先在“合并”阶段将记录移入已定稿。": "Finalise records in Consolidate before model review."
    ,"参考评审历史": "Reference-review history"
    ,"尚未运行 Codex 参考评审。": "No Codex reference review has been run."
    ,"核对": "Review"
    ,"审核意图": "Assessment intent"
    ,"标准、评分护栏与证据链": "Standard, rating guardrail, and evidence chain"
    ,"八档评分规则": "Eight-level rating rule"
    ,"N：未体现；P：部分实施或关键闭环不足；L：大部分系统实施但仍有样本/稳定性缺口；F：系统实施、受控且跨样本稳定闭环。证据不足时不得仅凭文档名称或口头说明给高分。": "N: not achieved; P: partially achieved or with critical closure gaps; L: largely achieved but with sampling or stability gaps; F: systematically achieved, controlled, and stable across samples. Insufficient evidence cannot support a high rating based only on a title or interview statement."
    ,"直接证据覆盖": "Direct-evidence coverage"
    ,"直接": "Direct"
    ,"跨过程佐证": "Cross-process corroboration"
    ,"缺口": "Gap"
    ,"四遍跨过程分析": "Four-pass cross-process analysis"
    ,"建议访谈与关闭证据": "Suggested interviews and closure evidence"
    ,"关闭": "Closure"
    ,"AI 初评与人工结论": "AI draft and human conclusion"
    ,"AI 初稿与人工结论": "AI draft and human conclusion"
    ,"AI 初稿和人工结论": "AI draft and human conclusion"
    ,"当前指标没有证据关系": "No evidence relationship exists for this indicator"
    ,"当前指标没有已保存的证据关系": "No saved evidence relationship exists for this indicator"
    ,"关联证据不能替代目标过程直接实施证据": "Related evidence cannot replace direct target-process implementation evidence"
    ,"证据引用（每行一条，必须可定位）": "Evidence references (one locatable reference per line)"
    ,"O/W/R 发现": "O/W/R findings"
    ,"添加发现": "Add finding"
    ,"Suspect 评论": "Suspect comments"
    ,"评论只形成变更/记录线索，不会自动改变人工评分、AI 候选或证据确认。": "Comments create change or record leads only; they never change the human rating, AI candidate, or evidence confirmation automatically."
    ,"添加评论": "Add comment"
    ,"尚无 Suspect 评论。": "No suspect comments."
    ,"确认人工结论": "Confirm human conclusion"
    ,"评估输入记录了": "The assessment input records"
    ,"用于佐证弱项存在，不替代过程实施直接证据。": "It corroborates that a weakness exists and does not replace direct process-implementation evidence."
    ,"合格输入 → 合格输出": "Qualified input to qualified output"
    ,"确认每个过程使用经评审/批准的输入，并向价值链下一过程提供合格输出。": "Verify that each process uses reviewed and approved inputs and supplies qualified outputs to the next value-chain process."
    ,"约定与汇总沟通": "Agree and summarise"
    ,"检查需求/设计是否达成共同理解，验证结果、策略、计划和状态是否被汇总并沟通。": "Verify common understanding of requirements and design, and meaningful communication of verification, strategy, plan, and status summaries."
    ,"分解、委派、集成与控制": "Divide and control"
    ,"检查系统—域—组件—单元分解、责任委派，以及按设计逐级集成验证。": "Verify system, domain, component, and unit decomposition, delegated responsibility, integration, and corresponding verification."
    ,"追溯、一致性、影响与完整性": "Traceability and consistency"
    ,"沿来源与验证双向追溯，检查语义一致、变更影响和覆盖完整性。": "Follow bidirectional source-to-verification traceability and verify semantic consistency, change impact, and completeness."
  }));

  const phrases = Object.entries({
    "份证据": " evidence files",
    "个表格": " tables",
    "个阻塞": " blockers",
    "个 ASPICE 项目持续监控": " ASPICE projects monitored",
    "条记录": " records",
    "条问题": " issues",
    "项待复核": " items await review",
    "项待关联": " items unlinked",
    "条已人工确认": " assessor-confirmed",
    "从 Helix 导入证据对象": "Import evidence objects from Helix",
    "从 Helix 导入": "Import from Helix",
    "通过本机 bridge 读取项目": "Read the project through the local bridge",
    "密码只保留在当前标签页内存中": "The password stays in this tab's memory",
    "不写入 AuditFlow 工作区": "and is not written to the AuditFlow workspace",
    "Helix 项目数据尚": "Helix project data has not ",
    "启动本地 bridge 后查找项目": "Start the local bridge to find projects",
    "直接填写项目名称/ID 并读取快照": "or enter a project name/ID and read its snapshot",
    "通过本机 bridge 读取项目；密码只保留在当前标签页内存中，不写入 AuditFlow 工作区。": "Read the project through the local bridge; the password stays in this tab's memory and is not written to the AuditFlow workspace.",
    "允许自签名证书": "Allow self-signed certificates",
    "Helix 项目数据尚未读取。": "Helix project data has not been read.",
    "启动本地 bridge 后查找项目，或直接填写项目名称/ID 并读取快照。": "Start the local bridge to find projects, or enter a project name/ID and read its snapshot.",
    "条 Helix 证据": " Helix evidence items",
    "按“上传 → 本地解析 → AI 复核 → SUP 闭环 → 依赖分析 → 评估师确认”持续刷新。": "Continuously refresh through \"Upload → local parsing → AI review → SUP closure → dependency analysis → assessor confirmation.\"",
    "Helix 表格、BP/GP 候选评分和人工门禁均保留可追溯来源。": "Helix tables, BP/GP candidate ratings and human gates retain traceable sources.",
    "当前工作区中的标准审核": "Standard assessments in the current workspace",
    "1 个 ASPICE 项目持续监控": "1 ASPICE project monitored",
    "0 个表格": "0 tables",
    "AI 候选结论等待评估师确认": "AI candidate conclusions awaiting assessor confirmation",
    "证据不足、未复核与开放弱项": "Insufficient evidence, unreviewed items and open weaknesses",
    "证据、AI 复核、人工确认和关闭门禁同步展示；可直接生成 MAN.3 / SUP.8 文件问题专项子项目": "Evidence, AI review, human confirmation and closure gates are shown together; create a MAN.3 / SUP.8 file-issue subproject directly.",
    "当前阶段": "Current phase",
    "证据解析": "Evidence parsing",
    "AI / 人工": "AI / assessor",
    "开放弱项": "Open weaknesses",
    "实时进度": "Live progress",
    "过程映射": "Process mapping",
    "候选 / 已确认": "Candidate / confirmed",
    "Helix 表格证据态势": "Helix table evidence posture",
    "基于标识、状态、责任、基线、追溯与闭环字段自动识别": "Automatically identify identifiers, status, ownership, baselines, traceability and closure fields",
    "对象行": "Object rows",
    "有追溯关系": "With traceability relationships",
    "阻塞/失败": "Blocked / failed",
    "评审/批准": "Review / approval",
    "最近动态": "Recent activity",
    "审核、证据和人工复核事件": "Audit, evidence and human-review events",
    "CEP XP 工作区已限定": "CEP XP workspace is scoped",
    "份 CEP folder 文件可本地解析；追溯报告仅产生佐证观察。": "CEP folder files are available for local parsing; traceability reports produce corroborating observations only.",
    "按": "By",
    "上传": "Upload",
    "AI 复核": "AI review",
    "SUP 闭环": "SUP closure",
    "依赖分析": "dependency analysis",
    "评估师确认": "assessor confirmation",
    "人工门禁": "human gates",
    "先执行 AI 预评估": "Run the AI pre-assessment first",
    "系统会把证据映射到 BP/GP, 生成评分候选和需要评估师核实的问题，然后进入 Tree/Grid 现场执行视图。": "The system maps evidence to BP/GP, creates rating candidates and assessor questions, then opens the Tree/Grid execution view.",
    "系统会把证据映射到 BP/GP": "The system maps evidence to BP/GP",
    "生成评分候选": "creates rating candidates",
    "需要评估师核实的问题": "assessor questions",
    "然后进入 Tree/Grid 现场执行视图": "then opens the Tree/Grid execution view",
    "预评估会创建 BP/GP 指标集, 再根据本地解析的正文、表格和 Helix 行生成可复核追溯候选。": "The pre-assessment creates the BP/GP set and traceability candidates from locally parsed text, tables and Helix rows.",
    "预评估会创建 BP/GP 指标集": "The pre-assessment creates the BP/GP set",
    "再根据本地解析的正文、表格和 Helix 行生成可复核追溯候选": "and traceability candidates from locally parsed text, tables and Helix rows",
    "开始 AI 预评估": "Start AI pre-assessment",
    "证据本地解析完成": "Evidence local parsing complete",
    "个文件已读取正文/表格并拆分": " files parsed into document items",
    "识别": "Detected",
    "份 Helix 导出": " Helix exports",
    "文档条目": "document items",
    "文件内条目": "File items",
    "每个来源文件只显示一行": "Each source file is shown as one row",
    "可追溯来源": "traceable sources",
    "人工": "assessor",
    "开放": "Open",
    "阻塞": "Blocked",
    "通过": "Passed",
    "证据": "Evidence",
    "审核": "Audit",
    "事件": "events",
    "责任": "ownership",
    "基线": "baseline",
    "追溯": "traceability",
    "闭环": "closure",
    "当前账号": "Current account",
    "登录或切换账号": "Sign in or switch account",
    "登录": "Sign in",
    "或切换账号": "or switch account",
    "打开 Codex 评估助手": "Open Codex Assessment Assistant",
    "评审详情可直接编辑": "Review details are directly editable",
    "保存时保留人工评分、证据引用、发现与复核意见": "Saving preserves the human rating, evidence references, findings and review notes",
    "确认每个过程使用经评审/批准的输入，并向价值链下一过程提供合格输出。": "Verify that each process uses reviewed and approved inputs and supplies qualified outputs to the next value-chain process.",
    "检查需求/设计是否达成共同理解，验证结果、策略、计划和状态是否被汇总并沟通。": "Verify common understanding of requirements and design, and meaningful communication of verification, strategy, plan, and status summaries.",
    "检查系统—域—组件—单元分解、责任委派，以及按设计逐级集成验证。": "Verify system, domain, component, and unit decomposition, delegated responsibility, integration, and corresponding verification.",
    "沿来源与验证双向追溯，检查语义一致、变更影响和覆盖完整性。": "Follow bidirectional source-to-verification traceability and verify semantic consistency, change impact, and completeness.",
    "合格输入 → 合格输出": "Qualified input to qualified output",
    "约定与汇总沟通": "Agree and summarise",
    "分解、委派、集成与控制": "Divide and control",
    "追溯、一致性、影响与完整性": "Traceability and consistency",
    "直接证据覆盖": "Direct-evidence coverage",
    "跨过程佐证": "Cross-process corroboration",
    "核对": "Review",
    "缺口": "Gap",
    "缺口：": "Gap:",
    "AI 候选与证据充分性": "AI candidate and evidence sufficiency",
    "发现—BP/GP 映射校准": "Finding-to-BP/GP mapping calibration",
    "添加发现": "Add finding",
    "确认人工结论": "Confirm human conclusion",
    "取消": "Cancel",
    "关闭": "Close",
    "关联佐证": "corroborating context",
    "未计划": "Not planned",
    "已计划": "Planned",
    "复核": "Review",
    "已安排": "Scheduled",
    "已确认": "Confirmed",
    "已完成": "Completed",
    "已取消": "Cancelled",
    "初始化": "Initialization",
    "阶段": "phase",
    "项目阶段": "project phase",
    "评估活动": "assessment activity",
    "独立计划项": "Standalone plan item",
    "删除计划": "Delete plan",
    "添加活动": "Add activity",
    "添加访谈": "Add interview",
    "搜索计划、实例或负责人": "Search plans, instances, or owners",
    "搜索过程、实例、访谈对象": "Search process, instance, or interviewee",
    "全部日期": "All dates",
    "全部负责人": "All owners",
    "评估属性": "Assessment attributes",
    "计划": "Plan",
    "日程": "Schedule",
    "评估属性": "Assessment attributes",
    "未设日期": "No due date",
    "已排期": "Scheduled",
    "待安排": "Not scheduled",
    "时间": "Time",
    "持续时间": "Duration",
    "分钟": "minutes",
    "访谈对象": "Interviewee",
    "未指定访谈对象": "Interviewee not specified",
    "未安排": "Not scheduled",
    "未设置": "Not configured",
    "未分配": "Unassigned",
    "未标注": "Not specified",
    "到期日": "Due date",
    "项计划": "plans",
    "项日程": "sessions",
    "风险待评估师确认": "Risk requires assessor confirmation",
    "评估计划": "Assessment plan",
    "计划说明": "Plan notes",
    "优先级": "Priority",
    "最高": "Highest",
    "高": "High",
    "中": "Medium",
    "低": "Low",
    "日程看板": "Schedule board",
    "工作区设置": "Workspace settings",
    "账户、AI 与本地解析设置": "Account, AI and local parsing settings",
    "管理审核员协作、项目角色、ECS/MySQL 部署参数、AI 模型、Helix 表格识别规则和本地数据策略。": "Manage assessor collaboration, project roles, ECS/MySQL deployment parameters, AI models, Helix table recognition rules, and local data policy.",
    "管理审核员协作": "Manage assessor collaboration",
    "项目角色": "Project roles",
    "部署参数": "deployment parameters",
    "表格识别规则": "table recognition rules",
    "本地数据策略": "local data policy",
    "账户与角色": "Account and roles",
    "协作": "Collaboration",
    "Codex / Virtual Key": "Codex / Virtual Key",
    "items": "items",
    "文件解析": "file parsing",
    "评分计算": "rating calculation",
    "和导出": "and export",
    "用户电脑": "user computer",
    "行": " rows",
    "版本和": "version and ",
    "编辑租约": "edit leases",
    "修订事件": "revision events",
    "云端边界": "Cloud boundary",
    "当前操作人": "Current operator",
    "审核员与职责": "Assessors and responsibilities",
    "项目角色与过程域权限": "Project roles and process-domain permissions",
    "当前部署边界": "Current deployment boundary",
    "启用本机 Codex 复核": "Enable local Codex review",
    "本机 Codex 连接脚本": "Local Codex bridge script",
    "检查本机脚本": "Check local script",
    "保存设置": "Save settings",
    "云端": "Cloud",
    "本机": "Local",
    "服务器": "Server",
    "本地协议预览": "Local protocol preview",
    "服务器协作": "Server collaboration",
    "项目数": "Projects",
    "可用": "Available",
    "待邀请": "Invitation pending",
    "直接": "Direct",
    "关闭": "Closure",
    "系统集成与集成验证": "System Integration and Integration Verification",
    "系统需求分析": "System Requirements Analysis",
    "软件需求分析": "Software Requirements Analysis",
    "系统架构设计": "System Architectural Design",
    "需求挖掘": "Requirements Elicitation",
    "问题解决管理": "Problem Resolution Management",
    "变更请求管理": "Change Request Management",
    "配置管理": "Configuration Management",
    "项目管理": "Project Management",
    "质量保证": "Quality Assurance",
    "CEP XP 问题": "CEP XP Issue",
    "已定稿": "Finalised",
    "过程实施": "Process performance",
    "系统集成": "System Integration",
    "集成验证": "Integration Verification",
    "求分析": "Requirements Analysis",
    "求挖掘": "Requirements Elicitation",
    "系统": "System",
    "软件": "Software",
    "管理": "Management",
    "问题": "Issue",
    "定稿": "Finalised",
    "Automotive SPICE 内审工作台": "Automotive SPICE audit workspace",
    "取得此证据链的编辑权": "holds edit rights to this evidence chain",
    "当前条目在编辑期间由服务器租约保护": "The current item is protected by a server lease while it is being edited",
    "90 秒租约": "90-second lease",
    "自动心跳": "automatic heartbeat",
    "评分护栏": "rating guardrail",
    "组织级整改": "Organisation-level action",
    "建议访谈": "Suggested interview",
    "关闭证据": "closure evidence",
    "人工结论": "human conclusion",
    "人工最终评分": "human final rating",
    "AI 把握度": "AI confidence",
    "AI 专业评分理由": "AI assessment rationale",
    "证据引用": "Evidence references",
    "人工复核意见": "human review notes",
    "实时数据": "Live data",
    "审核状态": "audit status",
    "证据链": "evidence chain",
    "关闭风险": "closure risk",
    "本地解析": "local parsing",
    "人工复核": "human review",
    "人工确认": "human confirmation",
    "评估师": "assessor",
    "审核项目": "audit project",
    "审核方案": "audit scheme",
    "审核任务": "audit task",
    "审核问题": "audit question",
    "审核模型": "audit model",
    "审核范围": "assessment scope",
    "审核结果": "assessment result",
    "评估结果": "assessment result",
    "评估报告": "assessment report",
    "评估项目": "assessment project",
    "评估记录": "assessment record",
    "评估目的": "assessment purpose",
    "评估类别": "assessment class",
    "评估方式": "assessment method",
    "评估状态": "assessment status",
    "评估师记录": "assessor record",
    "审核问题章节整理": "assessment-issues-consolidated",
    "章节整理": "consolidated",
    "证据包": "evidence package",
    "证据引用": "evidence references",
    "证据不足": "insufficient evidence",
    "证据充分性": "evidence sufficiency",
    "证据对象": "evidence object",
    "详细assessment report": "Detailed assessment report",
    "详细 assessment report": "Detailed assessment report",
    "详细评估报告": "Detailed assessment report",
    "官方结构，逐 items评分 and evidence chain": "Official structure, item-level ratings and evidence chain",
    "官方结构，逐项评分和证据链": "Official structure, item-level ratings and evidence chain",
    "Management层汇报": "Management briefing",
    "Management层汇报 风险, 图 tables and 关键发现": "Management briefing with risks, charts, tables and key findings",
    "记录清单 筛选, 透视 and 改进跟踪": "Record register with filters, pivots and improvement tracking",
    "评估计划 and 邀请": "Assessment plan and invitations",
    "scope, 日程, 参 and 者, Evidence清单": "scope, schedule, participants and evidence register",
    "评估计划 and 邀请 scope, 日程, 参 and 者, Evidence清单": "Assessment plan and invitations, scope, schedule, participants and evidence register",
    "图 tables": "charts and tables",
    "关键发现": "key findings",
    "逐 items评分": "item-level ratings",
    "参 and 者": "participants",
    "Evidence清单": "evidence register",
    "范围状态": "scope status",
    "正式范围内，等待评估师核对": "In formal scope; awaiting assessor review",
    "范围外，只作观察": "Out of scope; observation only",
    "待审核的 Codex 结论": "Codex conclusions awaiting review",
    "这些内容是外部 AI 候选，不是正式评分；仅正式范围内过程进入下方复核工作台。": "These are external AI candidates, not formal ratings; only formal-scope processes enter the review workbench below.",
    "问题记录只证明缺口被识别": "Issue records only prove that a gap was identified",
    "配置管理计划、项目计划、受控任务、基线、状态报告和关闭样本等直接证据仍需单独核实。": "Direct evidence such as configuration plans, project plans, controlled tasks, baselines, status reports and closure samples still requires independent verification.",
    "正式范围固定为": "The formal scope is fixed to",
    "范围外过程仅形成关联观察，不进入评级。": "Out-of-scope processes produce related observations only and are not rated.",
    "AI 初稿，可复核改定": "AI draft; assessor amendment available",
    "BP + GP · AI 初稿，可复核改定": "BP + GP · AI draft; assessor amendment available",
    "AI 专业评分意见": "AI assessment opinion",
    "五维评分、证据护栏与可复核结论；人工评分为": "Five-dimension scoring, evidence guardrails and reviewable conclusion; human rating is",
    "审核意图": "Assessment intent",
    "评审详情可直接编辑": "Review details are directly editable",
    "保存时保留人工评分、证据引用、发现与复核意见；AI 输出仍只是候选。": "Saving preserves the human rating, evidence references, findings and review notes; AI output remains a candidate only.",
    "人工结论": "Human conclusion",
    "评估师记录": "Assessor record",
    "当前指标还没有评估师记录。": "No assessor record exists for this indicator.",
    "当前没有启用的评估提示。": "No assessment annotation is enabled.",
    "没有关联规则。": "No linked rules.",
    "Scope limitations": "Scope limitations",
    "正式范围固定为": "Formal scope is fixed to",
    "范围外过程仅形成关联观察": "Out-of-scope processes produce related observations only",
    "关联观察·不评级": "Related observation · not rated",
    "待评估师定义": "To be defined by the assessor",
    "待分配": "Unassigned",
    "待定位": "To be located",
    "未识别": "Unclassified",
    "份证据": " evidence files",
    "个表格": " tables",
    "个阻塞": " blockers",
    "个 ASPICE 项目持续监控": " ASPICE projects monitored",
    "个项目持续监控": " projects monitored",
    "条记录": " records",
    "条问题": " issues",
    "项待关联": " items unlinked",
    "条已人工确认": " assessor-confirmed",
    "项待复核": " items await review",
    "已溯源 BP/GP": "BP/GP linked",
    "Candidate / confirmed": "Candidate / confirmed",
    "审核 Workflow 实时漏斗": "Live audit workflow",
    "来自介绍材料的六阶段评估工作流；数字表示已到达该阶段的项目": "Six-stage assessment workflow; counts show projects that reached each stage",
    "当前审核状态": "Current audit status",
    "审核、证据和人工复核事件": "Audit, evidence and human-review events",
    "审核状态": "Audit status",
    "实时进度": "Live progress",
    "过程映射": "Process mapping",
    "By PA 过程属性": "By PA process attribute",
    "待评估师确认": "Awaiting assessor confirmation",
    "已复核": "Reviewed",
    "待复审": "Review pending",
    "CEP XP / 待复审": "CEP XP / Review pending",
    "CEP XP 评估问题与项目计划": "CEP XP assessment issues and project plan",
    "文件问题 / 已复核": "File issues / reviewed",
    "候选 / 已确认": "Candidate / confirmed",
    "0 条": "0 items",
    "1 份": "1 file",
    "进行中": "In progress",
    "评估已创建": "Assessment created",
    "评估员": "Assessor",
    "本报告由 AuditFlow AI 生成": "This report was generated by AuditFlow AI",
    "供内部过程改进与能力提升参考。": "for internal process improvement and capability development.",
    "详情": "Details",
    "核对详情": "Review details",
    "评审详情可直接编辑": "Review details are directly editable",
    "保存时保留人工评分、证据引用、发现与复核意见；AI 输出仍只是候选。": "Saving preserves the human rating, evidence references, findings and review notes; AI output remains a candidate only.",
    "当前账号": "Current account",
    "工作产品": "work product",
    "项目名称": "project name",
    "产品 / 项目": "product / project",
    "受评组织": "assessed organisation",
    "受审对象": "audited organisation",
    "审核负责人": "audit owner",
    "目标能力等级": "target capability level",
    "当前审核状态": "current audit status",
    "人工最终评分": "human final rating",
    "AI 候选": "AI candidate",
    "AI 把握度": "AI confidence",
    "AI 专业评分理由": "AI assessment rationale",
    "人工复核意见": "human review notes",
    "弱项": "weakness",
    "优势": "strength",
    "建议": "recommendation",
    "观察": "observation",
    "备注": "comment",
    "访谈问题": "interview question",
    "已保存": "saved",
    "保存": "save",
    "删除": "delete",
    "编辑": "edit",
    "查看": "view",
    "进入": "open",
    "新建": "new",
    "导入": "import",
    "导出": "export",
    "添加": "add",
    "清除": "clear",
    "重置": "reset",
    "确认": "confirm",
    "返回": "back",
    "状态": "status",
    "版本": "version",
    "日期": "date",
    "名称": "name",
    "类型": "type",
    "内容": "content",
    "范围": "scope",
    "用户": "user",
    "角色": "role",
    "密码": "password",
    "项目": "project",
    "文件": "file",
    "表格": "table",
    "本地": "local",
    "已连接": "connected",
    "离线": "offline",
    "失败": "failed",
    "成功": "successful",
    "处理中": "processing",
    "等待": "waiting",
    "进行中": "in progress",
    "已选择": "selected",
    "条": " items",
    "个": "",
    "项": " items",
    "份": " files",
    "行": " rows",
    "表": " tables",
    "需": "requires ",
    "未": "not ",
    "已": "",
    "和": " and ",
    "与": " and ",
    "或": " or "
  }).sort((a, b) => b[0].length - a[0].length);

  // Data-backed views (Grid, List, reports and the standards library) also
  // render imported Chinese fields that do not have a dedicated `*En` value.
  // Keep a local semantic vocabulary for those fields so the English UI does
  // not depend on a network translator or expose the old placeholder token.
  const semanticTerms = Object.entries({
    "后台管理": "Backend administration",
    "评审进度 Metrics": "Review progress metrics",
    "关闭阻断树": "Closure blocker tree",
    "不可修改的评估日志": "Immutable assessment log",
    "注册新编号": "Register new finding",
    "Finding 已保存": "Finding saved",
    "编辑 Finding": "Edit finding",
    "过程": "Process",
    "指标": "Indicator",
    "BP说明": "BP description",
    "证据说明": "Evidence description",
    "修改人": "Modified by",
    "逐条评审": "Item-by-item review",
    "版本与基线": "Versions and controlled baselines",
    "过程评估与整改": "process assessment and remediation",
    "过程评估": "process assessment",
    "过程评估报告": "process assessment report",
    "评估与整改": "assessment and remediation",
    "标准知识库": "ASPICE standards library",
    "ASPICE 标准知识库": "ASPICE standards library",
    "知识库": "knowledge base",
    "过程范围": "process scope",
    "项目计划": "project plan",
    "过程改进": "process improvement",
    "过程改进项目": "process improvement project",
    "独立受控计划": "independent controlled plan",
    "明确起止时间": "explicit start and end dates",
    "过程实施": "process performance",
    "基本实践": "base practice",
    "目标过程": "target process",
    "直接实施证据": "direct implementation evidence",
    "关联证据": "related evidence",
    "问题佐证": "issue corroboration",
    "证据链": "evidence chain",
    "证据角色": "evidence role",
    "评估报告": "assessment report",
    "审核报告": "audit report",
    "评估结果": "assessment results",
    "评定结果": "assessment results",
    "候选指标映射": "candidate indicator mapping",
    "评估师记录": "assessor record",
    "人工复核": "assessor review",
    "人工确认": "assessor confirmation",
    "评估师": "assessor",
    "评审详情": "review details",
    "评审问题": "assessment question",
    "过程域": "process domain",
    "能力等级": "capability level",
    "评分": "rating",
    "候选": "candidate",
    "正式范围": "formal scope",
    "范围内": "in scope",
    "范围外": "out of scope",
    "待复审": "review pending",
    "待复核": "review pending",
    "已定稿": "finalised",
    "已关闭": "closed",
    "未关闭": "not closed",
    "工作产品": "work product",
    "受控基线": "controlled baseline",
    "基线版本": "baseline version",
    "版本": "version",
    "变更请求": "change request",
    "问题解决": "problem resolution",
    "配置管理": "configuration management",
    "质量保证": "quality assurance",
    "项目管理": "project management",
    "需求挖掘": "requirements elicitation",
    "系统需求分析": "system requirements analysis",
    "系统架构设计": "system architectural design",
    "系统集成与集成验证": "system integration and integration verification",
    "软件需求分析": "software requirements analysis",
    "硬件需求分析": "hardware requirements analysis",
    "硬件设计": "hardware design",
    "机器学习": "machine learning",
    "关联过程": "related process",
    "直接证据": "direct evidence",
    "跨过程佐证": "cross-process corroboration",
    "仅索引": "index-only",
    "关联观察": "related observation",
    "不评级": "not rated",
    "证据不足": "insufficient evidence",
    "证据充分": "evidence sufficient",
    "证据部分充分": "evidence partially sufficient",
    "证据覆盖": "evidence coverage",
    "直接证据覆盖": "direct-evidence coverage",
    "关闭门禁": "closure gates",
    "关闭风险": "closure risk",
    "关闭证据": "closure evidence",
    "评审批准": "review and approval",
    "责任人": "owner",
    "负责人": "owner",
    "项目阶段": "project phase",
    "评估活动": "assessment activity",
    "证据解析": "evidence parsing",
    "本地解析": "local parsing",
    "本地上传": "local upload",
    "导入评估资料": "imported assessment material",
    "原始问题": "original issue",
    "整改": "remediation",
    "整改闭环": "remediation closure",
    "组织级": "organisation-level",
    "项目级": "project-level",
    "评审状态": "review status",
    "评审进度": "review progress",
    "评估计划": "assessment plan",
    "计划说明": "plan notes",
    "里程碑": "milestone",
    "持续时间": "duration",
    "持续期": "duration",
    "起止日期": "start and end dates",
    "时间": "time",
    "日期": "date",
    "状态": "status",
    "类型": "type",
    "名称": "name",
    "内容": "content",
    "范围": "scope",
    "目标": "target",
    "过程": "process",
    "项目": "project",
    "文件": "file",
    "表格": "table",
    "条目": "item",
    "记录": "record",
    "问题": "issue",
    "缺口": "gap",
    "风险": "risk",
    "影响": "impact",
    "依赖": "dependency",
    "验证": "verification",
    "测试": "test",
    "设计": "design",
    "架构": "architecture",
    "接口": "interface",
    "资源": "resources",
    "成本": "cost",
    "质量": "quality",
    "完成": "complete",
    "报告": "report",
    "缺少": " missing ",
    "未形成": " not established ",
    "独立": " independent ",
    "进行中": "in progress",
    "待处理": "pending",
    "待确认": "to be confirmed",
    "待定位": "locator required",
    "待分类": "unclassified",
    "待安排": "not scheduled",
    "未设置": "not configured",
    "未分配": "unassigned",
    "未标注": "not specified",
    "已确认": "confirmed",
    "已完成": "completed",
    "已保存": "saved",
    "保存": "save",
    "删除": "delete",
    "编辑": "edit",
    "查看": "view",
    "进入": "open",
    "新建": "new",
    "导入": "import",
    "导出": "export",
    "添加": "add",
    "清除": "clear",
    "重置": "reset",
    "确认": "confirm",
    "返回": "back",
    "打开": "open",
    "关闭": "close",
    "取消": "cancel",
    "搜索": "search",
    "检查": "check",
    "分析": "analysis",
    "识别": "detected",
    "生成": "generate",
    "发布": "publish",
    "批准": "approval",
    "评审": "review",
    "复核": "review",
    "关联": "link",
    "追溯": "traceability",
    "一致性": "consistency",
    "完整性": "completeness",
    "关闭": "closure",
    "优势": "strength",
    "弱项": "weakness",
    "建议": "recommendation",
    "观察": "observation",
    "备注": "comment",
    "访谈": "interview",
    "模型": "model",
    "数据": "data",
    "服务": "service",
    "本机": "local machine",
    "当前版本": "current version",
    "历史版本": "version history",
    "标准": "standard",
    "专项": "workstream",
    "文件问题": "file issue",
    "专业评估": "professional assessment",
    "专业评估报告": "professional assessment report",
    "已登记": "is registered",
    "已登记并与": "is registered against",
    "详情": "details",
    "职责": "responsibilities",
    "责任": "responsibility",
    "各过程职责如下": "responsibilities for each process are as follows",
    "每个": "each",
    "各": "each",
    "如下": "as follows",
    "当前": "current",
    "相关": "related",
    "请": "please",
    "显示": "shown",
    "已完成": "completed"
    ,"系统会把证据映射到 BP/GP，生成评分候选和需要评估师核实的问题，然后进入 Tree/Grid 现场执行视图。": "The system maps evidence to BP/GP, creates rating candidates and assessor questions, then opens the Tree/Grid execution view."
    ,"预评估会创建 BP/GP 指标集，再根据本地解析的正文、表格和 Helix 行生成可复核追溯候选。": "The pre-assessment creates the BP/GP set and reviewable traceability candidates from locally parsed text, tables, and Helix rows."
    ,"先执行 AI 预评估": "Run the AI pre-assessment first"
    ,"开始 AI 预评估": "Start AI pre-assessment"
    ,"没有符合筛选条件的 item。": "No items match the filters."
    ,"当前指标没有已保存的证据关系": "No saved evidence relationship exists for this indicator"
    ,"当前指标没有证据关系": "No evidence relationship exists for this indicator"
    ,"集中维护 PAM 版本、过程 BP、通用实践 GP、审核要素、评分规则、提示词和报告输出配置。": "Maintain the PAM version, process BPs, generic practices, assessment elements, rating rules, prompts, and report output configuration."
    ,"28 个过程模块，选择过程可查看用途、BP 清单和典型证据要求。": "28 process modules. Select a process to inspect its purpose, BP list, and typical evidence requirements."
  }).sort((a, b) => b[0].length - a[0].length);

  function translateSemanticChunk(chunk) {
    let output = chunk;
    for (const [from, to] of semanticTerms) output = output.split(from).join(to);
    return output;
  }

  function fallback(chunk) {
    // Free-form project evidence is never sent to a remote translator. Keep
    // an untranslated source segment intact rather than replacing it with the
    // misleading generic word "Details".
    const translated = translateSemanticChunk(String(chunk || ""));
    return translated;
  }

  function translate(value) {
    const source = String(value == null ? "" : value).replace(PLACEHOLDER, "Original text unavailable");
    if (translationCache.has(source)) return translationCache.get(source);
    if (!CJK.test(source)) return source;
    const leading = source.match(/^\s*/)?.[0] || "";
    const trailing = source.match(/\s*$/)?.[0] || "";
    const core = source.slice(leading.length, source.length - trailing.length);
    if (exact.has(core)) {
      const result = leading + exact.get(core) + trailing;
      translationCache.set(source, result);
      return result;
    }
    let output = translateSemanticChunk(core);
    for (const [from, to] of phrases) output = output.split(from).join(to);
    output = output.replace(CJK_RUN, fallback);
    output = output.replace(/，/g, ", ").replace(/。/g, ". ").replace(/；/g, "; ").replace(/：/g, ": ").replace(/！/g, "!").replace(/？/g, "?").replace(/（/g, "(").replace(/）/g, ")").replace(/【/g, "[").replace(/】/g, "]").replace(/、/g, ", ");
    output = output.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    const result = leading + output + trailing;
    translationCache.set(source, result);
    return result;
  }

  function editableControls(root) {
    if (!root) return [];
    const selector = "input, textarea";
    const candidates = root.matches?.(selector) ? [root, ...(root.querySelectorAll?.(selector) || [])] : [...(root.querySelectorAll?.(selector) || [])];
    return candidates.filter(element => {
      if (element.closest?.("script, style, [data-i18n-skip]")) return false;
      if (element.tagName === "TEXTAREA") return true;
      const type = String(element.getAttribute("type") || "text").toLowerCase();
      return !["hidden", "password", "file", "checkbox", "radio", "color", "range", "button", "submit", "reset", "image"].includes(type);
    });
  }

  function restoreControls(root = document.body) {
    const candidates = new Set([...editableControls(root), ...protectedControls]);
    candidates.forEach(element => {
      const source = controlSource.get(element);
      if (!source) return;
      element.value = source.value;
      element.readOnly = source.readOnly;
      if (source.title == null) element.removeAttribute("title");
      else element.setAttribute("title", source.title);
      element.removeAttribute("data-i18n-protected-value");
      controlSource.delete(element);
      protectedControls.delete(element);
    });
  }

  function translateControls(root = document.body) {
    if (language !== "en") return;
    [...protectedControls].forEach(element => {
      if (!element.isConnected) {
        controlSource.delete(element);
        protectedControls.delete(element);
      }
    });
    editableControls(root).forEach(element => {
      const existing = controlSource.get(element);
      const original = existing?.value ?? element.value;
      if (!CJK.test(original || "") && !PLACEHOLDER_TEST.test(original || "")) return;
      const source = existing || { value: original, readOnly: element.readOnly, title: element.getAttribute("title") };
      source.translated = translate(source.value);
      controlSource.set(element, source);
      protectedControls.add(element);
      element.value = source.translated;
      element.readOnly = true;
      element.setAttribute("data-i18n-protected-value", "true");
      element.setAttribute("title", "This value is translated from the corresponding Chinese field. Switch to Chinese to edit the source value.");
    });
  }

  function temporarilyRestoreControls() {
    if (language !== "en" || !protectedControls.size) return;
    restoreControls(document.body);
    queueMicrotask(() => {
      if (language === "en") translateControls(document.body);
    });
  }

  function restoreTree(root) {
    if (!root) return;
    restoreControls(root);
    const walker = document.createTreeWalker(root, SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (textSource.has(node)) node.nodeValue = textSource.get(node);
    });
    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [];
    elements.forEach(element => {
      const values = attributeSource.get(element);
      if (values) Object.entries(values).forEach(([name, value]) => element.setAttribute(name, value));
    });
  }

  function translateTree(root = document.body) {
    if (language !== "en" || !root) return;
    const walker = document.createTreeWalker(root, SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, textarea, [data-i18n-skip]")) return FILTER_REJECT;
        const value = node.nodeValue || "";
        return CJK.test(value) || PLACEHOLDER_TEST.test(value) ? FILTER_ACCEPT : FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (!textSource.has(node)) textSource.set(node, node.nodeValue);
      node.nodeValue = translate(textSource.get(node));
    });
    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [];
    elements.forEach(element => {
      if (element.closest("script, style, [data-i18n-skip]")) return;
      attributes.forEach(name => {
        const value = element.getAttribute?.(name);
        if (!value || !CJK.test(value)) return;
        const known = attributeSource.get(element) || {};
        if (!(name in known)) {
          known[name] = value;
          attributeSource.set(element, known);
        }
        element.setAttribute(name, translate(known[name]));
      });
    });
    if (CJK.test(document.title)) {
      if (!originalTitle) originalTitle = document.title;
      document.title = translate(originalTitle);
    }
    translateControls(root);
  }

  function scheduleTranslation() {
    if (language !== "en" || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      translateTree(document.body);
    });
  }

  function setLanguage(next) {
    language = next === "en" ? "en" : "zh-CN";
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    if (language === "en") translateTree(document.body);
    else {
      restoreTree(document.body);
      document.title = originalTitle;
    }
  }

  function start() {
    if (observer || !document.body) return;
    observer = new MutationObserver(scheduleTranslation);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", temporarilyRestoreControls, true);
    document.addEventListener("submit", temporarilyRestoreControls, true);
  }

  window.AuditFlowI18n = {
    start,
    setLanguage,
    translateTree,
    isEnglish: () => language === "en",
    translate,
    untranslatedVisibleTextCount() {
      const text = document.body?.innerText || "";
      const textCount = (text.match(CJK) || []).length;
      const controlCount = editableControls(document.body).reduce((count, element) => count + ((String(element.value || "").match(CJK) || []).length), 0);
      return textCount + controlCount;
    }
  };
}());
