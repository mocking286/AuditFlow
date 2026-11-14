(() => {
  "use strict";
  const MAX_BYTES = 5 * 1024 * 1024, MAX_IMAGES = 5;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const point = value => (Array.isArray(value) ? value : [0, 0]).slice(0, 2).map(number => Math.max(0, Math.min(16000, Number(number) || 0)));
  function validateAttachment(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(String(file?.type || "").toLowerCase())) return { ok: false, code: "image-type" };
    if (!Number.isFinite(Number(file?.size)) || Number(file.size) <= 0 || Number(file.size) > MAX_BYTES) return { ok: false, code: "image-size" };
    return { ok: true };
  }
  function serializeAnnotation(commands = []) {
    return { version: 1, commands: commands.slice(0, 300).filter(command => ["pen", "rect", "arrow", "mask"].includes(command?.type)).map(command => {
      const common = { type: command.type, color: /^#[a-f0-9]{6}$/i.test(command.color) ? command.color : "#d92d20", width: Math.max(1, Math.min(12, Number(command.widthPx || command.width) || 3)) };
      if (command.type === "pen") return { ...common, points: (command.points || []).slice(0, 2000).map(point) };
      if (command.type === "arrow") return { ...common, from: point(command.from), to: point(command.to) };
      return { ...common, x: point([command.x, command.y])[0], y: point([command.x, command.y])[1], w: Math.max(-16000, Math.min(16000, Number(command.w ?? command.width) || 0)), h: Math.max(-16000, Math.min(16000, Number(command.h ?? command.height) || 0)) };
    }) };
  }
  function createRecord(input = {}) {
    const feature = String(input.feature || "").trim().slice(0, 240), content = String(input.content || "").trim().slice(0, 50000);
    if (!feature || !content) throw new Error("feedback-required");
    return { id: input.id || uid("FB"), feature, content, date: new Date().toISOString(), source: ["settings", "login"].includes(input.source) ? input.source : "bubble", localOnly: true, page: String(input.page || "").slice(0, 500), attachments: (input.attachments || []).slice(0, MAX_IMAGES).map(item => ({ id: String(item.id), name: String(item.name || "feedback.png").slice(0, 255), type: String(item.type || "image/png"), size: Number(item.size) || 0, width: Number(item.width) || 0, height: Number(item.height) || 0, annotation: serializeAnnotation(item.annotation?.commands || []) })), submission: input.submission || { status: "local-draft" } };
  }
  const paths = { pen: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>', rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>', arrow: '<path d="M4 20 20 4M9 4h11v11"/>', mask: '<rect x="4" y="5" width="16" height="14" fill="currentColor"/>', undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>', clear: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3Z"/><circle cx="12" cy="13" r="4"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 17 5-5 4 4 3-3 4 4"/>', save: '<path d="M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8"/>' };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.image}</svg>`;
  let options = null, state = null, returnFocus = null, activeCommand = null;
  const language = () => options?.language?.() || document.documentElement?.lang || "en";
  const t = (zh, en) => language() === "en" ? en : zh;
  const root = () => options?.modalRoot;
  const currentImage = () => state?.images[state.selected];
  const LOGIN_KEY = "auditflow-login-feedback-v1";
  function loginRecords() { try { const records = JSON.parse(window.localStorage.getItem(LOGIN_KEY) || "[]"); return Array.isArray(records) ? records : []; } catch (_) { return []; } }
  async function loginAttachment(mode, operation) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(LOGIN_KEY, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("attachments", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("attachments", mode), request = operation(transaction.objectStore("attachments")); let result;
        request.onsuccess = () => { result = request.result; }; transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error("Local image storage failed"));
      });
    } finally { database.close(); }
  }
  const loginStorage = {
    list: loginRecords,
    canSubmit: () => false,
    getAttachment: id => loginAttachment("readonly", store => store.get(id)),
    async save(record, images) {
      const previous = loginRecords().find(item => item.id === record.id);
      for (const image of images) await loginAttachment("readwrite", store => store.put({ ...image.metadata, feedbackId: record.id, blob: image.blob }));
      window.localStorage.setItem(LOGIN_KEY, JSON.stringify([record, ...loginRecords().filter(item => item.id !== record.id)].slice(0, 120)));
      for (const attachment of previous?.attachments || []) if (!record.attachments.some(item => item.id === attachment.id)) await loginAttachment("readwrite", store => store.delete(attachment.id));
    },
    async remove(record) {
      for (const attachment of record.attachments || []) await loginAttachment("readwrite", store => store.delete(attachment.id));
      window.localStorage.setItem(LOGIN_KEY, JSON.stringify(loginRecords().filter(item => item.id !== record.id)));
    }
  };
  function combineStorage(storage) {
    if (storage === loginStorage) return storage;
    return {
      ...storage,
      list: () => { const own = storage.list?.() || [], ids = new Set(own.map(item => item.id)); return [...own, ...loginRecords().filter(item => !ids.has(item.id))]; },
      getAttachment: async id => await storage.getAttachment?.(id) || loginStorage.getAttachment(id),
      save: (record, images) => (record.source === "login" ? loginStorage : storage).save(record, images),
      remove: record => (record.source === "login" ? loginStorage : storage).remove(record)
    };
  }
  function status(message, error = false) { const node = root()?.querySelector("[data-feedback-status]"); if (node) { node.textContent = message; node.classList.toggle("error", error); } }
  function readFields() { const form = root()?.querySelector("#quickFeedbackForm"); if (form && state) { state.feature = form.elements.feature.value; state.content = form.elements.content.value; } }
  function release(image) { if (image?.url) URL.revokeObjectURL(image.url); image?.bitmap?.close?.(); }
  function close() {
    if (state?.busy && !state.captureJob) return;
    if (state?.captureJob) state.captureJob.cancelled = true;
    state?.images.forEach(release); state = null; activeCommand = null;
    if (root()) root().replaceChildren();
    document.body.classList.remove("feedback-open");
    returnFocus?.focus?.(); returnFocus = null;
  }
  function toolButton(action, label, symbol, attributes = "") { return `<button type="button" class="feedback-tool" data-feedback-action="${action}" title="${label}" aria-label="${label}" ${attributes}>${icon(symbol)}</button>`; }
  function render() {
    if (!state || !root()) return;
    const image = currentImage(), local = options.storage.list?.() || [];
    const heading = t("反馈建议", "Feedback"), imageLabel = t("图像", "Image");
    root().innerHTML = `<div class="feedback-backdrop"><section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="quickFeedbackTitle" lang="${language()}" data-i18n-skip>
      <header><div><h2 id="quickFeedbackTitle">${heading}</h2><p>${t("先保存在本机；提交前可预览。反馈不进入审核证据。", "Save locally first and preview before submitting. Feedback stays separate from audit evidence.")}</p></div>${toolButton("close", t("关闭", "Close"), "close")}</header>
      <div class="feedback-content"><form id="quickFeedbackForm"><label>${t("功能 / 页面", "Feature / page")}<input name="feature" maxlength="240" required value="${escape(state.feature)}"></label><label>${t("建议内容", "Suggestion")}<textarea name="content" maxlength="50000" required rows="4">${escape(state.content)}</textarea></label></form>
      <div class="feedback-image-actions"><button type="button" class="btn secondary sm" data-feedback-action="capture">${icon("camera")}${t("截取屏幕", "Capture screen")}</button><button type="button" class="btn secondary sm" data-feedback-action="upload">${icon("upload")}${t("添加图像", "Add images")}</button><small>${state.images.length}/${MAX_IMAGES} · PNG / JPEG / WebP · ${t("每张最多 5 MiB", "5 MiB per image")}</small></div>
      <input type="file" id="quickFeedbackImagePicker" hidden multiple accept="image/png,image/jpeg,image/webp">
      ${image ? `<div class="feedback-thumbnails">${state.images.map((entry, index) => `<button type="button" class="${index === state.selected ? "selected" : ""}" data-feedback-action="select" data-index="${index}" aria-label="${imageLabel} ${index + 1}" aria-pressed="${index === state.selected}"><img src="${entry.url}" alt="${escape(entry.name)}"><span>${index + 1}</span></button>`).join("")}</div><div class="feedback-editor"><div class="feedback-toolbar" role="toolbar" aria-label="${t("图像标注", "Image annotation")}">${[["pen", "画笔", "Pen"], ["rect", "矩形", "Rectangle"], ["arrow", "箭头", "Arrow"], ["mask", "隐私遮罩", "Privacy mask"]].map(([tool, zh, en]) => toolButton("tool", t(zh, en), tool, `data-tool="${tool}" aria-pressed="${state.tool === tool}"`)).join("")}<label class="feedback-color" title="${t("标注颜色", "Annotation color")}"><input type="color" value="${state.color}" aria-label="${t("标注颜色", "Annotation color")}"></label>${toolButton("undo", t("撤销", "Undo"), "undo")}${toolButton("clear", t("清除标注", "Clear annotations"), "clear")}<button type="button" class="feedback-remove" data-feedback-action="remove">${t("移除图像", "Remove image")}</button></div><canvas class="feedback-canvas" width="${image.width}" height="${image.height}" aria-label="${t("当前图像预览与标注", "Current image preview and annotation")}"></canvas></div><small class="feedback-privacy">${t("请遮盖客户资料和个人信息。黑色隐私遮罩会合成到保存及提交的图像中。", "Mask customer and personal information. Black privacy masks are flattened into saved and submitted images.")}</small>` : `<div class="feedback-empty">${icon("image")}<span>${t("可选：选择图像，或由浏览器提示选择要截取的屏幕、窗口或标签页。", "Optional: add an image or choose a screen, window or tab in the browser capture prompt.")}</span></div>`}
      <div data-feedback-preview hidden></div><p class="feedback-status" data-feedback-status role="status" aria-live="polite"></p>
      ${local.length ? `<details class="feedback-drafts"><summary>${t("本机反馈", "Local feedback")} (${local.length})</summary>${local.slice(0, 120).map(record => `<article><div><strong>${escape(record.feature)}</strong><small>${escape(record.submission?.status === "submitted" ? t("已提交", "Submitted") : t("本地草稿", "Local draft"))} · ${escape(String(record.date || record.createdAt || "").slice(0, 10))}</small></div><button type="button" data-feedback-action="load" data-id="${escape(record.id)}">${t("打开", "Open")}</button>${toolButton("delete", t("删除本机反馈", "Delete local feedback"), "clear", `data-id="${escape(record.id)}"`)}</article>`).join("")}</details>` : ""}</div>
      <footer><button type="button" class="btn secondary" data-feedback-action="save">${icon("save")}${t("保存本地草稿", "Save local draft")}</button><button type="button" class="btn primary" data-feedback-action="preview">${t("预览提交", "Preview submission")}</button></footer>
    </section></div>`;
    root().querySelector("#quickFeedbackImagePicker").addEventListener("change", event => void addFiles(Array.from(event.target.files || [])));
    root().querySelector("#quickFeedbackForm").addEventListener("submit", event => { event.preventDefault(); void saveDraft(); });
    root().querySelector("#quickFeedbackForm").addEventListener("input", invalidatePreview);
    root().querySelector("input[type=color]")?.addEventListener("input", event => { state.color = event.target.value; invalidatePreview(); });
    const canvas = root().querySelector("canvas");
    if (canvas) { canvas.addEventListener("pointerdown", beginDraw); canvas.addEventListener("pointermove", moveDraw); canvas.addEventListener("pointerup", endDraw); canvas.addEventListener("pointercancel", endDraw); draw(); }
  }
  function invalidatePreview() { const preview = root()?.querySelector("[data-feedback-preview]"); if (preview) { preview.hidden = true; preview.replaceChildren(); } state.previewRecord = null; }
  function drawCommand(context, command) {
    context.strokeStyle = command.color; context.lineWidth = command.widthPx || command.width || 3; context.lineCap = "round"; context.lineJoin = "round";
    if (command.type === "mask") { context.fillStyle = "#000000"; context.fillRect(command.x, command.y, command.w, command.h); return; }
    if (command.type === "rect") { context.strokeRect(command.x, command.y, command.w, command.h); return; }
    context.beginPath();
    if (command.type === "pen") { (command.points || []).forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); }
    else { const [x, y] = command.to, [fx, fy] = command.from, angle = Math.atan2(y - fy, x - fx); context.moveTo(fx, fy); context.lineTo(x, y); context.moveTo(x - 14 * Math.cos(angle - Math.PI / 6), y - 14 * Math.sin(angle - Math.PI / 6)); context.lineTo(x, y); context.lineTo(x - 14 * Math.cos(angle + Math.PI / 6), y - 14 * Math.sin(angle + Math.PI / 6)); }
    context.stroke();
  }
  function draw(canvas = root()?.querySelector("canvas"), image = currentImage(), pending = true) {
    if (!canvas || !image) return;
    const context = canvas.getContext("2d"); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
    // Masks render last so later pen strokes can never reveal masked pixels.
    const commands = [...image.commands, ...(pending && activeCommand ? [activeCommand] : [])];
    commands.filter(c => c.type !== "mask").forEach(c => drawCommand(context, c)); commands.filter(c => c.type === "mask").forEach(c => drawCommand(context, c));
  }
  function coordinates(event) { const bounds = event.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(event.currentTarget.width, (event.clientX - bounds.left) * event.currentTarget.width / bounds.width)), Math.max(0, Math.min(event.currentTarget.height, (event.clientY - bounds.top) * event.currentTarget.height / bounds.height))]; }
  function beginDraw(event) {
    if (state.busy || event.button !== 0 || currentImage().commands.length >= 300) return;
    event.preventDefault(); invalidatePreview(); const [x, y] = coordinates(event);
    activeCommand = { type: state.tool, color: state.color, widthPx: 3, points: [[x, y]], from: [x, y], to: [x, y], x, y, w: 0, h: 0 }; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDraw(event) { if (!activeCommand) return; const p = coordinates(event); if (activeCommand.type === "pen") { if (activeCommand.points.length < 2000) activeCommand.points.push(p); } else if (activeCommand.type === "arrow") activeCommand.to = p; else { activeCommand.w = p[0] - activeCommand.x; activeCommand.h = p[1] - activeCommand.y; } draw(); }
  function endDraw(event) { if (!activeCommand) return; moveDraw(event); currentImage().commands.push(activeCommand); activeCommand = null; draw(); }
  function canvasBlob(canvas, type = "image/png") { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t("图像编码失败", "Image encoding failed"))), type, .9)); }
  async function decode(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try { return await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(t("无法读取图像", "Cannot read image"))); image.src = url; }); } finally { URL.revokeObjectURL(url); }
  }
  async function addImage(blob, name, id, session = state) {
    if (!session || state !== session) return false;
    const validation = validateAttachment(blob);
    if (!validation.ok) throw new Error(validation.code === "image-size" ? t("图像必须大于 0 且不超过 5 MiB。", "Images must be nonempty and no larger than 5 MiB.") : t("请选择 PNG、JPEG 或 WebP 图像。", "Choose a PNG, JPEG or WebP image."));
    if (state.images.length >= MAX_IMAGES) throw new Error(t("最多添加 5 张图像。", "Add no more than 5 images."));
    let bitmap = await decode(blob); const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
    if (!width || !height) { bitmap.close?.(); throw new Error(t("图像尺寸无效。", "Invalid image dimensions.")); }
    const scale = Math.min(1, 1920 / Math.max(width, height));
    if (scale < 1) { const canvas = document.createElement("canvas"); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); blob = await canvasBlob(canvas); bitmap.close?.(); bitmap = await decode(blob); }
    if (state !== session) { bitmap.close?.(); return false; }
    state.images.push({ id: id || uid("FB-IMG"), name: String(name || "feedback.png").replace(/[\/]/g, "-"), type: blob.type, size: blob.size, width: bitmap.width || bitmap.naturalWidth, height: bitmap.height || bitmap.naturalHeight, blob, bitmap, url: URL.createObjectURL(blob), commands: [] }); state.selected = state.images.length - 1; return true;
  }
  async function addFiles(files) { if (state.busy) return; readFields(); setBusy(true); try { for (const file of files) await addImage(file, file.name); render(); } catch (error) { render(); status(error.message, true); } finally { setBusy(false); } }
  function setBusy(value) { if (!state) return; state.busy = value; root()?.querySelectorAll("button,input,textarea").forEach(node => { node.disabled = value && !(state.captureJob && node.dataset.feedbackAction === "close"); }); }
  const PRIVATE_CAPTURE = '#feedbackModalRoot,.feedback-bubble,#authGate,.bridge-workbench,#bridgeConnectorForm,[data-bridge-secret],[data-bridge-details],[data-capture-private],input[type="password"],input[name*="token" i],input[name*="secret" i],input[name*="password" i],input[name*="apikey" i]';
  function ignoreCaptureElement(element) {
    if (element.matches?.(PRIVATE_CAPTURE)) return true;
    if (element.tagName === "FORM" && element.querySelector?.('input[type="password"],input[name*="token" i],input[name*="secret" i],input[name*="apikey" i]')) return true;
    if (element.tagName === "IFRAME") return true;
    if (element.tagName === "IMG") { try { const url = new URL(element.currentSrc || element.src, location.href); return /^https?:$/.test(url.protocol) && url.origin !== location.origin; } catch (_) { return true; } }
    return false;
  }
  async function capturePage() {
    if (!state || state.busy || state.source === "login" || window.AuditFlowAuth?.authenticated !== true || typeof window.html2canvas !== "function") return;
    const session = state, job = { cancelled: false }; session.captureJob = job; setBusy(true);
    status(t("正在生成当前页面截图…", "Capturing the current page…"));
    try {
      const width = Math.max(1, Number(window.innerWidth) || 1280), height = Math.max(1, Number(window.innerHeight) || 800);
      const canvas = await window.html2canvas(document.body, {
        x: Number(window.scrollX) || 0, y: Number(window.scrollY) || 0, width, height, windowWidth: width, windowHeight: height,
        scrollX: Number(window.scrollX) || 0, scrollY: Number(window.scrollY) || 0, scale: Math.min(1, 1920 / Math.max(width, height)),
        allowTaint: false, useCORS: false, proxy: null, imageTimeout: 5000, logging: false, removeContainer: true,
        ignoreElements: ignoreCaptureElement,
        onclone(clone) {
          clone.querySelectorAll(PRIVATE_CAPTURE).forEach(node => node.remove());
          // html2canvas 1.4.1 predates these CSS color functions.
          clone.querySelectorAll("*").forEach(node => {
            const style = clone.defaultView.getComputedStyle(node);
            for (const property of ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color"]) {
              if (/(?:color-mix|oklch|oklab|lab|lch|color)[(]/i.test(style.getPropertyValue(property))) node.style.setProperty(property, property === "background-color" ? "transparent" : "#172b4d", "important");
            }
            for (const property of ["background-image", "box-shadow", "text-shadow", "border-image-source"]) if (/(?:color-mix|oklch|oklab|lab|lch|color)[(]/i.test(style.getPropertyValue(property))) node.style.setProperty(property, "none", "important");
          });
        }
      });
      if (state !== session || job.cancelled) return;
      const blob = await canvasBlob(canvas);
      if (state !== session || job.cancelled) return;
      await addImage(blob, "current-page.png", undefined, session);
      if (state !== session || job.cancelled) return;
      readFields(); render(); status(t("当前页面截图已添加，请检查并遮盖敏感内容。", "Current-page image added. Review and mask sensitive content."));
    } catch (_) {
      if (state === session && !job.cancelled) status(t("自动截图不可用，请使用屏幕截取或添加图像。", "Automatic capture is unavailable. Use Capture screen or add an image."), true);
    } finally { if (state === session) { session.captureJob = null; setBusy(false); } }
  }
  async function captureScreen() {
    if (state.busy) return; readFields(); setBusy(true); let stream; const backdrop = root().querySelector(".feedback-backdrop");
    try {
      if (state.images.length >= MAX_IMAGES) throw new Error(t("最多添加 5 张图像。", "Add no more than 5 images."));
      if (options.capture) { const blob = await options.capture(); if (blob) await addImage(blob, "screenshot.png"); }
      else {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(t("当前浏览器不支持屏幕截取，请上传图像。", "Screen capture is unavailable in this browser. Upload an image instead."));
        backdrop.style.visibility = "hidden"; document.body.classList.add("feedback-capturing");
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const video = document.createElement("video"); video.muted = true; video.srcObject = stream; await video.play();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = document.createElement("canvas"), scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale); canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height); await addImage(await canvasBlob(canvas), "screenshot.png"); video.srcObject = null;
      } render();
    } catch (error) { render(); status(error.name === "NotAllowedError" || error.name === "AbortError" ? t("已取消屏幕截取。", "Screen capture cancelled.") : error.message, error.name !== "NotAllowedError"); }
    finally { stream?.getTracks().forEach(track => track.stop()); document.body.classList.remove("feedback-capturing"); if (backdrop) backdrop.style.visibility = ""; setBusy(false); }
  }
  async function snapshot() {
    readFields(); const attachments = [], images = [];
    for (const image of state.images) {
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; draw(canvas, image, false);
      const blob = await canvasBlob(canvas);
      if (!validateAttachment(blob).ok) throw new Error(t("标注后图像超过 5 MiB，请移除或缩小图像。", "An annotated image exceeds 5 MiB. Remove or reduce it."));
      const metadata = { id: image.id, name: image.name.replace(/\.[^.]+$/, "") + ".png", type: blob.type, size: blob.size, width: image.width, height: image.height, annotation: serializeAnnotation(image.commands) }; attachments.push(metadata); images.push({ metadata, blob });
    }
    return { record: createRecord({ id: state.id, feature: state.feature, content: state.content, source: state.source, page: state.page, attachments }), images };
  }
  async function saveDraft() {
    if (state.busy || !root().querySelector("#quickFeedbackForm").reportValidity()) return null;
    setBusy(true); try { const draft = await snapshot(); await options.storage.save(draft.record, draft.images); state.id = draft.record.id; render(); status(t("本地草稿已保存。", "Local draft saved.")); options.onSaved?.(draft.record); return draft; } catch (error) { status(error.message, true); return null; } finally { setBusy(false); }
  }
  async function preview() {
    const draft = await saveDraft(); if (!draft) return;
    const node = root().querySelector("[data-feedback-preview]"), selected = state.images[state.selected];
    const attachment = draft.images.find(entry => entry.metadata.id === selected?.id);
    state.previewRecord = { ...draft, attachment };
    const available = options.storage.canSubmit?.() === true;
    node.hidden = false; node.innerHTML = `<h3>${t("提交预览", "Submission preview")}</h3><dl><dt>${t("接收位置", "Destination")}</dt><dd>/api/feedback (${t("当前站点的受保护接口", "protected endpoint on this site")})</dd><dt>${t("图像", "Image")}</dt><dd>${attachment ? escape(attachment.metadata.name) : t("不包含图像", "No image included")}</dd></dl><strong>${escape(draft.record.feature)}</strong><p>${escape(draft.record.content)}</p><p>${t("仅发送上述文字和当前选中的一张已标注图像。其余图像留在本机。请确认不含客户机密或个人信息。", "Only this text and the selected annotated image will be sent. Other images stay local. Check for confidential or personal information.")}</p><label><input type="checkbox" data-feedback-consent> ${t("我已核对内容并同意发送到当前站点。", "I reviewed this content and agree to send it to this site.")}</label><button type="button" class="btn primary" data-feedback-action="submit" ${available ? "" : "disabled"}>${t("确认提交", "Confirm submission")}</button>${available ? "" : `<p>${t("当前环境未启用同源反馈服务。草稿已保存在本机。", "Same-origin feedback submission is unavailable here. Your draft is saved locally.")}</p>`}`;
    node.scrollIntoView?.({ block: "nearest" });
  }
  async function submit() {
    if (state.busy || !state.previewRecord || options.storage.canSubmit?.() !== true) return;
    if (!root().querySelector("[data-feedback-consent]")?.checked) { status(t("请先核对内容并勾选发送确认。", "Review the content and confirm consent first."), true); return; }
    setBusy(true); try { const draft = state.previewRecord; const result = await options.storage.submit(draft.record, draft.attachment); const record = { ...draft.record, localOnly: false, submission: { status: "submitted", at: new Date().toISOString(), remoteId: String(result?.entry?.id || result?.id || "") } }; await options.storage.save(record, draft.images); render(); status(t("已提交到当前站点，本机副本已保留。", "Submitted to this site. A local copy is retained.")); options.onSaved?.(record); } catch (error) { status(t("提交不可用；本地草稿已保留。", "Submission unavailable; your local draft is retained.") + " " + error.message, true); } finally { setBusy(false); }
  }
  async function loadDraft(id) {
    const record = options.storage.list().find(item => item.id === id); if (!record) return;
    readFields(); setBusy(true); state.images.forEach(release); state.images = []; state.id = record.id; state.source = record.source || state.source; state.feature = record.feature || ""; state.content = record.content || ""; state.page = record.page || "";
    try { for (const metadata of (record.attachments || [])) { const stored = await options.storage.getAttachment(metadata.id); if (!stored?.blob) throw new Error(t("本机图像不可用。", "A local image is unavailable.")); await addImage(stored.blob, metadata.name, metadata.id); } render(); } catch (error) { render(); status(error.message, true); } finally { setBusy(false); }
  }
  async function deleteDraft(id) {
    const record = options.storage.list().find(item => item.id === id); if (!record) return;
    if (!window.confirm(t("删除此本机反馈及其图像？服务器记录不会删除。", "Delete this local feedback and its images? Server records will remain."))) return;
    readFields(); setBusy(true); try { await options.storage.remove(record); if (state.id === id) { state.images.forEach(release); state.images = []; state.id = null; state.feature = ""; state.content = ""; } render(); status(t("本机反馈及图像已删除。", "Local feedback and images deleted.")); options.onSaved?.(); } catch (error) { status(error.message, true); } finally { setBusy(false); }
  }
  function handleClick(event) {
    const button = event.target.closest?.("[data-feedback-action]"); if (!button || !state || state.busy) return;
    event.preventDefault(); const action = button.dataset.feedbackAction;
    if (action === "close") close();
    else if (action === "upload") root().querySelector("#quickFeedbackImagePicker").click();
    else if (action === "capture") void captureScreen();
    else if (action === "save") void saveDraft();
    else if (action === "preview") void preview();
    else if (action === "submit") void submit();
    else if (action === "load") void loadDraft(button.dataset.id);
    else if (action === "delete") void deleteDraft(button.dataset.id);
    else { readFields(); invalidatePreview(); if (action === "select") state.selected = Number(button.dataset.index); if (action === "tool") state.tool = button.dataset.tool; if (action === "undo") currentImage()?.commands.pop(); if (action === "clear" && currentImage()) currentImage().commands = []; if (action === "remove") { release(currentImage()); state.images.splice(state.selected, 1); state.selected = Math.max(0, state.selected - 1); } render(); }
  }
  function handleKey(event) {
    if (!state) return; if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(root().querySelectorAll("button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),summary")).filter(node => node.getClientRects().length);
    if (!items.length) return; const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root().contains(document.activeElement))) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && (document.activeElement === last || !root().contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  function mount(configuration) { readFields(); if (options?.modalRoot) options.modalRoot.removeEventListener("click", handleClick); options = { ...configuration, storage: combineStorage(configuration.storage) }; root()?.addEventListener("click", handleClick); document.removeEventListener("keydown", handleKey, true); document.addEventListener("keydown", handleKey, true); if (state) render(); }
  function open(input = {}) { if (!root()) return; if (state) { root().querySelector("input")?.focus(); return; } returnFocus = document.activeElement; state = { source: ["settings", "login"].includes(input.source) ? input.source : "bubble", feature: "", content: "", page: location.pathname + location.hash, images: [], selected: 0, tool: "pen", color: "#d92d20", busy: false }; document.body.classList.add("feedback-open"); render(); root().querySelector("input[name=feature]")?.focus(); void capturePage(); }
  window.AuditFlowFeedback = { validateAttachment, serializeAnnotation, createRecord, mount, open, close };
  const loginRoot = document.getElementById?.("feedbackModalRoot");
  if (loginRoot) {
    mount({ modalRoot: loginRoot, language: () => document.querySelector?.("#authGate .auth-panel")?.lang || document.documentElement?.lang || "en", storage: loginStorage });
    const bubble = document.querySelector?.(".feedback-bubble");
    if (bubble) {
      bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/></svg>';
      bubble.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); open({ source: window.AuditFlowAuth?.authenticated ? "bubble" : "login" }); });
    }
  }
})();
