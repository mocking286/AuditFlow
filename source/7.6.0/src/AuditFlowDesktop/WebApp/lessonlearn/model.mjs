export const LESSONLEARN_SCHEMA = "jeauditflow.lessonlearn/1";
export const LESSONLEARN_STORAGE_KEY = "jeauditflow.lessonlearn.workspace.v1";

const RELATION_FIELDS = ["projects", "processes", "findings", "evidence"];
const TEXT_FIELDS = ["title", "context", "problem", "lesson", "action", "owner"];
const PAGE_STATUSES = ["draft", "published", "archived"];
const POST_STATUSES = ["draft", "published"];

function makeId(prefix = "item") {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function cleanText(value, limit = 12000) {
  return String(value ?? "").trim().slice(0, limit);
}

function cleanLabels(value) {
  const labels = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(labels.map(label => cleanText(label, 100)).filter(Boolean))].slice(0, 40);
}

export function createEmptyWorkspace({ id = makeId("space"), now = new Date().toISOString() } = {}) {
  return {
    schema: LESSONLEARN_SCHEMA,
    updatedAt: now,
    spaces: [{
      id,
      name: "Lessons learned",
      pages: [{
        id: "page-general",
        title: "General",
        parentId: null,
        content: "Use this space to document decisions, lessons learned and reusable audit knowledge.",
        status: "published",
        labels: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
        history: [{ version: 1, savedAt: now, author: "AuditFlow", title: "General", content: "Use this space to document decisions, lessons learned and reusable audit knowledge.", status: "published" }]
      }]
    }],
    lessons: [],
    posts: []
  };
}

export function normalizeWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Workspace must be an object");
  if (value.schema !== LESSONLEARN_SCHEMA) throw new TypeError(`Unsupported LessonLearn schema: ${String(value.schema || "missing")}`);
  if (!Array.isArray(value.spaces) || !Array.isArray(value.lessons)) throw new TypeError("Workspace spaces and lessons must be arrays");
  const workspaceNow = cleanText(value.updatedAt, 80) || new Date(0).toISOString();

  const spaces = value.spaces.map(space => {
    if (!space || typeof space !== "object" || !Array.isArray(space.pages)) throw new TypeError("Each space must contain a pages array");
    const pages = space.pages.map(page => {
      const createdAt = cleanText(page?.createdAt, 80) || workspaceNow;
      const updatedAt = cleanText(page?.updatedAt, 80) || createdAt;
      const content = cleanText(page?.content, 100000);
      const version = Math.max(1, Number(page?.version) || 1);
      const history = Array.isArray(page?.history) && page.history.length
        ? page.history.slice(0, 50).map(item => ({
          version: Math.max(1, Number(item?.version) || 1),
          savedAt: cleanText(item?.savedAt, 80) || updatedAt,
          author: cleanText(item?.author, 160) || "AuditFlow",
          title: cleanText(item?.title, 240) || cleanText(page?.title, 240),
          content: cleanText(item?.content, 100000),
          status: PAGE_STATUSES.includes(item?.status) ? item.status : "published"
        }))
        : [{ version, savedAt: updatedAt, author: "AuditFlow", title: cleanText(page?.title, 240), content, status: PAGE_STATUSES.includes(page?.status) ? page.status : "published" }];
      return {
        id: cleanText(page?.id, 120),
        title: cleanText(page?.title, 240),
        parentId: page?.parentId ? cleanText(page.parentId, 120) : null,
        content,
        status: PAGE_STATUSES.includes(page?.status) ? page.status : "published",
        labels: cleanLabels(page?.labels),
        createdAt,
        updatedAt,
        version,
        history
      };
    });
    if (!cleanText(space.id, 120) || !cleanText(space.name, 240) || pages.some(page => !page.id || !page.title)) {
      throw new TypeError("Space and page ids and names are required");
    }
    const pageIds = new Set(pages.map(page => page.id));
    if (pageIds.size !== pages.length || pages.some(page => page.parentId && !pageIds.has(page.parentId))) {
      throw new TypeError("Page ids must be unique and parent pages must exist in the same space");
    }
    return { id: cleanText(space.id, 120), name: cleanText(space.name, 240), pages };
  });
  const spaceIds = new Set(spaces.map(space => space.id));
  if (spaceIds.size !== spaces.length) throw new TypeError("Space ids must be unique");

  const pageIndex = new Map();
  for (const space of spaces) {
    for (const page of space.pages) {
      if (pageIndex.has(page.id)) throw new TypeError("Page ids must be unique across spaces");
      pageIndex.set(page.id, space.id);
    }
    const parents = new Map(space.pages.map(page => [page.id, page.parentId]));
    for (const page of space.pages) {
      const visited = new Set([page.id]);
      let parentId = page.parentId;
      while (parentId) {
        if (visited.has(parentId)) throw new TypeError("Page hierarchy cannot contain a cycle");
        visited.add(parentId);
        parentId = parents.get(parentId) || null;
      }
    }
  }
  const lessonIds = new Set();
  const lessons = value.lessons.map(lesson => {
    if (!lesson || typeof lesson !== "object") throw new TypeError("Each lesson must be an object");
    const id = cleanText(lesson.id, 120);
    if (!id || lessonIds.has(id)) throw new TypeError("Lesson ids must be present and unique");
    lessonIds.add(id);
    if (!pageIndex.has(lesson.pageId)) throw new TypeError(`Lesson ${id} refers to an unknown page`);
    const entry = {
      id,
      pageId: cleanText(lesson.pageId, 120),
      status: ["open", "in-progress", "resolved"].includes(lesson.status) ? lesson.status : "open",
      createdAt: cleanText(lesson.createdAt, 80) || new Date(0).toISOString(),
      updatedAt: cleanText(lesson.updatedAt, 80) || cleanText(lesson.createdAt, 80) || new Date(0).toISOString(),
      tags: cleanLabels(lesson.tags),
      links: {}
    };
    for (const field of TEXT_FIELDS) entry[field] = cleanText(lesson[field], field === "title" ? 240 : 12000);
    for (const field of RELATION_FIELDS) entry.links[field] = cleanLabels(lesson.links?.[field]);
    if (!entry.title) throw new TypeError(`Lesson ${id} needs a title`);
    return entry;
  });
  const posts = (Array.isArray(value.posts) ? value.posts : []).map(post => {
    if (!post || typeof post !== "object") throw new TypeError("Each blog post must be an object");
    const id = cleanText(post.id, 120);
    const pageId = cleanText(post.pageId, 120);
    if (!id || !pageId || !pageIndex.has(pageId)) throw new TypeError(`Blog post ${id || "<missing>"} refers to an unknown page`);
    return {
      id,
      pageId,
      title: cleanText(post.title, 240),
      excerpt: cleanText(post.excerpt, 1000),
      content: cleanText(post.content, 100000),
      author: cleanText(post.author, 160) || "AuditFlow",
      status: POST_STATUSES.includes(post.status) ? post.status : "draft",
      labels: cleanLabels(post.labels),
      createdAt: cleanText(post.createdAt, 80) || workspaceNow,
      updatedAt: cleanText(post.updatedAt, 80) || cleanText(post.createdAt, 80) || workspaceNow,
      publishedAt: cleanText(post.publishedAt, 80) || "",
      version: Math.max(1, Number(post.version) || 1),
      history: Array.isArray(post.history) ? post.history.slice(0, 50) : []
    };
  });
  const postIds = new Set();
  for (const post of posts) {
    if (!post.title) throw new TypeError(`Blog post ${post.id} needs a title`);
    if (postIds.has(post.id)) throw new TypeError("Blog post ids must be present and unique");
    postIds.add(post.id);
  }
  return {
    schema: LESSONLEARN_SCHEMA,
    updatedAt: workspaceNow,
    spaces,
    lessons,
    posts
  };
}

export function loadWorkspace(storage = globalThis.localStorage) {
  const raw = storage?.getItem(LESSONLEARN_STORAGE_KEY);
  if (!raw) return createEmptyWorkspace();
  try {
    return normalizeWorkspace(JSON.parse(raw));
  } catch (error) {
    error.message = `Saved LessonLearn data could not be loaded: ${error.message}`;
    throw error;
  }
}

export function saveWorkspace(workspace, storage = globalThis.localStorage, now = new Date().toISOString()) {
  if (!storage?.setItem) throw new TypeError("Local storage is unavailable");
  const normalized = normalizeWorkspace({ ...workspace, updatedAt: now });
  storage.setItem(LESSONLEARN_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createSpace(workspace, name, { id = makeId("space") } = {}) {
  const cleanName = cleanText(name, 240);
  if (!cleanName) throw new TypeError("Space name is required");
  if (workspace.spaces.some(space => space.id === id)) throw new TypeError("Space id already exists");
  const updated = structuredClone(normalizeWorkspace(workspace));
  updated.spaces.push({ id, name: cleanName, pages: [{ id: makeId("page"), title: "General", parentId: null }] });
  return updated;
}

export function createPage(workspace, spaceId, title, { parentId = null, id = makeId("page") } = {}) {
  const cleanTitle = cleanText(title, 240);
  const updated = structuredClone(normalizeWorkspace(workspace));
  const space = updated.spaces.find(item => item.id === spaceId);
  if (!space) throw new TypeError("Space was not found");
  if (!cleanTitle) throw new TypeError("Page title is required");
  if (parentId && !space.pages.some(page => page.id === parentId)) throw new TypeError("Parent page must be in the same space");
  if (space.pages.some(page => page.id === id)) throw new TypeError("Page id already exists");
  const now = new Date().toISOString();
  space.pages.push({
    id, title: cleanTitle, parentId, content: "", status: "draft", labels: [],
    createdAt: now, updatedAt: now, version: 1,
    history: [{ version: 1, savedAt: now, author: "AuditFlow", title: cleanTitle, content: "", status: "draft" }]
  });
  return updated;
}

export function updatePage(workspace, pageId, input, { now = new Date().toISOString(), author = "AuditFlow" } = {}) {
  const base = normalizeWorkspace(workspace);
  let found = null;
  const spaces = base.spaces.map(space => ({
    ...space,
    pages: space.pages.map(page => {
      if (page.id !== pageId) return page;
      found = page;
      const next = {
        ...page,
        title: cleanText(input.title ?? page.title, 240),
        content: cleanText(input.content ?? page.content, 100000),
        status: PAGE_STATUSES.includes(input.status) ? input.status : page.status,
        labels: cleanLabels(input.labels ?? page.labels),
        updatedAt: now,
        version: page.version + 1
      };
      if (!next.title) throw new TypeError("Page title is required");
      next.history = [{
        version: next.version,
        savedAt: now,
        author: cleanText(author, 160) || "AuditFlow",
        title: next.title,
        content: next.content,
        status: next.status
      }, ...(page.history || [])].slice(0, 50);
      return next;
    })
  }));
  if (!found) throw new TypeError("Page was not found");
  return normalizeWorkspace({ ...base, spaces, updatedAt: now });
}

export function createPost(workspace, input, { id = makeId("post"), now = new Date().toISOString(), author = "AuditFlow" } = {}) {
  const base = normalizeWorkspace(workspace);
  if (!base.spaces.flatMap(space => space.pages).some(page => page.id === input.pageId)) throw new TypeError("Post page was not found");
  const title = cleanText(input.title, 240);
  if (!title) throw new TypeError("Blog post title is required");
  const status = POST_STATUSES.includes(input.status) ? input.status : "draft";
  const post = {
    id, pageId: cleanText(input.pageId, 120), title, excerpt: cleanText(input.excerpt, 1000),
    content: cleanText(input.content, 100000), author: cleanText(input.author, 160) || author,
    status, labels: cleanLabels(input.labels), createdAt: now, updatedAt: now,
    publishedAt: status === "published" ? now : "", version: 1,
    history: [{ version: 1, savedAt: now, author: cleanText(author, 160) || "AuditFlow", title, content: cleanText(input.content, 100000), status }]
  };
  return { workspace: normalizeWorkspace({ ...base, posts: [...base.posts, post], updatedAt: now }), post };
}

export function updatePost(workspace, postId, input, { now = new Date().toISOString(), author = "AuditFlow" } = {}) {
  const base = normalizeWorkspace(workspace);
  const existing = base.posts.find(post => post.id === postId);
  if (!existing) throw new TypeError("Blog post was not found");
  const title = cleanText(input.title ?? existing.title, 240);
  if (!title) throw new TypeError("Blog post title is required");
  const status = POST_STATUSES.includes(input.status) ? input.status : existing.status;
  const post = {
    ...existing, title, excerpt: cleanText(input.excerpt ?? existing.excerpt, 1000),
    content: cleanText(input.content ?? existing.content, 100000),
    author: cleanText(input.author ?? existing.author, 160) || author,
    status, labels: cleanLabels(input.labels ?? existing.labels), updatedAt: now,
    publishedAt: status === "published" ? (existing.publishedAt || now) : "",
    version: existing.version + 1,
    history: [{
      version: existing.version + 1, savedAt: now, author: cleanText(author, 160) || "AuditFlow",
      title, content: cleanText(input.content ?? existing.content, 100000), status
    }, ...(existing.history || [])].slice(0, 50)
  };
  return { workspace: normalizeWorkspace({ ...base, posts: base.posts.map(item => item.id === postId ? post : item), updatedAt: now }), post };
}

export function createLesson(workspace, input, { id = makeId("lesson"), now = new Date().toISOString() } = {}) {
  const base = normalizeWorkspace(workspace);
  const draft = { ...input, id, createdAt: now, updatedAt: now };
  const updated = normalizeWorkspace({ ...base, lessons: [...base.lessons, draft], updatedAt: now });
  return { workspace: updated, lesson: updated.lessons.find(item => item.id === id) };
}

export function updateLesson(workspace, lessonId, input, { now = new Date().toISOString() } = {}) {
  const base = normalizeWorkspace(workspace);
  const existing = base.lessons.find(lesson => lesson.id === lessonId);
  if (!existing) throw new TypeError("Lesson was not found");
  const updated = normalizeWorkspace({
    ...base,
    updatedAt: now,
    lessons: base.lessons.map(lesson => lesson.id === lessonId
      ? { ...lesson, ...input, id: lesson.id, createdAt: lesson.createdAt, updatedAt: now }
      : lesson)
  });
  return { workspace: updated, lesson: updated.lessons.find(item => item.id === lessonId) };
}

export function searchLessons(workspace, query, { spaceId = "", pageId = "" } = {}) {
  const normalized = normalizeWorkspace(workspace);
  const needle = cleanText(query, 500).toLocaleLowerCase();
  const allowedPages = new Set(normalized.spaces
    .filter(space => !spaceId || space.id === spaceId)
    .flatMap(space => space.pages.filter(page => !pageId || page.id === pageId).map(page => page.id)));
  const pageNames = new Map(normalized.spaces.flatMap(space => space.pages.map(page => [page.id, `${space.name} ${page.title}`])));
  return normalized.lessons.filter(lesson => {
    if (!allowedPages.has(lesson.pageId)) return false;
    if (!needle) return true;
    return [
      ...TEXT_FIELDS.map(field => lesson[field]), lesson.status, ...lesson.tags,
      ...RELATION_FIELDS.flatMap(field => lesson.links[field]), pageNames.get(lesson.pageId),
      normalized.spaces.flatMap(space => space.pages).find(item => item.id === lesson.pageId)?.content
    ].join(" ").toLocaleLowerCase().includes(needle);
  });
}

export function exportWorkspace(workspace, exportedAt = new Date().toISOString()) {
  return { ...normalizeWorkspace(workspace), exportedAt };
}

export function importWorkspace(jsonText) {
  const parsed = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
  const normalized = normalizeWorkspace(parsed);
  return { ...normalized, updatedAt: new Date().toISOString() };
}

export function createReadOnlyConfluenceAdapter(client) {
  if (!client || typeof client !== "object") throw new TypeError("A Confluence client is required");
  const allowed = ["listSpaces", "searchPages", "getPage"];
  const adapter = { readOnly: true };
  for (const method of allowed) {
    if (typeof client[method] === "function") adapter[method] = client[method].bind(client);
  }
  adapter.writePage = async () => { throw new Error("Confluence adapter is read-only"); };
  return Object.freeze(adapter);
}
