/* FileAnalyst language layer for the JEAuditFlow 6.3 workspace.
 *
 * FileAnalyst is mounted as an independent client, so the parent workbench's
 * language observer cannot see its DOM. This small local layer keeps source
 * data untouched while translating the Polarion-style chrome and common
 * status labels in place. It also watches newly rendered views and dialogs.
 */
(function () {
  "use strict";

  const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
  const TEXT_NODES = 4;
  const attributes = ["aria-label", "placeholder", "title", "alt"];
  const textSource = new WeakMap();
  const attributeSource = new WeakMap();
  const dictionary = Object.freeze({
    "Home": "主页", "Dashboard": "仪表板", "Requirements": "需求", "Design": "设计",
    "Risks": "风险", "Planning": "计划", "Development": "开发", "Testing": "测试",
    "Maintenance": "维护", "Work Items": "工作项", "Tree": "树视图", "Matrix": "矩阵",
    "Glossary": "术语表", "Traceability": "追溯", "Baselines": "基线", "Administration": "管理",
    "Requirements 6.5.0": "需求 6.5.0",
    "AuditFlow": "AuditFlow", "FileAnalyst": "FileAnalyst",
    "FileAnalyst 6.5.0 | Controlled Engineering Workspace": "FileAnalyst 6.5.0 | 受控工程工作区",
    "Select an authorized project": "选择有权限的项目", "Open project": "打开项目",
    "AuditFlow project": "AuditFlow 项目", "No authorized projects": "没有可访问的项目",
    "Ask an AuditFlow administrator to grant project access.": "请联系 AuditFlow 管理员授予项目访问权限。",
    "Search": "搜索", "Create work item": "创建工作项", "Create document page": "创建文档页面",
    "New Page": "新建页面", "Work Item": "工作项", "New": "新建", "Create": "创建",
    "Refresh": "刷新", "Back to AuditFlow": "返回 AuditFlow", "connected": "已连接",
    "Authenticated AuditFlow session": "已认证的 AuditFlow 会话", "Project Dashboard": "项目仪表板",
    "Project Dashboard": "项目仪表板", "Create Baseline": "创建基线", "CURRENT RELEASE": "当前版本",
    "Controlled ASPICE workspace": "受控 ASPICE 工作区", "CURRENT ITERATION": "当前迭代",
    "Evidence readiness": "证据就绪度", "Done": "完成", "Target: 100%": "目标：100%",
    "Ideal progress": "理想进度", "Evidence ready": "证据就绪", "Items completed": "已完成工作项",
    "Week 1": "第 1 周", "Week 2": "第 2 周", "Week 3": "第 3 周", "Week 4": "第 4 周",
    "Week 5": "第 5 周", "Today": "今天", "Planned items by status": "按状态统计的计划项",
    "Assessment preparation": "审核准备", "Candidate signals only; formal ratings remain with the assessor.": "仅显示候选信号；正式评级由审核员确认。",
    "Project scope is defined": "项目范围已定义", "Direct evidence is required for ratings": "评级需要直接证据",
    "Corroborating and index-only records remain clearly labeled": "佐证和仅索引记录会保持明确标识",
    "Recent activity": "最近活动", "Versioned project changes": "有版本记录的项目变更", "View all ›": "查看全部 ›",
    "Purpose": "目的", "Output": "输出", "Process": "过程", "Test Coverage": "测试覆盖率",
    "System Requirements Analysis": "系统需求分析", "Software Architectural Design": "软件架构设计",
    "Software Unit Verification": "软件单元验证", "Problem Resolution Management": "问题解决管理",
    "Change Request Management": "变更请求管理", "Evidence available": "已有证据", "Needs evidence": "需要证据",
    "Title Status Updated Updated By": "标题 状态 更新时间 更新人", "Process Work Items Direct Evidence Status": "过程 工作项 直接证据 状态",
    "The project output is organized as controlled documents and linked work items. Each row below opens the corresponding FileAnalyst workflow.": "项目输出由受控文档和关联工作项组成。下面每一行都会打开对应的 FileAnalyst 工作流。",
    "The project output is organized as controlled documents and linked work items. Each row below opens the corresponding FileAnalyst workflow.": "项目输出由受控文档和关联工作项组成。下面每一行都会打开对应的 FileAnalyst 工作流。",
    "On this page": "本页目录", "Expand Tools": "展开工具", "Open": "打开", "Properties": "属性",
    "History": "历史", "Discussion": "讨论", "Attachments": "附件", "Linked Work Items": "关联工作项",
    "No files attached. Add measurements, review records or source documents here.": "尚未附加文件。可在此添加测量结果、评审记录或源文档。",
    "No links yet. A link is navigation evidence; it does not replace direct process evidence.": "尚无关联。关联用于导航和溯源，不能替代过程直接证据。",
    "Core properties": "核心属性", "Type": "类型", "Title": "标题", "Description": "描述",
    "Status": "状态", "Owner": "负责人", "Evidence role": "证据角色", "ASIL / Level": "ASIL / 等级",
    "Glossary term": "术语", "Verification criteria": "验证准则", "Save": "保存", "Cancel": "取消",
    "Close": "关闭", "Delete": "删除", "Edit": "编辑", "Review": "评审", "Review reason": "评审理由",
    "Create trace link": "创建追溯关联", "Create baseline": "创建基线", "Create test run": "创建测试运行",
    "Create a controlled page": "创建受控页面", "Create work item": "创建工作项", "No work items found": "未找到工作项",
    "Change the query or create a new item.": "请调整查询条件或创建新工作项。", "items found": "项匹配",
    "Last updated records first": "最近更新的记录优先", "All types": "全部类型", "Query": "查询",
    "All": "全部", "My open items": "我的开放工作项", "Needs review": "需要评审",
    "Approved": "已批准", "In Review": "评审中", "Draft": "草稿", "Ready for Test": "待测试",
    "Open": "开放", "Proposed": "已提议", "Closed": "已关闭", "Pending review": "待评审",
    "Valid": "有效", "Suspect": "可疑", "Rejected": "已拒绝", "Candidate": "候选", "Unreviewed": "未评审",
    "Direct": "直接", "Corroborating": "佐证", "Index-only": "仅索引", "System Requirement": "系统需求",
    "Software Design": "软件设计", "Software Test Case": "软件测试用例", "System Test Case": "系统测试用例",
    "Problem Report": "问题报告", "Change Request": "变更请求", "Verified by": "由……验证",
    "Administration": "管理", "Current session": "当前会话", "Project configuration": "项目配置",
    "Formal scope": "正式范围", "Project-defined ASPICE processes": "项目定义的 ASPICE 过程",
    "Storage": "存储", "Review policy": "评审策略", "Human approval required for formal evidence": "正式证据需要人工批准",
    "WORK ITEM ADMINISTRATION": "工作项管理", "Properties and presentation": "属性与展示",
    "Configure field labels, selectable values and the sections shown in every work item. Changes are versioned per project.": "配置字段标签、可选值和工作项中的展示分组。每次修改都会按项目记录版本。",
    "Enabled": "启用", "Field label": "字段标签", "Values": "可选值", "Group": "分组",
    "Presentation sections": "展示分组", "Workflow statuses": "工作流状态", "Relation types": "关联类型",
    "Workflow transitions": "工作流转换", "Save Configuration": "保存配置", "Transition format:": "转换格式：",
    "Relation format:": "关联格式：", "Project context changed": "项目上下文已切换", "Work item created": "工作项已创建",
    "Page created": "页面已创建", "File attached": "文件已附加", "Page saved as a new version": "页面已保存为新版本",
    "Tools remain in the current project pane": "工具面板已保留在当前项目页右侧",
    "Baseline frozen": "基线已冻结", "Trace link created": "追溯关联已创建", "Test result saved": "测试结果已保存",
    "Comment thread added": "评论线程已添加", "Structure lock acquired for 90 seconds": "已获取 90 秒结构锁",
    "Structure lock released": "结构锁已释放", "No structural lock": "没有结构锁", "you": "你",
    "The project output is": "项目输出为", "controlled documents and linked work items": "受控文档和关联工作项",
    "The project output is organized as controlled documents and linked work items.": "项目输出由受控文档和关联工作项组成。",
    "FileAnalyst cannot connect": "FileAnalyst 无法连接", "FileAnalyst could not connect.": "FileAnalyst 无法连接。",
    "FileAnalyst could not load this workspace.": "FileAnalyst 无法加载此工作区。",
    "FileAnalyst UI failed to load": "FileAnalyst 界面加载失败",
    "Sign in to AuditFlow first.": "请先登录 AuditFlow。",
    "Your AuditFlow session has expired. Please sign in again.": "AuditFlow 登录已失效，请重新登录。",
    "Too many sign-in attempts. Try again in 15 minutes.": "登录尝试过多，请 15 分钟后重试。",
    "Enter a valid email address.": "请输入有效邮箱。",
    "Display name must be at least 2 characters.": "姓名至少需要 2 个字符。",
    "Password must be 10-200 characters.": "密码长度需为 10-200 个字符。",
    "Incorrect email or password.": "邮箱或密码不正确。",
    "Sign in to JEAuditFlow and reopen FileAnalyst.": "请登录 JEAuditFlow 后重新打开 FileAnalyst。",
    "Sign in to JEAuditFlow and reopen FileAnalyst. If the problem persists, check": "请登录 JEAuditFlow 后重新打开 FileAnalyst。如果问题仍然存在，请检查",
    "The application module did not render within": "应用模块未能在规定时间内完成渲染：",
    "This usually indicates a script load failure or network issue.": "这通常表示脚本加载失败或网络异常。",
    "Chinese": "中文", "English": "English", "Switch language": "切换语言",
    "Switch to Chinese": "切换到中文", "Switch to English": "切换到英文"
  });

  const phrases = Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length);
  const reverse = new Map(phrases.map(([en, zh]) => [zh, en]));
  const sourceText = value => String(value == null ? "" : value);
  const hasZh = value => CJK.test(String(value || ""));

  function languageFromWorkspace() {
    const requested = new URLSearchParams(window.location.search).get("lang");
    if (requested === "zh" || requested === "zh-CN") return "zh-CN";
    if (requested === "en") return "en";
    try {
      const openerLanguage = window.opener?.AuditFlowI18n?.isEnglish?.();
      if (typeof openerLanguage === "boolean") return openerLanguage ? "en" : "zh-CN";
    } catch (_) {}
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith("auditflow-ai-workspace-v1"));
      for (const key of keys) {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (value?.settings?.language === "zh-CN") return "zh-CN";
        if (value?.settings?.language === "en") return "en";
      }
    } catch (_) {}
    // AuditFlow workspaces default to the English chrome. The user can choose
    // Chinese explicitly through the toggle or `?lang=zh-CN`.
    return "en";
  }

  let language = languageFromWorkspace();
  let observer = null;
  let applying = false;

  function translate(value) {
    const source = sourceText(value);
    if (!source.trim()) return source;
    if (language === "zh-CN") {
      let output = source;
      for (const [en, zh] of phrases) output = output.split(en).join(zh);
      return output;
    }
    let output = source;
    for (const [zh, en] of reverse.entries()) output = output.split(zh).join(en);
    return output;
  }

  // Newly rendered nodes can be created while Chinese is active. Canonicalise
  // those nodes before caching them so a later switch back to English cannot
  // preserve a partially translated phrase such as "系统需求s Analysis".
  function canonicalEnglish(value) {
    let output = sourceText(value);
    for (const [zh, en] of reverse.entries()) output = output.split(zh).join(en);
    return output;
  }

  function apply(root = document.body) {
    if (!root || applying) return;
    applying = true;
    try {
      const walker = document.createTreeWalker(root, TEXT_NODES, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest("script, style, textarea, [data-fileanalyst-i18n-skip]")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (!sourceText(node.nodeValue).trim()) return;
        const source = textSource.get(node) ?? canonicalEnglish(node.nodeValue);
        textSource.set(node, source);
        const next = translate(source);
        if (node.nodeValue !== next) node.nodeValue = next;
      });
      const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [];
      elements.forEach(element => {
        if (element.closest?.("script, style, [data-fileanalyst-i18n-skip]")) return;
        attributes.forEach(name => {
          const value = element.getAttribute?.(name);
          if (!value) return;
          const source = attributeSource.get(element) || {};
          source[name] ??= canonicalEnglish(value);
          attributeSource.set(element, source);
          const next = translate(source[name]);
          if (value !== next) element.setAttribute(name, next);
        });
      });
      document.documentElement.lang = language === "en" ? "en" : "zh-CN";
      document.title = translate("FileAnalyst 6.5.0 | Controlled Engineering Workspace");
    } finally {
      applying = false;
    }
  }

  function setLanguage(next, persist = true) {
    language = next === "zh-CN" || next === "zh" ? "zh-CN" : "en";
    if (persist) localStorage.setItem("auditflow-fileanalyst-language", language);
    apply(document.body);
    const button = document.querySelector("[data-fileanalyst-language]");
    if (button) {
      // Keep the target-language control free of Chinese glyphs in English mode.
      button.textContent = language === "en" ? "Chinese" : "English";
      button.title = language === "en" ? "Switch to Chinese" : "切换到英文";
      button.setAttribute("aria-label", language === "en" ? "Switch to Chinese" : "切换到英文");
    }
  }

  function toggle() { setLanguage(language === "en" ? "zh-CN" : "en"); }

  function start() {
    const stored = localStorage.getItem("auditflow-fileanalyst-language");
    if (!new URLSearchParams(window.location.search).has("lang") && (stored === "en" || stored === "zh-CN")) language = stored;
    if (!observer) {
      observer = new MutationObserver(() => window.requestAnimationFrame(() => apply(document.body)));
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.addEventListener("click", event => {
        if (event.target.closest?.("[data-fileanalyst-language]")) { event.preventDefault(); toggle(); }
      }, true);
      window.addEventListener("storage", event => {
        if (!String(event.key || "").startsWith("auditflow-ai-workspace-v1")) return;
        try {
          const next = JSON.parse(event.newValue || "null")?.settings?.language;
          if (next === "en" || next === "zh-CN") setLanguage(next, false);
        } catch (_) {}
      });
    }
    apply(document.body);
    setLanguage(language, false);
  }

  window.FileAnalystI18n = { apply, setLanguage, toggle, translate, language: () => language, isEnglish: () => language === "en", start };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
}());
