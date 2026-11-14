import {
  createEmptyWorkspace, createLesson, createPage, createPost,
  createReadOnlyConfluenceAdapter, createSpace, exportWorkspace, importWorkspace,
  loadWorkspace, saveWorkspace, searchLessons, updateLesson, updatePage, updatePost
} from "./model.mjs";

const STRINGS = {
  zh: {
    subtitle: "空间、页面与经验知识库", local: "本地数据", import: "导入", export: "导出",
    newLesson: "新建经验", spaces: "空间", spaceSwitcher: "空间", activity: "活动",
    pagesView: "页面", postsView: "博客", lessonsView: "经验", activityView: "活动",
    chooseSpace: "选择空间", localOnly: "存储在此设备", count: "条内容", lessonCount: "条经验",
    createFirst: "在此页面登记第一条内容。", noMatch: "没有匹配的内容。",
    choose: "选择页面、博客或经验查看详情，或创建新内容。", newEntry: "新建经验", editEntry: "编辑经验",
    title: "标题", status: "状态", context: "背景", problem: "问题", lesson: "经验教训",
    action: "改进措施", owner: "责任人", tags: "标签", projects: "关联项目", processes: "关联过程",
    findings: "关联发现", evidence: "关联证据", page: "页面", save: "保存", cancel: "取消",
    open: "打开", progress: "处理中", resolved: "已关闭", name: "名称", parentPage: "上级页面",
    create: "创建", newSpace: "新建空间", newPage: "新建页面", newPost: "新建博客",
    created: "经验已保存到本地。", updated: "经验已更新。", spaceCreated: "空间已创建。",
    pageCreated: "页面已创建。", postCreated: "博客已创建。", postUpdated: "博客已更新。",
    pageUpdated: "页面已更新。", importSuccess: "已导入本地工作区。", exportSuccess: "JSON 文件已导出。",
    invalidImport: "导入文件无效，当前数据未更改。", required: "请填写标题。", selectPage: "请先选择一个页面。",
    linkHint: "使用逗号分隔多个关联项；内容仅保存在本设备。", emptyTitle: "LessonLearn",
    emptyHint: "本地维护可追溯的页面、博客和经验教训，并关联项目、过程、发现和证据。",
    noPage: "此空间还没有页面。", importConfirm: "导入会替换此设备上的 LessonLearn 数据。是否继续？",
    importFailed: "导入失败", pageSearch: "搜索页面、博客、经验、项目、过程或证据",
    generic: "未命名页面", statusLine: "更新于", pageOptions: "页面选项", noActivity: "暂无活动。",
    published: "已发布", draft: "草稿", archived: "已归档", content: "正文", excerpt: "摘要",
    author: "作者", history: "版本历史", restore: "恢复此版本", edit: "编辑", publish: "发布",
    archive: "归档", pageSaved: "页面已保存。", postSaved: "博客已保存。", restoreSaved: "已恢复为所选版本。",
    version: "版本", savedAt: "保存于", allContent: "全部内容", noHistory: "暂无历史版本。",
    blog: "博客", lessons: "经验", page: "页面", searchHits: "搜索结果"
  },
  en: {
    subtitle: "Spaces, pages and reusable audit knowledge", local: "Local data", import: "Import", export: "Export",
    newLesson: "New lesson", spaces: "Spaces", spaceSwitcher: "Spaces", activity: "Activity",
    pagesView: "Pages", postsView: "Blog", lessonsView: "Lessons", activityView: "Activity",
    chooseSpace: "Choose a space", localOnly: "Stored on this device", count: "items", lessonCount: "lessons",
    createFirst: "Create the first item on this page.", noMatch: "No matching content.",
    choose: "Select a page, blog post or lesson to view it, or create new content.", newEntry: "New lesson",
    editEntry: "Edit lesson", title: "Title", status: "Status", context: "Context", problem: "Problem",
    lesson: "Lesson learned", action: "Improvement action", owner: "Owner", tags: "Tags",
    projects: "Linked projects", processes: "Linked processes", findings: "Linked findings",
    evidence: "Linked evidence", page: "Page", save: "Save", cancel: "Cancel", open: "Open",
    progress: "In progress", resolved: "Resolved", name: "Name", parentPage: "Parent page", create: "Create",
    newSpace: "New space", newPage: "New page", newPost: "New blog post", created: "Lesson saved locally.",
    updated: "Lesson updated.", spaceCreated: "Space created.", pageCreated: "Page created.",
    postCreated: "Blog post created.", postUpdated: "Blog post updated.", pageUpdated: "Page updated.",
    importSuccess: "Workspace imported locally.", exportSuccess: "JSON file exported.",
    invalidImport: "Invalid import. Current data was not changed.", required: "Enter a title.",
    selectPage: "Select a page first.", linkHint: "Separate multiple links with commas. Data stays on this device.",
    emptyTitle: "LessonLearn", emptyHint: "Maintain traceable pages, blog posts and lessons linked to projects, processes, findings and evidence.",
    noPage: "This space has no pages.", importConfirm: "Importing replaces LessonLearn data on this device. Continue?",
    importFailed: "Import failed", pageSearch: "Search pages, blog posts, lessons, projects, processes or evidence",
    generic: "Untitled page", statusLine: "Updated", pageOptions: "Page options", noActivity: "No activity yet.",
    published: "Published", draft: "Draft", archived: "Archived", content: "Content", excerpt: "Excerpt",
    author: "Author", history: "Version history", restore: "Restore this version", edit: "Edit",
    publish: "Publish", archive: "Archive", pageSaved: "Page saved.", postSaved: "Blog post saved.",
    restoreSaved: "Restored the selected version.", version: "Version", savedAt: "Saved",
    noHistory: "No history yet.", blog: "Blog", lessons: "Lessons", searchHits: "Search results", allContent: "All content"
  }
};

const root = document.documentElement;
const byId = id => document.getElementById(id);
const escapeText = value => String(value ?? "");
let language = localStorage.getItem("jeauditflow.lessonlearn.language") === "en" ? "en" : "zh";
let workspace;
let selectedPageId = "";
let selectedLessonId = "";
let selectedPostId = "";
let editing = false;
let editingKind = "";
let toastTimer;
let adapter = null;
let activeView = "lessons";

try {
  workspace = loadWorkspace();
} catch (error) {
  workspace = createEmptyWorkspace();
  queueMicrotask(() => showToast(error.message, true));
}

function text(key) { return STRINGS[language][key] || key; }
function allPages() {
  return workspace.spaces.flatMap(space => space.pages.map(page => ({ ...page, spaceId: space.id, spaceName: space.name })));
}
function currentPage() { return allPages().find(page => page.id === selectedPageId) || null; }
function currentSpace() { return workspace.spaces.find(space => space.id === currentPage()?.spaceId) || workspace.spaces[0] || null; }
function statusText(status) { return text(status === "in-progress" ? "progress" : status); }
function showToast(message, isError = false) {
  const node = byId("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 2800);
}
function node(tag, { className = "", textContent = "", type, title, ariaLabel } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = escapeText(textContent);
  if (type) element.type = type;
  if (title) element.title = title;
  if (ariaLabel) element.setAttribute("aria-label", ariaLabel);
  return element;
}
function commit(next, message) {
  try {
    workspace = saveWorkspace(next);
    render();
    if (message) showToast(message);
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  }
}
function applyTheme() {
  root.dataset.theme = localStorage.getItem("jeauditflow.lessonlearn.theme") === "dark" ? "dark" : "light";
  const toggle = byId("theme-toggle");
  if (toggle) toggle.setAttribute("aria-label", language === "zh" ? "切换明暗模式" : "Toggle light or dark mode");
}
function applyLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach(item => { item.textContent = text(item.dataset.i18n); });
  byId("search").placeholder = text("pageSearch");
  byId("language-toggle").title = language === "zh" ? "Switch to English" : "切换到中文";
  byId("theme-toggle").title = language === "zh" ? "切换明暗模式" : "Toggle light or dark mode";
  render();
}
function renderTree() {
  const tree = byId("page-tree");
  tree.replaceChildren();
  workspace.spaces.forEach(space => {
    const group = node("div", { className: "tree-space" });
    const heading = node("div", { className: "tree-space-title", textContent: space.name });
    heading.addEventListener("click", () => {
      selectedPageId = space.pages[0]?.id || "";
      selectedLessonId = "";
      selectedPostId = "";
      activeView = "pages";
      render();
    });
    group.append(heading);
    const pagesByParent = new Map();
    space.pages.forEach(page => {
      const parent = page.parentId || "";
      if (!pagesByParent.has(parent)) pagesByParent.set(parent, []);
      pagesByParent.get(parent).push(page);
    });
    const appendPages = (parentId = "", depth = 0) => {
      (pagesByParent.get(parentId) || []).forEach(page => {
        const button = node("button", {
          className: `tree-page${selectedPageId === page.id ? " active" : ""}`,
          textContent: page.title, type: "button"
        });
        button.style.paddingLeft = `${27 + Math.min(depth, 5) * 15}px`;
        button.addEventListener("click", () => {
          selectedPageId = page.id;
          selectedLessonId = "";
          selectedPostId = "";
          activeView = "pages";
          editing = false;
          render();
        });
        group.append(button);
        appendPages(page.id, depth + 1);
      });
    };
    appendPages();
    if (!space.pages.length) group.append(node("p", { className: "empty-list", textContent: text("noPage") }));
    tree.append(group);
  });
}
function pageLessons(pageId = "") {
  return workspace.lessons.filter(lesson => !pageId || lesson.pageId === pageId);
}
function pagePosts(pageId = "") {
  return workspace.posts.filter(post => !pageId || post.pageId === pageId);
}
function matches(value, query) { return String(value || "").toLocaleLowerCase().includes(query); }
function searchPages(query, pageId = "") {
  const needle = String(query || "").trim().toLocaleLowerCase();
  return allPages().filter(page => (!pageId || page.id === pageId) && (!needle ||
    [page.title, page.content, page.status, page.labels.join(" "), page.spaceName].some(value => matches(value, needle))));
}
function searchPosts(query, pageId = "") {
  const needle = String(query || "").trim().toLocaleLowerCase();
  return pagePosts(pageId).filter(post => !needle ||
    [post.title, post.excerpt, post.content, post.author, post.status, post.labels.join(" ")].some(value => matches(value, needle)));
}
function searchAll(query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return [];
  return [
    ...searchPages(needle).map(item => ({ kind: "page", item })),
    ...searchPosts(needle).map(item => ({ kind: "post", item })),
    ...searchLessons(workspace, needle).map(item => ({ kind: "lesson", item }))
  ];
}
function currentActivity() {
  const events = [];
  allPages().forEach(page => events.push({ kind: "page", title: page.title, date: page.updatedAt, pageId: page.id }));
  workspace.posts.forEach(post => events.push({ kind: "post", title: post.title, date: post.updatedAt, pageId: post.pageId }));
  workspace.lessons.forEach(lesson => events.push({ kind: "lesson", title: lesson.title, date: lesson.updatedAt, pageId: lesson.pageId }));
  return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function renderList() {
  const page = currentPage();
  const query = byId("search").value;
  const container = byId("lesson-list");
  container.replaceChildren();
  byId("selected-page-title").textContent = page?.title || text("allContent");
  let count = 0;
  if (activeView === "activity") {
    const activity = currentActivity();
    byId("lesson-count").textContent = `${activity.length} ${text("count")}`;
    if (!activity.length) container.append(node("div", { className: "empty-list", textContent: text("noActivity") }));
    activity.slice(0, 60).forEach(item => {
      const row = node("article", { className: "activity-row" });
      row.append(node("span", { className: "activity-mark", textContent: "•" }));
      const content = node("div");
      content.append(node("strong", { textContent: item.title }), node("small", { textContent: `${item.kind} · ${new Date(item.date).toLocaleString()}` }));
      row.append(content);
      container.append(row);
    });
    return;
  }
  if (query.trim()) {
    const results = searchAll(query);
    count = results.length;
    byId("lesson-count").textContent = `${count} ${text("searchHits")}`;
    if (!results.length) container.append(node("div", { className: "empty-list", textContent: text("noMatch") }));
    results.forEach(({ kind, item }) => {
      const row = node("button", { className: "lesson-row", type: "button" });
      row.append(node("strong", { textContent: item.title }));
      row.append(node("small", { textContent: `${kind} · ${new Date(item.updatedAt).toLocaleDateString()}` }));
      row.addEventListener("click", () => selectItem(kind, item));
      container.append(row);
    });
    return;
  }
  if (activeView === "pages") {
    const items = searchPages("", page?.id || "");
    count = items.length;
    byId("lesson-count").textContent = `${count} ${text("count")}`;
    items.forEach(item => renderContentRow(container, "page", item));
  } else if (activeView === "posts") {
    const items = searchPosts("", page?.id || "");
    count = items.length;
    byId("lesson-count").textContent = `${count} ${text("count")}`;
    items.forEach(item => renderContentRow(container, "post", item));
  } else {
    const items = searchLessons(workspace, "", page ? { pageId: page.id } : {});
    count = items.length;
    byId("lesson-count").textContent = `${count} ${text("lessonCount")}`;
    if (!items.length) container.append(node("div", { className: "empty-list", textContent: text("createFirst") }));
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(lesson => {
      const button = node("button", { className: `lesson-row${lesson.id === selectedLessonId ? " active" : ""}`, type: "button" });
      button.append(node("strong", { textContent: lesson.title }));
      const meta = node("small");
      meta.append(node("i", { className: `status-dot ${lesson.status}` }), document.createTextNode(`${statusText(lesson.status)} · ${new Date(lesson.updatedAt).toLocaleDateString()}`));
      button.append(meta);
      button.addEventListener("click", () => { selectItem("lesson", lesson); });
      container.append(button);
    });
  }
  if (!count && (activeView === "pages" || activeView === "posts")) container.append(node("div", { className: "empty-list", textContent: text("createFirst") }));
}
function renderContentRow(container, kind, item) {
  const row = node("button", { className: `lesson-row${(kind === "post" ? item.id === selectedPostId : item.id === selectedPageId) ? " active" : ""}`, type: "button" });
  row.append(node("strong", { textContent: item.title }));
  const status = kind === "page" ? item.status : item.status;
  row.append(node("small", { textContent: `${kind === "page" ? text("page") : text("blog")} · ${statusText(status)} · ${new Date(item.updatedAt).toLocaleDateString()}` }));
  row.addEventListener("click", () => selectItem(kind, item));
  container.append(row);
}
function selectItem(kind, item) {
  selectedLessonId = kind === "lesson" ? item.id : "";
  selectedPostId = kind === "post" ? item.id : "";
  selectedPageId = item.pageId || item.id || selectedPageId;
  editing = false;
  editingKind = "";
  render();
}
function makeBlock(label, value) {
  const section = node("section", { className: "content-block" });
  section.append(node("h3", { textContent: label }), node("p", { textContent: value || "—" }));
  return section;
}
function makeRelationBlock(label, values, isTag = false) {
  const section = node("section", { className: "content-block" });
  section.append(node("h3", { textContent: label }));
  const list = node("div", { className: "relation-list" });
  (values || []).forEach(value => list.append(node("span", { className: isTag ? "tag-chip" : "relation-chip", textContent: value })));
  section.append(list.childNodes.length ? list : node("p", { textContent: "—" }));
  return section;
}
function actionButton(label, callback, className = "tool-button") {
  const button = node("button", { className, textContent: label, type: "button" });
  button.addEventListener("click", callback);
  return button;
}
function renderHistory(entries, kind, current) {
  const section = node("section", { className: "history-block content-block" });
  section.append(node("h3", { textContent: text("history") }));
  if (!entries?.length) {
    section.append(node("p", { textContent: text("noHistory") }));
    return section;
  }
  entries.slice(0, 20).forEach(entry => {
    const row = node("div", { className: "history-row" });
    const summary = node("div");
    summary.append(node("strong", { textContent: `${text("version")} ${entry.version} · ${entry.title || current.title}` }));
    summary.append(node("small", { textContent: `${entry.author || "AuditFlow"} · ${new Date(entry.savedAt).toLocaleString()}` }));
    row.append(summary);
    if (entry.version !== current.version) {
      row.append(actionButton(text("restore"), () => restoreVersion(kind, current, entry)));
    }
    section.append(row);
  });
  return section;
}
function restoreVersion(kind, current, entry) {
  try {
    const next = kind === "page"
      ? updatePage(workspace, current.id, { title: entry.title, content: entry.content, status: entry.status }, { author: "AuditFlow" })
      : updatePost(workspace, current.id, { title: entry.title, content: entry.content, status: entry.status }, { author: "AuditFlow" }).workspace;
    if (commit(next, text("restoreSaved"))) {
      editing = false;
      render();
    }
  } catch (error) { showToast(error.message, true); }
}
function renderDetail() {
  const pane = byId("detail-pane");
  pane.replaceChildren();
  const page = currentPage();
  const lesson = workspace.lessons.find(item => item.id === selectedLessonId);
  const post = workspace.posts.find(item => item.id === selectedPostId);
  if (editing) {
    pane.append(editingKind === "page" ? renderPageForm(page) : editingKind === "post" ? renderPostForm(post) : renderLessonForm(lesson));
    return;
  }
  if (post) {
    const header = node("header", { className: "detail-header" });
    const heading = node("div");
    heading.append(node("h2", { textContent: post.title }), node("p", { textContent: `${text("blog")} · ${statusText(post.status)} · ${text("statusLine")} ${new Date(post.updatedAt).toLocaleString()}` }));
    const actions = node("div", { className: "detail-actions" });
    actions.append(actionButton(text("edit"), () => { editingKind = "post"; editing = true; render(); }), actionButton(post.status === "published" ? text("archive") : text("publish"), () => {
      const next = updatePost(workspace, post.id, { status: post.status === "published" ? "draft" : "published" }).workspace;
      commit(next, text("postSaved"));
    }));
    header.append(heading, actions);
    const body = node("div", { className: "detail-body" });
    body.append(makeBlock(text("excerpt"), post.excerpt), makeBlock(text("content"), post.content), makeRelationBlock(text("tags"), post.labels, true));
    body.append(renderHistory(post.history, "post", post));
    pane.append(header, body);
    return;
  }
  if (lesson) {
    const header = node("header", { className: "detail-header" });
    const heading = node("div");
    heading.append(node("h2", { textContent: lesson.title }), node("p", { textContent: `${text("lessonsView")} · ${text("page")}: ${allPages().find(item => item.id === lesson.pageId)?.title || text("generic")} · ${text("statusLine")} ${new Date(lesson.updatedAt).toLocaleString()}` }));
    header.append(heading, node("span", { className: "status-label", textContent: statusText(lesson.status) }), actionButton(text("edit"), () => { editingKind = "lesson"; editing = true; render(); }));
    const body = node("div", { className: "detail-body" });
    body.append(makeBlock(text("context"), lesson.context), makeBlock(text("problem"), lesson.problem), makeBlock(text("lesson"), lesson.lesson), makeBlock(text("action"), lesson.action), makeBlock(text("owner"), lesson.owner), makeRelationBlock(text("tags"), lesson.tags, true));
    [["projects", "projects"], ["processes", "processes"], ["findings", "findings"], ["evidence", "evidence"]].forEach(([field, label]) => body.append(makeRelationBlock(text(label), lesson.links[field])));
    pane.append(header, body);
    return;
  }
  if (page) {
    const header = node("header", { className: "detail-header" });
    const heading = node("div");
    heading.append(node("h2", { textContent: page.title }), node("p", { textContent: `${page.spaceName} · ${statusText(page.status)} · ${text("statusLine")} ${new Date(page.updatedAt).toLocaleString()}` }));
    const actions = node("div", { className: "detail-actions" });
    actions.append(actionButton(text("edit"), () => { editingKind = "page"; editing = true; render(); }), actionButton(page.status === "published" ? text("archive") : text("publish"), () => {
      const next = updatePage(workspace, page.id, { status: page.status === "published" ? "archived" : "published" });
      commit(next, text("pageSaved"));
    }));
    header.append(heading, actions);
    const body = node("div", { className: "detail-body" });
    body.append(makeBlock(text("content"), page.content), makeRelationBlock(text("tags"), page.labels, true));
    body.append(renderHistory(page.history, "page", page));
    pane.append(header, body);
    return;
  }
  const empty = node("div", { className: "detail-empty" });
  empty.append(node("strong", { textContent: text("emptyTitle") }), node("p", { textContent: text("choose") }));
  pane.append(empty);
}
function formField(form, name, label, value = "", { multiline = false, full = false, options = null, placeholder = "" } = {}) {
  const wrap = node("div", { className: `field${full ? " full" : ""}` });
  const id = `lesson-field-${name.replaceAll(".", "-")}`;
  const labelNode = node("label", { textContent: label });
  labelNode.htmlFor = id;
  let control;
  if (options) {
    control = node("select");
    options.forEach(([optionValue, optionLabel]) => {
      const option = node("option", { textContent: optionLabel });
      option.value = optionValue;
      control.append(option);
    });
    control.value = value;
  } else if (multiline) {
    control = node("textarea");
    control.value = value;
  } else {
    control = node("input");
    control.value = value;
  }
  control.id = id;
  control.name = name;
  control.placeholder = placeholder;
  wrap.append(labelNode, control);
  form.querySelector(".field-grid").append(wrap);
}
function formShell(title, onSubmit) {
  const form = node("form", { className: "lesson-form" });
  const top = node("div", { className: "form-top" });
  top.append(node("h2", { textContent: title }));
  const actions = node("div", { className: "form-actions" });
  actions.append(actionButton(text("cancel"), () => { editing = false; render(); }), node("button", { className: "primary-button", textContent: text("save"), type: "submit" }));
  top.append(actions);
  form.append(top, node("div", { className: "field-grid" }));
  form.addEventListener("submit", event => { event.preventDefault(); onSubmit(new FormData(form)); });
  return form;
}
function renderPageForm(page) {
  const form = formShell(page ? text("edit") : text("newPage"), data => {
    const input = { title: data.get("title"), content: data.get("content"), status: data.get("status"), labels: String(data.get("labels") || "").split(",") };
    try {
      let next;
      let pageId = page?.id || "";
      if (page) {
        next = updatePage(workspace, page.id, input);
      } else {
        const space = currentSpace();
        if (!space) throw new TypeError(text("selectPage"));
        next = createPage(workspace, space.id, input.title);
        pageId = next.spaces.find(item => item.id === space.id)?.pages.at(-1)?.id || "";
        if (!pageId) throw new TypeError(text("selectPage"));
        next = updatePage(next, pageId, input);
      }
      if (commit(next, page ? text("pageUpdated") : text("pageCreated"))) { selectedPageId = pageId; editing = false; }
    } catch (error) { showToast(error.message, true); }
  });
  formField(form, "title", text("title"), page?.title || "", { full: true });
  formField(form, "status", text("status"), page?.status || "draft", { options: [["draft", text("draft")], ["published", text("published")], ["archived", text("archived")]] });
  formField(form, "labels", text("tags"), page?.labels.join(", ") || "", { placeholder: "architecture, release" });
  formField(form, "content", text("content"), page?.content || "", { multiline: true, full: true });
  return form;
}
function renderPostForm(post) {
  const form = formShell(post ? text("edit") : text("newPost"), data => {
    const input = { pageId: data.get("pageId"), title: data.get("title"), excerpt: data.get("excerpt"), content: data.get("content"), author: data.get("author"), status: data.get("status"), labels: String(data.get("labels") || "").split(",") };
    try {
      const result = post ? updatePost(workspace, post.id, input) : createPost(workspace, input);
      if (commit(post ? result.workspace : result.workspace, post ? text("postUpdated") : text("postCreated"))) {
        selectedPostId = post?.id || result.post.id;
        selectedPageId = input.pageId;
        editing = false;
      }
    } catch (error) { showToast(error.message, true); }
  });
  formField(form, "pageId", text("page"), post?.pageId || selectedPageId, { options: allPages().map(item => [item.id, `${item.spaceName} / ${item.title}`]) });
  formField(form, "title", text("title"), post?.title || "", { full: true });
  formField(form, "status", text("status"), post?.status || "draft", { options: [["draft", text("draft")], ["published", text("published")]] });
  formField(form, "author", text("author"), post?.author || "");
  formField(form, "labels", text("tags"), post?.labels.join(", ") || "", { placeholder: "release, process" });
  formField(form, "excerpt", text("excerpt"), post?.excerpt || "", { multiline: true, full: true });
  formField(form, "content", text("content"), post?.content || "", { multiline: true, full: true });
  return form;
}
function renderLessonForm(lesson) {
  const form = formShell(lesson ? text("editEntry") : text("newEntry"), data => {
    const links = Object.fromEntries(["projects", "processes", "findings", "evidence"].map(key => [key, String(data.get(`links.${key}`) || "").split(",")]));
    const input = { title: data.get("title"), status: data.get("status"), pageId: data.get("pageId"), context: data.get("context"), problem: data.get("problem"), lesson: data.get("lesson"), action: data.get("action"), owner: data.get("owner"), tags: String(data.get("tags") || "").split(","), links };
    if (!String(input.title || "").trim()) { showToast(text("required"), true); return; }
    try {
      const result = lesson ? updateLesson(workspace, lesson.id, input) : createLesson(workspace, input);
      if (commit(result.workspace, lesson ? text("updated") : text("created"))) {
        selectedLessonId = result.lesson.id;
        selectedPageId = result.lesson.pageId;
        editing = false;
      }
    } catch (error) { showToast(error.message, true); }
  });
  const pageOptions = allPages().map(page => [page.id, `${page.spaceName} / ${page.title}`]);
  formField(form, "title", text("title"), lesson?.title || "", { full: true });
  formField(form, "status", text("status"), lesson?.status || "open", { options: [["open", language === "zh" ? "开放" : "Open"], ["in-progress", text("progress")], ["resolved", text("resolved")]] });
  formField(form, "pageId", text("page"), lesson?.pageId || selectedPageId || pageOptions[0]?.[0] || "", { options: pageOptions });
  formField(form, "context", text("context"), lesson?.context || "", { multiline: true, full: true });
  formField(form, "problem", text("problem"), lesson?.problem || "", { multiline: true, full: true });
  formField(form, "lesson", text("lesson"), lesson?.lesson || "", { multiline: true, full: true });
  formField(form, "action", text("action"), lesson?.action || "", { multiline: true, full: true });
  formField(form, "owner", text("owner"), lesson?.owner || "");
  formField(form, "tags", text("tags"), lesson?.tags.join(", ") || "", { placeholder: "tag A, tag B" });
  ["projects", "processes", "findings", "evidence"].forEach(relation => formField(form, `links.${relation}`, text(relation), lesson?.links[relation].join(", ") || "", { full: true }));
  form.append(node("p", { className: "form-note", textContent: text("linkHint") }));
  return form;
}
function render() {
  renderTree();
  renderList();
  renderDetail();
  document.querySelectorAll(".view-tab").forEach(tab => {
    const selected = tab.dataset.view === activeView;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
}
function openNameDialog(kind) {
  const dialog = byId("name-dialog");
  byId("name-dialog-title").textContent = kind === "space" ? text("newSpace") : text("newPage");
  byId("name-input").value = "";
  byId("name-input").placeholder = kind === "space" ? "Audit lessons" : "Architecture decisions";
  const parentField = byId("parent-page-field");
  const parentSelect = byId("parent-page");
  parentField.hidden = kind !== "page";
  parentSelect.replaceChildren();
  (currentSpace()?.pages || []).forEach(page => {
    const option = node("option", { textContent: page.title });
    option.value = page.id;
    parentSelect.append(option);
  });
  parentSelect.insertBefore(Object.assign(node("option", { textContent: language === "zh" ? "顶级页面" : "Top-level page" }), { value: "" }), parentSelect.firstChild);
  byId("name-submit").textContent = text("create");
  dialog.dataset.kind = kind;
  if (!dialog.open) dialog.showModal();
}
byId("name-form").addEventListener("submit", event => {
  event.preventDefault();
  const dialog = byId("name-dialog");
  try {
    if (dialog.dataset.kind === "space") {
      const next = createSpace(workspace, byId("name-input").value);
      const added = next.spaces.at(-1);
      workspace = next;
      selectedPageId = added.pages[0].id;
      commit(workspace, text("spaceCreated"));
    } else {
      const space = currentSpace();
      if (!space) throw new TypeError(text("selectPage"));
      const next = createPage(workspace, space.id, byId("name-input").value, { parentId: byId("parent-page").value || null });
      selectedPageId = next.spaces.find(item => item.id === space.id).pages.at(-1).id;
      commit(next, text("pageCreated"));
    }
    dialog.close("confirm");
  } catch (error) { showToast(error.message, true); }
});
byId("search").addEventListener("input", () => { selectedLessonId = ""; selectedPostId = ""; renderList(); renderDetail(); });
document.querySelectorAll(".view-tab").forEach(tab => tab.addEventListener("click", () => { activeView = tab.dataset.view || "lessons"; selectedLessonId = ""; selectedPostId = ""; editing = false; render(); }));
byId("space-switcher").addEventListener("click", () => {
  const dialog = byId("space-dialog");
  const select = byId("space-select");
  select.replaceChildren();
  workspace.spaces.forEach(space => {
    const option = node("option", { textContent: space.name });
    option.value = space.id;
    option.selected = space.id === currentSpace()?.id;
    select.append(option);
  });
  if (!dialog.open) dialog.showModal();
});
byId("space-form").addEventListener("submit", event => {
  event.preventDefault();
  const space = workspace.spaces.find(item => item.id === byId("space-select").value);
  if (space) {
    selectedPageId = space.pages[0]?.id || "";
    selectedLessonId = "";
    selectedPostId = "";
    activeView = "pages";
    byId("space-dialog").close("confirm");
    render();
  }
});
byId("activity-button").addEventListener("click", () => { activeView = "activity"; selectedLessonId = ""; selectedPostId = ""; render(); });
byId("page-options").addEventListener("click", () => {
  const page = currentPage();
  if (page) showToast(`${page.title} · ${page.version} ${text("version")} · ${pageLessons(page.id).length} ${text("lessonCount")}`);
});
function newLesson() {
  if (!selectedPageId) { showToast(text("selectPage"), true); return; }
  selectedLessonId = "";
  selectedPostId = "";
  editingKind = "lesson";
  editing = true;
  render();
}
function newPost() {
  if (!selectedPageId) { showToast(text("selectPage"), true); return; }
  selectedLessonId = "";
  selectedPostId = "";
  editingKind = "post";
  editing = true;
  render();
}
byId("new-lesson").addEventListener("click", newLesson);
byId("new-lesson-compact").addEventListener("click", newLesson);
byId("new-post-compact").addEventListener("click", newPost);
byId("new-page-compact").addEventListener("click", () => { editingKind = "page"; editing = true; render(); });
byId("new-space").addEventListener("click", () => openNameDialog("space"));
byId("new-page").addEventListener("click", () => openNameDialog("page"));
byId("export-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exportWorkspace(workspace), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = `lessonlearn-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(text("exportSuccess"));
});
byId("import-button").addEventListener("click", () => byId("import-file").click());
byId("import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !window.confirm(text("importConfirm"))) return;
  try {
    workspace = saveWorkspace(importWorkspace(await file.text()));
    selectedPageId = workspace.spaces[0]?.pages[0]?.id || "";
    selectedLessonId = "";
    selectedPostId = "";
    editing = false;
    render();
    showToast(text("importSuccess"));
  } catch (error) { showToast(`${text("importFailed")}: ${error.message || text("invalidImport")}`, true); }
});
byId("language-toggle").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  localStorage.setItem("jeauditflow.lessonlearn.language", language);
  applyLanguage();
});
byId("theme-toggle").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("jeauditflow.lessonlearn.theme", root.dataset.theme);
});
if (window.AuditFlowConfluenceClient) {
  try { adapter = createReadOnlyConfluenceAdapter(window.AuditFlowConfluenceClient); } catch (_) { adapter = null; }
}
selectedPageId = workspace.spaces[0]?.pages[0]?.id || "";
window.LessonLearn = Object.freeze({ getWorkspace: () => structuredClone(workspace), getConfluenceAdapter: () => adapter });
applyTheme();
applyLanguage();
