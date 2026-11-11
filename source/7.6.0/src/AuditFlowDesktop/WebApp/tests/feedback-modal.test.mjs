import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../feedback-modal.js", import.meta.url), "utf8").catch(() => "");

function loadApi() {
  const sandbox = {
    window: {},
    document: {
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, append() {}, appendChild() {} }; },
      createDocumentFragment() { return { append() {}, appendChild() {} }; },
      body: { append() {} },
      addEventListener() {}
    },
    URL,
    Blob,
    FileReader: class {},
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "feedback-modal.js" });
  assert.ok(sandbox.window.AuditFlowFeedback, "feedback module must expose a public API");
  return sandbox.window.AuditFlowFeedback;
}

test("feedback attachment validation accepts bounded images and rejects unsafe input", () => {
  const api = loadApi();
  assert.equal(api.validateAttachment({ name: "screen.png", type: "image/png", size: 1024 }).ok, true);
  assert.equal(api.validateAttachment({ name: "screen.png", type: "image/png", size: 5 * 1024 * 1024 + 1 }).ok, false);
  assert.equal(api.validateAttachment({ name: "secret.pdf", type: "application/pdf", size: 1024 }).ok, false);
});

test("feedback annotation serialization preserves ordered drawing commands", () => {
  const api = loadApi();
  const annotation = api.serializeAnnotation([
    { type: "pen", points: [[1, 2], [3, 4]], color: "#d92d20", width: 3 },
    { type: "rect", x: 10, y: 20, width: 30, height: 40, color: "#0c66e4", widthPx: 2 },
    { type: "arrow", from: [2, 3], to: [9, 11], color: "#0c66e4", width: 2 }
  ]);
  assert.equal(annotation.version, 1);
  assert.deepEqual(Array.from(annotation.commands, command => command.type), ["pen", "rect", "arrow"]);
  assert.equal(annotation.commands[0].points.length, 2);
});

test("feedback record keeps local attachment IDs and explicit submission state", () => {
  const api = loadApi();
  const record = api.createRecord({
    feature: "Tree View",
    content: "The process filter should remain visible.",
    attachments: [{ id: "ATT-1", name: "screen.png", type: "image/png", size: 100 }],
    annotation: { version: 1, commands: [] }
  });
  assert.match(record.id, /^FB-/);
  assert.equal(record.attachments[0].id, "ATT-1");
  assert.equal(record.submission.status, "local-draft");
  assert.equal("data" in record.attachments[0], false);
});

function mountHarness({ canSubmit = false, capture, preAuth = false, pageCapture } = {}) {
  const events = {}, entries = [], saved = [], submitted = [], deleted = [], messages = [];
  const form = { elements: { feature: { value: "Tree View" }, content: { value: "Keep filters visible." } }, addEventListener() {}, reportValidity: () => true };
  const preview = { hidden: true, innerHTML: "", replaceChildren() { this.innerHTML = ""; }, scrollIntoView() {} };
  const consent = { checked: false };
  const fakeRoot = {
    innerHTML: "",
    addEventListener(name, fn) { events[name] = fn; },
    removeEventListener() {},
    replaceChildren() { this.innerHTML = ""; },
    contains: () => true,
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === "#quickFeedbackForm") return form;
      if (selector === "[data-feedback-preview]") return preview;
      if (selector === "[data-feedback-consent]") return consent;
      if (selector === "[data-feedback-status]") return { set textContent(value) { messages.push(value); }, classList: { toggle() {} } };
      if (selector === ".feedback-backdrop") return { style: {} };
      if (selector === "canvas" || selector === "input[type=color]") return null;
      return { addEventListener() {}, focus() {} };
    }
  };
  const localValues = new Map();
  const sandbox = {
    window: { confirm: () => true, AuditFlowAuth: { authenticated: !preAuth }, localStorage: { getItem: key => localValues.get(key) || null, setItem: (key, value) => localValues.set(key, value) } },
    document: { documentElement: { lang: "en" }, activeElement: { focus() {} }, body: { classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {} },
    location: { pathname: "/index.html", hash: "#/dashboard" },
    URL, Blob,
    setTimeout, clearTimeout,
    navigator: {},
    fetch() { throw new Error("module must never fetch directly"); }
  };
  if (pageCapture) {
    sandbox.window.html2canvas = pageCapture;
    sandbox.createImageBitmap = async () => ({ width: 320, height: 180, close() {} });
  }
  if (preAuth) {
    sandbox.document.getElementById = id => id === "feedbackModalRoot" ? fakeRoot : null;
    sandbox.document.querySelector = selector => selector.includes("auth-panel") ? { lang: "en" } : null;
  }
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const api = sandbox.window.AuditFlowFeedback;
  const mountApplication = () => api.mount({ modalRoot: fakeRoot, capture, storage: {
    list: () => entries, canSubmit: () => canSubmit,
    async save(record, images) { saved.push({ record, images }); const previous = entries.findIndex(item => item.id === record.id); if (previous >= 0) entries[previous] = record; else entries.push(record); },
    async submit(record, image) { submitted.push({ record, image }); return { id: "remote-1" }; },
    async remove(record) { deleted.push(record); entries.splice(entries.indexOf(record), 1); }
  } });
  if (!preAuth) mountApplication();
  api.open({ source: preAuth ? "login" : "settings" });
  async function click(action, extra = {}) {
    const button = { dataset: { feedbackAction: action, ...extra } };
    events.click({ target: { closest: () => button }, preventDefault() {} });
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  return { api, click, fakeRoot, form, preview, consent, entries, saved, submitted, deleted, messages, localValues, mountApplication, sandbox };
}

test("feedback modal uses unique form IDs and saves locally without submission", async () => {
  const h = mountHarness();
  assert.match(h.fakeRoot.innerHTML, /id="quickFeedbackForm"/);
  assert.match(h.fakeRoot.innerHTML, /id="quickFeedbackImagePicker"/);
  assert.doesNotMatch(h.fakeRoot.innerHTML, /id="feedbackForm"/);
  await h.click("save");
  assert.equal(h.saved.length, 1);
  assert.equal(h.submitted.length, 0);
  assert.equal(h.saved[0].record.source, "settings");
  assert.equal(h.saved[0].record.page, "/index.html#/dashboard");
  h.api.close();
  assert.equal(h.fakeRoot.innerHTML, "");
});

test("submission requires saved preview and explicit consent", async () => {
  const h = mountHarness({ canSubmit: true });
  await h.click("submit");
  assert.equal(h.submitted.length, 0);
  await h.click("preview");
  assert.match(h.preview.innerHTML, /\/api\/feedback/);
  assert.equal(h.saved.length, 1);
  assert.equal(h.submitted.length, 0);
  await h.click("submit");
  assert.equal(h.submitted.length, 0);
  h.consent.checked = true;
  await h.click("submit");
  assert.equal(h.submitted.length, 1);
  assert.equal(h.entries[0].submission.status, "submitted");
});

test("unavailable submission keeps draft and local deletion uses storage adapter", async () => {
  const h = mountHarness();
  await h.click("preview");
  assert.match(h.preview.innerHTML, /unavailable here/);
  h.consent.checked = true;
  await h.click("submit");
  assert.equal(h.entries.length, 1);
  assert.equal(h.submitted.length, 0);
  await h.click("delete", { id: h.entries[0].id });
  assert.equal(h.deleted.length, 1);
  assert.equal(h.entries.length, 0);
});

test("cancelled capture leaves text and draft state available", async () => {
  const h = mountHarness({ capture: async () => { const error = new Error("cancel"); error.name = "NotAllowedError"; throw error; } });
  await h.click("capture");
  assert.ok(h.messages.includes("Screen capture cancelled."));
  await h.click("save");
  assert.equal(h.saved[0].record.content, "Keep filters visible.");
});

test("login feedback opens and saves a local draft before authentication", async () => {
  const h = mountHarness({ preAuth: true });
  assert.match(h.fakeRoot.innerHTML, /id="quickFeedbackForm"/);
  await h.click("preview");
  assert.equal(h.submitted.length, 0);
  const records = JSON.parse(h.localValues.get("auditflow-login-feedback-v1"));
  assert.equal(records.length, 1);
  assert.equal(records[0].feature, "Tree View");
  assert.equal(records[0].source, "login");
  assert.equal(records[0].submission.status, "local-draft");
  assert.match(h.preview.innerHTML, /unavailable here/);
});

test("authenticated mount preserves an open login draft and its local repository", async () => {
  const h = mountHarness({ preAuth: true });
  await h.click("save");
  h.sandbox.window.AuditFlowAuth.authenticated = true;
  h.mountApplication();
  assert.match(h.fakeRoot.innerHTML, /value="Tree View"/);
  assert.match(h.fakeRoot.innerHTML, /Local feedback/);
  await h.click("save");
  assert.equal(h.saved.length, 0, "existing login drafts remain in their local repository");
  assert.equal(JSON.parse(h.localValues.get("auditflow-login-feedback-v1")).length, 1);
});

test("authenticated feedback automatically captures a private-safe current-page image", async () => {
  let captureOptions, captured = 0;
  const h = mountHarness({ pageCapture: async (_element, options) => { captured++; captureOptions = options; return { toBlob(callback) { callback(new Blob(["fixture-image"], { type: "image/png" })); } }; } });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(captured, 1);
  assert.equal(captureOptions.allowTaint, false);
  assert.equal(captureOptions.useCORS, false);
  assert.equal(captureOptions.proxy, null);
  for (const selector of ['input[type="password"]', "#authGate", ".bridge-workbench", "#feedbackModalRoot"]) {
    assert.equal(captureOptions.ignoreElements({ matches: selectors => selectors.includes(selector) }), true, selector);
  }
  assert.match(h.fakeRoot.innerHTML, /feedback-thumbnails/);
  h.api.close();
});

test("closing during automatic capture discards the late image", async () => {
  let resolveCapture;
  const pending = new Promise(resolve => { resolveCapture = resolve; });
  const h = mountHarness({ pageCapture: () => pending });
  h.api.close();
  assert.equal(h.fakeRoot.innerHTML, "");
  resolveCapture({ toBlob(callback) { callback(new Blob(["fixture-image"], { type: "image/png" })); } });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(h.fakeRoot.innerHTML, "");
});

test("login feedback never automatically captures credential forms", async () => {
  let captured = 0;
  const h = mountHarness({ preAuth: true, pageCapture: async () => { captured++; throw new Error("login page must not be captured"); } });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(captured, 0);
  assert.match(h.fakeRoot.innerHTML, /quickFeedbackForm/);
});
