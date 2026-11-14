(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JiraFlowI18n = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const translations = {
    "切换侧边栏": "Toggle sidebar",
    "切换明暗主题": "Toggle light or dark theme",
    "切换语言": "Switch language",
    "切换到中文": "Switch to Chinese",
    "切换到英文": "Switch to English",
    "首页": "Home",
    "仪表板": "Dashboard",
    "看板": "Board",
    "问题": "Issues",
    "版本": "Releases",
    "报告": "Reports",
    "创建": "Create",
    "通知": "Notifications",
    "摘要": "Summary",
    "发布版本": "Releases",
    "空间": "Project",
    "协作": "Collaboration",
    "分配给我": "Assigned to me",
    "最近更新": "Recently updated",
    "管理": "Administration",
    "项目设置": "Project settings",
    "项目设置导航": "Project settings navigation",
    "项目问题": "Project issues",
    "项目看板": "Project board",
    "项目入口": "Project shortcuts",
    "计划": "Plans",
    "项目更多操作": "More project actions",
    "项目导航": "Project navigation",
    "全局导航": "Global navigation",
    "账户和个人资料": "Account and profile",
    "当前绑定用户": "Current user",
    "当前绑定用户：": "Current user: ",
    "用户管理": "User management",
    "审计历史": "Audit history",
    "插件": "Plugins",
    "问题模块": "Issue modules",
    "搜索问题或项目": "Search issues or projects",
    "搜索看板": "Search board",
    "搜索": "Search",
    "仅我的问题": "Only my issues",
    "最近创建": "Recently created",
    "最近更新": "Recently updated",
    "最近 12 条": "Latest 12",
    "创建问题": "Create issue",
    "选择项目": "Select project",
    "当前没有可访问的项目。": "No projects are currently accessible.",
    "暂无可访问项目": "No accessible projects",
    "项目自动同步失败，请重试。": "Project synchronization failed. Please retry.",
    "请求的 JiraFlow 项目不可访问。": "The requested JiraFlow project is not accessible.",
    "打开项目设置": "Open project settings",
    "JiraFlow 帮助": "JiraFlow help",
    "完成": "Done",
    "项目摘要": "Project summary",
    "组件职责或边界": "Component responsibilities or boundaries",
    "可选用户名": "Optional username",
    "组件名称": "Component name",
    "组件职责": "Component responsibilities",
    "添加状态": "Add status",
    "配置项目": "Configure project",
    "打开通知": "Open notifications",
    "移动问题": "Move issue",
    "移动到": "Move to",
    "无工作项": "No work items",
    "所有问题": "All issues",
    "快速筛选": "Quick filters",
    "筛选器操作": "Filter actions",
    "筛选器说明": "Filter details",
    "共享设置": "Sharing settings",
    "订阅": "Subscribe",
    "订阅频率": "Subscription frequency",
    "筛选器描述": "Filter description",
    "共享用户": "Shared users",
    "上一页": "Previous page",
    "下一页": "Next page",
    "选择一个问题查看详情": "Select an issue to view details",
    "关闭创建问题": "Close create issue dialog",
    "记录工作": "Log work",
    "版本列表": "Release list",
    "计划视图": "Plan view",
    "未绑定用户": "No user bound",
    "本地 JiraFlow 账户": "Local JiraFlow account",
    "账户信息": "Account details",
    "本地账户": "Local account",
    "工作流配置": "Workflow configuration",
    "看板状态": "Board statuses",
    "默认经办人": "Default assignee",
    "字段": "Fields",
    "问题特性": "Issue features",
    "问题属性": "Issue properties",
    "相关的方案": "Related schemes",
    "关联问题": "related issues",
    "新建条目": "Create entry",
    "新建": "Create",
    "管理区域": "Administration area",
    "条目名称": "Entry name",
    "条目属性": "Entry properties",
    "状态键，例如 QA": "Status key, for example QA",
    "状态名称，例如 审查中": "Status name, for example In review",
    "状态名称": "Status name",
    "关闭证据": "Closure evidence",
    "ASIL": "ASIL",
    "网络安全等级": "Cybersecurity level",
    "正式范围": "Formal scope",
    "工作说明": "Work description",
    "分钟": "minutes",
    "备注": "Notes",
    "记录工作日志": "Log work",
    "编辑问题": "Edit issue",
    "活动": "Activity",
    "详情": "Details",
    "历史记录": "History",
    "修改日期": "Updated",
    "数据": "Data",
    "附件详情": "Attachment details",
    "更新于": "Updated",
    "打开问题": "Open issue",
    "打开看板": "Open board",
    "浏览问题": "Browse issues",
    "查看全部": "View all",
    "查看审计": "View audit history",
    "查看报告": "View report",
    "添加评论": "Add comment",
    "保存": "Save",
    "保存描述": "Save description",
    "保存字段": "Save fields",
    "保存设置": "Save settings",
    "保存筛选器": "Save filter",
    "保存筛选器说明": "Save filter description",
    "刷新": "Refresh",
    "编辑": "Edit",
    "删除": "Delete",
    "取消": "Cancel",
    "关闭": "Close",
    "添加": "Add",
    "运行": "Run",
    "运行报告": "Run report",
    "运行筛选器": "Run filter",
    "全部标为已读": "Mark all as read",
    "标为已读": "Mark as read",
    "已读": "Read",
    "未读": "Unread",
    "未分配": "Unassigned",
    "全部": "All",
    "无": "None",
    "无描述": "No description",
    "无限制": "No limit",
    "启用": "Enabled",
    "停用": "Disabled",
    "系统": "System",
    "应用程序": "Applications",
    "字段配置": "Field configuration",
    "字段配置方案": "Field configuration scheme",
    "界面": "Screens",
    "界面方案": "Screen scheme",
    "问题类型": "Issue types",
    "问题类型方案": "Issue type scheme",
    "问题类型界面方案": "Issue type screen scheme",
    "优先级": "Priority",
    "优先级方案": "Priority scheme",
    "权限方案": "Permission scheme",
    "通知方案": "Notification scheme",
    "工作流": "Workflow",
    "工作流方案": "Workflow scheme",
    "自定义字段": "Custom fields",
    "系统字段": "System fields",
    "审计事件": "Audit events",
    "管理区域": "Administration area",
    "搜索分类或条目": "Search categories or entries",
    "名称": "Name",
    "描述": "Description",
    "负责人": "Lead",
    "负责人或边界": "Owner or boundary",
    "更新时间": "Updated",
    "操作": "Actions",
    "状态": "Status",
    "类型": "Type",
    "经办人": "Assignee",
    "报告人": "Reporter",
    "解决结果": "Resolution",
    "标签": "Labels",
    "修复版本": "Fix versions",
    "影响版本": "Affects versions",
    "子任务": "Subtasks",
    "到期日": "Due date",
    "环境": "Environment",
    "概要": "Summary",
    "项目": "Project",
    "项目名称": "Project name",
    "项目描述": "Project description",
    "项目负责人": "Project lead",
    "候选评级": "Candidate rating",
    "审核决定": "Review decision",
    "审核状态": "Review status",
    "正式范围": "Formal scope",
    "证据角色": "Evidence role",
    "客观证据": "Objective evidence",
    "佐证证据": "Corroborating evidence",
    "索引证据": "Index evidence",
    "直接证据": "Direct evidence",
    "双向追踪链接": "Bidirectional trace links",
    "评估": "Assessment",
    "评估覆盖率": "Assessment coverage",
    "评估完整性": "Assessment completeness",
    "ASPICE 待处理问题": "Open ASPICE issues",
    "CAL / 风险等级": "CAL / risk level",
    "分析领域": "Analysis domain",
    "网络安全等级": "Cybersecurity level",
    "功能安全": "Functional safety",
    "过程区域": "Process area",
    "验证方法": "Verification method",
    "风险陈述": "Risk statement",
    "候选结论需由审核员确认": "Candidate conclusions require assessor confirmation",
    "正式评级、证据确认、范围和关闭决定由审核员负责。": "The assessor owns formal ratings, evidence confirmation, scope, and closure decisions.",
    "正在加载问题...": "Loading issues...",
    "正在加载 JiraFlow 工作区...": "Loading JiraFlow workspace...",
    "没有符合当前 JQL 的问题。": "No issues match the current JQL.",
    "暂无附件。": "No attachments yet.",
    "暂无评论。": "No comments yet.",
    "暂无问题链接。": "No issue links yet.",
    "暂无子任务。": "No subtasks yet.",
    "暂无工作日志。": "No work logs yet.",
    "暂无模板。": "No templates yet.",
    "未发现插件。可通过 ServiceLoader 或数据目录 plugins/*.json 注册扩展。": "No plugins found. Register extensions through ServiceLoader or data-directory plugins/*.json descriptors.",
    "新增状态会成为可用看板列；状态移动仍需要一条启用的工作流转换。": "New statuses become available board columns. Moving issues still requires an enabled workflow transition.",
    "当前正在进行列未超过 WIP 限制。": "The in-progress column is within its WIP limit.",
    "正在进行列已超过 WIP 限制。": "The in-progress column is over its WIP limit.",
    "切换当前项目，项目级导航保留在左侧菜单。": "Switch the current project; project navigation stays in the left menu.",
    "使用 JQL、快速筛选器和保存筛选器查找工作项。": "Use JQL, quick filters, and saved filters to find work items.",
    "拖动问题卡片或使用状态选择器更新工作流。": "Drag issue cards or use the status selector to update the workflow.",
    "以版本时间线查看当前项目的发布计划。": "View the current project's release plan on a version timeline.",
    "配置角色、组件、工作流和看板状态。": "Configure roles, components, workflows, and board statuses.",
    "删除工作流转换？": "Delete this workflow transition?",
    "删除这条评论？": "Delete this comment?",
    "删除问题链接？": "Delete this issue link?",
    "删除附件？": "Delete this attachment?",
    "概要不能为空": "Summary is required",
    "状态名称不能为空": "Status name is required",
    "组件名称不能为空": "Component name is required",
    "请求失败": "Request failed",
    "检测到并发修改，已加载服务器最新版本。": "A concurrent change was detected. The latest server version has been loaded.",
    "用户已创建": "User created",
    "用户已更新": "User updated",
    "用户已启用": "User enabled",
    "用户已停用": "User disabled",
    "版本已创建": "Release created",
    "版本已更新": "Release updated",
    "版本已发布": "Release published",
    "报告已运行": "Report generated",
    "报告模板": "Report templates",
    "报告类型": "Report type",
    "报告配置": "Report configuration",
    "模板": "Template",
    "使用报告类型": "Use report type",
    "内置": "Built-in",
    "不使用筛选器": "Do not use a filter",
    "附加 JQL": "Additional JQL",
    "可选：": "Optional: ",
    "模板参数 JSON": "Template parameters JSON",
    "暂无数据。": "No data yet.",
    "已填写候选评级": "Candidate ratings entered",
    "已关闭": "Closed",
    "WIP 限制": "WIP limit",
    "当前": "Current",
    "限制": "Limit",
    "未设置": "Not set",
    "类别": "Category",
    "可见性": "Visibility",
    "所有者": "Owner",
    "加载报告...": "Loading report...",
    "报告结果载荷": "Report result payload",
    "模板目录": "Template catalog",
    "模板参数": "Template parameters",
    "模板描述": "Template description",
    "模板类别": "Template category",
    "模板键（可选）": "Template key (optional)",
    "模板 JQL（可选）": "Template JQL (optional)",
    "模板参数 schema JSON": "Template parameter schema JSON",
    "报告模板名称": "Report template name",
    "筛选器": "Filters",
    "筛选器名称": "Filter name",
    "筛选器已保存": "Filter saved",
    "筛选器已更新": "Filter updated",
    "筛选器已删除": "Filter deleted",
    "筛选器共享设置已更新": "Filter sharing settings updated",
    "工作流转换已添加": "Workflow transition added",
    "工作流转换已更新": "Workflow transition updated",
    "工作流转换已删除": "Workflow transition deleted",
    "组件已创建": "Component created",
    "组件已更新": "Component updated",
    "组件已删除": "Component deleted",
    "看板状态已添加": "Board status added",
    "问题字段已保存": "Issue fields saved",
    "描述已保存": "Description saved",
    "项目设置已保存": "Project settings saved",
    "评论已添加": "Comment added",
    "附件已添加": "Attachment added",
    "附件已删除": "Attachment deleted",
    "问题链接已添加": "Issue link added",
    "问题链接已删除": "Issue link deleted",
    "通知已全部标为已读": "All notifications marked as read",
    "工作日志已记录": "Work log recorded",
    "子任务已创建": "Subtask created",
    "已发布": "Released",
    "未发布": "Unreleased",
    "已归档": "Archived",
    "已完成": "Done",
    "未完成": "Incomplete",
    "开放": "Open",
    "待审核": "Pending review",
    "审核中": "In review",
    "审核接受": "Review accepted",
    "审核驳回": "Review rejected",
    "待办": "To do",
    "待开发": "To do",
    "正在进行": "In progress",
    "完成": "Done",
    "不分组": "No grouping",
    "按泳道分组": "Group by swimlane",
    "按经办人分组": "Group by assignee",
    "按状态": "By status",
    "按优先级": "By priority",
    "按类型": "By type",
    "按候选评级": "By candidate rating",
    "按分析领域": "By analysis domain",
    "按审核状态": "By review status",
    "按证据角色": "By evidence role",
    "按过程区域": "By process area",
    "问题总数": "Total issues",
    "问题总数": "Total issues",
    "饼图": "Pie chart",
    "累计流量图": "Cumulative flow diagram",
    "控制图": "Control chart",
    "单词分组报告": "Word grouping report",
    "问题持续时间报告": "Issue duration report",
    "周期时间": "Cycle time",
    "平均持续时间": "Average duration",
    "中位持续时间": "Median duration",
    "持续时间": "Duration",
    "问题数": "Issue count",
    "数量": "Count",
    "百分比": "Percentage",
    "分组": "Group",
    "区间": "Bucket",
    "日期": "Date",
    "单词": "Word",
    "按": "By",
    "天": "days",
    "问题概要": "Issue summary",
    "平均周期": "Average cycle",
    "暂无流程历史数据。": "No workflow history data yet.",
    "暂无已完成问题。": "No completed issues yet.",
    "暂无可分组的词语。": "No words available for grouping.",
    "项目信息": "Project information",
    "项目角色": "Project roles",
    "空间入口": "Project shortcuts",
    "已保存筛选器": "Saved filters",
    "活动日志": "Activity log",
    "未读通知": "Unread notifications",
    "已发现的扩展": "Discovered extensions",
    "管理条目": "Administration entry",
    "管理条目名称": "Entry name",
    "管理条目属性": "Entry properties",
    "管理条目描述": "Entry description",
    "管理条目键": "Entry key",
    "管理条目已创建": "Entry created",
    "管理条目已更新": "Entry updated",
    "管理条目已删除": "Entry deleted",
    "系统条目只读": "System entries are read-only",
    "本地用户管理只用于 JiraFlow 的协作演示；生产环境应接入企业身份提供方并使用会话认证。": "Local user management is for JiraFlow collaboration only. Production deployments should use an enterprise identity provider and session-based authentication.",
    "管理操作和问题变更以追加事件形式记录。当前页面需要全局管理员权限。": "Administration and issue changes are recorded as append-only events. This page requires global administrator access.",
    "可编辑模板允许保存 JQL、参数和共享范围": "Editable templates can save JQL, parameters, and sharing scope",
    "报告模板已创建": "Report template created",
    "报告模板已更新": "Report template updated",
    "报告模板已删除": "Report template deleted",
    "已收藏": "Starred",
    "已取消收藏": "Unstarred",
    "收藏": "Star",
    "取消收藏": "Unstar",
    "关注": "Watch",
    "取消关注": "Stop watching",
    "投票": "Vote",
    "取消投票": "Remove vote",
    "固定": "Pin",
    "取消固定": "Unpin",
    "已存档事务": "Issue archived",
    "可见性只能是 private、shared 或 global": "Visibility must be private, shared, or global",
    "模板参数 schema（可选）": "Template parameter schema (optional)",
    "新转换名称": "New transition name",
    "转换名称": "Transition name",
    "验证器": "Validator",
    "输入问题概要": "Enter issue summary",
    "输入子任务概要": "Enter subtask summary",
    "补充背景、验收条件或上下文": "Add background, acceptance criteria, or context",
    "例如 KTEST-2": "For example, KTEST-2",
    "例如 Safety Monitor": "For example, Safety Monitor",
    "例如 N、P、L、F（由审核员确认）": "For example, N, P, L, F (assessor confirmed)",
    "例如 SWE.1、SUP.8、MAN.3": "For example, SWE.1, SUP.8, MAN.3",
    "报告模块": "Reports",
    "添加": "Add",
    "关闭": "Close",
    "取消": "Cancel",
    "启用（true / false）": "Enabled (true / false)",
    "订阅频率无效": "Invalid subscription frequency",
    "评论": "Comments",
    "附件": "Attachments",
    "组件": "Components",
    "描述": "Description",
    "工作日志": "Work logs",
    "工作说明": "Work description",
    "版本名称": "Release name",
    "版本描述": "Release description",
    "状态名称，例如 审查中": "Status name, for example In review",
    "状态键，例如 QA": "Status key, for example QA",
    "属性 JSON": "Properties JSON",
    "属性 JSON（可选）": "Properties JSON (optional)",
    "管理条目键（可选）": "Entry key (optional)",
    "模板参数 schema JSON（可选）": "Template parameter schema JSON (optional)",
    "问题字段已保存": "Issue fields saved",
    "登录": "Sign in",
    "运行筛选器": "Run filter",
    "最近已处理": "Recently worked",
    "最近访问": "Recently viewed",
    "设置": "Settings",
    "固定": "Pin"
  };

  function translateText(value) {
    const text = String(value ?? "");
    const trimmed = text.trim();
    const exact = translations[trimmed];
    if (exact) return text.replace(trimmed, exact);
    const jiraFlowCrumb = trimmed.match(/^JiraFlow\s*\/\s*(.+)$/);
    if (jiraFlowCrumb && translations[jiraFlowCrumb[1]]) {
      return text.replace(trimmed, `JiraFlow / ${translations[jiraFlowCrumb[1]]}`);
    }
    const projectLead = trimmed.match(/^(.*?)(\s·\s)负责人\s+(.+)$/);
    if (projectLead) return text.replace(trimmed, `${projectLead[1]}${projectLead[2]}Lead ${projectLead[3]}`);
    const statusChange = trimmed.match(/^(.+?)\s+已移动到\s+(.+)$/);
    if (statusChange && translations[statusChange[2]]) {
      return text.replace(trimmed, `${statusChange[1]} moved to ${translations[statusChange[2]]}`);
    }
    const issueCreated = trimmed.match(/^(.+?)\s+已创建$/);
    if (issueCreated) return text.replace(trimmed, `${issueCreated[1]} created`);
    const percentComplete = trimmed.match(/^(\d+(?:\.\d+)?)%\s*完成$/);
    if (percentComplete) return text.replace(trimmed, `${percentComplete[1]}% complete`);
    const issueCountCompleted = trimmed.match(/^(\d+)\s*\/\s*(\d+)\s*个关联问题已完成$/);
    if (issueCountCompleted) {
      const count = Number(issueCountCompleted[2]);
      return text.replace(trimmed, `${issueCountCompleted[1]} / ${issueCountCompleted[2]} related ${count === 1 ? "issue" : "issues"} completed`);
    }
    const updatedAt = trimmed.match(/^(.*?)(?:\s*·\s*)?更新于\s+((?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4])(?:,?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)$/i);
    if (updatedAt) {
      const separator = updatedAt[1] && trimmed.slice(updatedAt[1].length).startsWith(" · ") ? " · " : "";
      return text.replace(trimmed, `${updatedAt[1]}${separator}Updated ${updatedAt[2]}`);
    }
    const relatedIssues = trimmed.match(/^(\d+)\s*个关联问题已完成$/);
    if (relatedIssues) {
      return text.replace(trimmed, `${relatedIssues[1]} related ${Number(relatedIssues[1]) === 1 ? "issue" : "issues"} completed`);
    }
    const workMinutes = trimmed.match(/^(\d+)\s*分钟\s*·\s*(.+)$/);
    if (workMinutes) {
      return text.replace(trimmed, `${workMinutes[1]} ${Number(workMinutes[1]) === 1 ? "minute" : "minutes"} · ${workMinutes[2]}`);
    }
    const currentUser = trimmed.match(/^当前绑定用户：(.+)$/);
    if (currentUser) return text.replace(trimmed, `Current user: ${currentUser[1]}`);
    const itemLabelCount = trimmed.match(/^(\d+)\s*项$/);
    if (itemLabelCount) return text.replace(trimmed, `${itemLabelCount[1]} ${Number(itemLabelCount[1]) === 1 ? "item" : "items"}`);
    const columnCount = trimmed.match(/^(\d+)\s*列$/);
    if (columnCount) return text.replace(trimmed, `${columnCount[1]} ${Number(columnCount[1]) === 1 ? "column" : "columns"}`);
    const reportCounts = trimmed.match(/^(\d+)\s*个内置类型\s*·\s*(\d+)\s*个可见模板$/);
    if (reportCounts) {
      const plural = (count, singular, pluralForm) => Number(count) === 1 ? singular : pluralForm;
      return text.replace(trimmed, `${reportCounts[1]} ${plural(reportCounts[1], "built-in type", "built-in types")} · ${reportCounts[2]} ${plural(reportCounts[2], "visible template", "visible templates")}`);
    }
    const reportAssessment = trimmed.match(/^已填写候选评级\s+(\d+)\s*\/\s*(\d+)；已关闭\s+(\d+)。$/);
    if (reportAssessment) {
      return text.replace(trimmed, `Candidate ratings entered ${reportAssessment[1]} / ${reportAssessment[2]}; closed ${reportAssessment[3]}.`);
    }
    const reportWip = trimmed.match(/^当前\s+(\d+)\s*\/\s*限制\s+(\d+|未设置)$/);
    if (reportWip) {
      return text.replace(trimmed, `Current ${reportWip[1]} / limit ${reportWip[2] === "未设置" ? "not set" : reportWip[2]}`);
    }
    const currentTemplate = trimmed.match(/^当前模板：(.*) · (.*) · 参数 schema (.*)$/);
    if (currentTemplate) {
      const jql = currentTemplate[2] === "无模板 JQL" ? "No template JQL" : currentTemplate[2];
      return text.replace(trimmed, `Current template: ${currentTemplate[1]} · ${jql} · Parameter schema ${currentTemplate[3]}`);
    }
    const builtInSuffix = trimmed.match(/^(.*) · 内置$/);
    if (builtInSuffix) return text.replace(trimmed, `${builtInSuffix[1]} · Built-in`);
    const itemCount = trimmed.match(/^(\d+)\s*个工作项$/);
    if (itemCount) return text.replace(trimmed, `${itemCount[1]} ${Number(itemCount[1]) === 1 ? "work item" : "work items"}`);
    const issueCount = trimmed.match(/^(\d+)\s*个问题$/);
    if (issueCount) return text.replace(trimmed, `${issueCount[1]} ${Number(issueCount[1]) === 1 ? "issue" : "issues"}`);
    const genericCount = trimmed.match(/^(\d+)\s*个$/);
    if (genericCount) return text.replace(trimmed, `${genericCount[1]} items`);
    const countSuffix = trimmed.match(/^(\d+)\s*个(.+)$/);
    if (countSuffix && translations[countSuffix[2]]) {
      return text.replace(trimmed, `${countSuffix[1]} ${translations[countSuffix[2]].toLowerCase()}`);
    }
    return text;
  }

  function createController(options = {}) {
    const document = options.document || (typeof window !== "undefined" ? window.document : null);
    if (!document) throw new Error("A document is required to initialize JiraFlow language controls.");
    let storage = options.storage;
    if (!storage) {
      try { storage = window.localStorage; } catch { storage = null; }
    }
    const observers = options.MutationObserver || document.defaultView?.MutationObserver || globalThis.MutationObserver;
    const originalText = new WeakMap();
    const renderedText = new WeakMap();
    const originalAttributes = new WeakMap();
    const renderedAttributes = new WeakMap();
    const translatableAttributes = ["title", "aria-label", "placeholder", "alt"];
    const userAuthoredContent = ".issue-row-summary, .detail-title, .comment-body, .description-editor, #editRiskStatement, #editObjectiveEvidence, #editVerificationMethod, #editClosureEvidence, #editTraceLinks";
    let language = "zh-CN";
    let observer = null;

    function safeGet(key) {
      try { return storage?.getItem(key) || ""; } catch { return ""; }
    }
    function safeSet(key, value) {
      try { storage?.setItem(key, value); } catch { /* Storage can be disabled by the host. */ }
    }
    function setAttributeText(element, name, value) {
      let values = originalAttributes.get(element);
      if (!values) {
        values = new Map();
        originalAttributes.set(element, values);
      }
      let rendered = renderedAttributes.get(element);
      if (!rendered) {
        rendered = new Map();
        renderedAttributes.set(element, rendered);
      }
      const current = element.getAttribute(name);
      if (rendered.has(name) && current !== rendered.get(name)) values.set(name, current);
      if (!values.has(name)) values.set(name, current);
      const source = values.get(name) || "";
      const next = language === "en" ? translateText(source) : source;
      rendered.set(name, next);
      if (current !== next) element.setAttribute(name, next);
    }
    function visit(node) {
      if (node.nodeType === 3) {
        if (!node.parentElement?.closest?.(`#languageToggle, ${userAuthoredContent}`)) {
          const current = node.nodeValue || "";
          if (renderedText.has(node) && current !== renderedText.get(node)) originalText.set(node, current);
          if (!originalText.has(node)) originalText.set(node, current);
          const source = originalText.get(node);
          const next = language === "en" ? translateText(source) : source;
          renderedText.set(node, next);
          if (current !== next) node.nodeValue = next;
        }
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
      if (node.nodeType === 1 && node.id !== "languageToggle") {
        translatableAttributes.forEach(name => {
          if (node.hasAttribute(name)) setAttributeText(node, name, node.getAttribute(name));
        });
      }
      Array.from(node.childNodes || []).forEach(visit);
    }
    function updateButton() {
      const button = document.getElementById("languageToggle");
      if (!button) return;
      button.textContent = language === "en" ? "中" : "EN";
      button.title = language === "en" ? "Switch to Chinese" : "切换到英文";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(language === "en"));
    }
    function setLanguage(value, persist = true) {
      language = value === "en" ? "en" : "zh-CN";
      document.documentElement.lang = language;
      if (document.body) document.body.dataset.language = language;
      visit(document.body || document.documentElement);
      updateButton();
      if (persist) safeSet("jiraflow-language", language);
      return language;
    }
    function start() {
      const saved = safeGet("jiraflow-language");
      if (observers && !observer && document.body) {
        observer = new observers(records => {
          for (const record of records) {
            if (record.type === "characterData") {
              visit(record.target);
            } else if (record.type === "attributes") {
              visit(record.target);
            } else {
              record.addedNodes.forEach(visit);
            }
          }
        });
        observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: translatableAttributes});
      }
      return setLanguage(saved === "en" ? "en" : "zh-CN", false);
    }
    return {
      start,
      setLanguage,
      toggle: () => setLanguage(language === "en" ? "zh-CN" : "en"),
      get language() { return language; },
      translateText
    };
  }

  return {translations, translateText, createController};
});
