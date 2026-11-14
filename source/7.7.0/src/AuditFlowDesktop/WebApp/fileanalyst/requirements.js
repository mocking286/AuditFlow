const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requestConfirmation(message) {
  return new Promise(resolve => {
    document.querySelector(".fa-dialog-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "fa-dialog-backdrop";
    backdrop.innerHTML = `<section class="fa-dialog" role="dialog" aria-modal="true" aria-labelledby="fa-confirm-title"><form><div class="fa-dialog-header"><h2 id="fa-confirm-title">Confirm action</h2><button type="button" class="fa-dialog-close" data-dialog-cancel aria-label="Close">×</button></div><p class="fa-dialog-message">${escapeHtml(message)}</p><div class="fa-dialog-actions"><button type="button" class="tool-button" data-dialog-cancel>Cancel</button><button type="submit" class="tool-button primary-tool">Confirm</button></div></form></section>`;
    document.body.append(backdrop);
    const finish = result => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.querySelector("form").onsubmit = event => { event.preventDefault(); finish(true); };
    backdrop.querySelectorAll("[data-dialog-cancel]").forEach(button => { button.onclick = () => finish(false); });
    backdrop.onclick = event => { if (event.target === backdrop) finish(false); };
    backdrop.querySelector("[type='submit']").focus();
  });
}

export async function mountRequirements(root, api) {
  let data, validation, selected = "", documentId = "", search = "", message = "", busy = false;
  async function load() {
    [data, validation] = await Promise.all([api("/api/requirements"), api("/api/requirements/validate")]);
    documentId ||= data.documents[0]?.id || "";
  }
  async function act(input) {
    if (busy) return;
    busy = true;
    root.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      await api("/api/requirements", { method: "POST", body: JSON.stringify({ ...input, revision: data.revision }) });
      message = "Saved. Human approval and formal audit ratings are unchanged.";
      await load(); render();
    } catch (error) { message = error.message; const status = root.querySelector("[role=status]"); if (status) status.textContent = message; }
    finally { busy = false; root.querySelectorAll("button").forEach(button => { button.disabled = false; }); }
  }
  function render() {
    if (!root.isConnected) return;
    const record = data.items.find(item => item.id === selected);
    const visible = data.items.filter(item => (!documentId || item.documentId === documentId) && `${item.id} ${item.title} ${item.body}`.toLowerCase().includes(search.toLowerCase()));
    root.innerHTML = `<section class="rm-workspace">
      <header class="rm-heading"><div><small>FILEANALYST 6.5.0 · REQUIREMENTS ENGINEERING</small><h1>Controlled requirements</h1><p>Document hierarchy · stable IDs · human review · change impact</p></div><div class="rm-tools"><button data-rm="refresh">Validate / refresh</button><button data-rm="import">Import YAML</button><button data-rm="bundle">Import bundle</button><button data-rm="export">Export YAML bundle</button><button data-rm="publish">Publish Markdown</button></div></header>
      <p class="rm-status" role="status">${escapeHtml(message || "Review confirms requirement content only; it does not approve an ASPICE rating.")}</p>
      <div class="rm-summary"><span><b>${data.items.length}</b> Requirements</span><span><b>${data.documents.length}</b> Documents</span><span><b>${validation.counts.errors}</b> Errors</span><span><b>${validation.counts.warnings}</b> Review actions</span><span>Revision ${data.revision}</span></div>
      <div class="rm-grid"><aside class="rm-documents"><h2>Document tree</h2><button data-document="">All documents</button>${data.documents.map(doc => `<button data-document="${escapeHtml(doc.id)}" aria-pressed="${doc.id === documentId}"><strong>${escapeHtml(doc.id)}</strong> ${escapeHtml(doc.title)}<small>${doc.parent ? `↑ ${escapeHtml(doc.parent)}` : "Root document"}</small></button>`).join("")}
      <form id="rm-document"><h3>New document</h3><label>Prefix<input name="id" required pattern="[A-Za-z][A-Za-z0-9_-]{0,79}" placeholder="SWR"></label><label>Title<input name="title" required></label><label>Parent<select name="parent"><option value="">Root</option>${data.documents.map(doc => `<option>${escapeHtml(doc.id)}</option>`).join("")}</select></label><button>Create document</button></form></aside>
      <section class="rm-items"><div class="rm-tools"><input id="rm-search" aria-label="Search requirements" placeholder="Search ID or requirement text" value="${escapeHtml(search)}"><button data-rm="new">New requirement</button></div><div class="rm-list">${visible.map(item => `<button data-requirement="${escapeHtml(item.id)}" aria-pressed="${item.id === selected}"><strong>${escapeHtml(item.id)} <small>v${item.version}</small></strong><span>${escapeHtml(item.title)}</span><small>${item.reviewCurrent ? "Reviewed" : "Review needed"} · ${item.suspectParents.length} suspect links</small></button>`).join("") || "<p>No requirements in this document.</p>"}</div>
      <form id="rm-item"><h2>${record ? escapeHtml(record.id) : "New requirement"}</h2><label>Document<select name="documentId" ${record ? "disabled" : ""}>${data.documents.map(doc => `<option value="${escapeHtml(doc.id)}" ${doc.id === (record?.documentId || documentId) ? "selected" : ""}>${escapeHtml(doc.id)} · ${escapeHtml(doc.title)}</option>`).join("")}</select></label><label>Title<input name="title" required maxlength="240" value="${escapeHtml(record?.title)}"></label><label>Requirement text<textarea name="body" required rows="5">${escapeHtml(record?.body)}</textarea></label><label>Verification method and acceptance criteria<textarea name="verification" rows="3">${escapeHtml(record?.verification)}</textarea></label><label>Rationale<textarea name="rationale" rows="2">${escapeHtml(record?.rationale)}</textarea></label><label>Parent requirement IDs (comma separated)<input name="parents" value="${escapeHtml(record?.parents.join(", "))}" placeholder="REQ001, REQ002"></label><div class="rm-tools"><button>${record ? "Save new revision" : "Create requirement"}</button>${record ? '<button type="button" data-rm="review">Confirm human review</button><button type="button" data-rm="clear">Confirm parent links</button>' : ""}</div></form>
      ${record ? `<details><summary>Revision history · ${record.history?.length || 0}</summary>${(record.history || []).map(entry => `<p>v${entry.version} · ${escapeHtml(entry.changedAt)} · ${escapeHtml(entry.changedBy)}<br>${escapeHtml(entry.body)}</p>`).join("")}</details>` : ""}</section>
      <aside class="rm-validation"><h2>Validation & impact</h2>${validation.issues.map(issue => `<div class="rm-issue ${issue.severity}"><strong>${escapeHtml(issue.id || issue.code)}</strong><p>${escapeHtml(issue.message)}</p></div>`).join("") || "<p>No validation issues.</p>"}<h3>Trace matrix</h3>${data.items.map(item => `<p><strong>${escapeHtml(item.id)}</strong> → ${escapeHtml(item.parents.join(", ") || "Root")}<br><small>Used by: ${escapeHtml(data.items.filter(child => child.parents.includes(item.id)).map(child => child.id).join(", ") || "—")}</small></p>`).join("")}<form id="rm-baseline"><h3>Freeze reviewed snapshot</h3><input name="title" aria-label="Baseline name" placeholder="Baseline name" required><button>Freeze baseline</button></form><small>Blocked while validation or review actions remain. Snapshots are not formal approvals.</small></aside></div></section>`;
    root.querySelectorAll("[data-document]").forEach(button => { button.onclick = () => { documentId = button.dataset.document; selected = ""; render(); }; });
    root.querySelectorAll("[data-requirement]").forEach(button => { button.onclick = () => { selected = button.dataset.requirement; render(); }; });
    root.querySelector("#rm-search").onchange = event => { search = event.target.value; render(); };
    root.querySelector("#rm-document").onsubmit = event => { event.preventDefault(); act({ action: "document", ...Object.fromEntries(new FormData(event.target)) }); };
    root.querySelector("#rm-item").onsubmit = event => {
      event.preventDefault(); const input = Object.fromEntries(new FormData(event.target));
      act({ ...input, action: record ? "edit" : "create", id: record?.id, parents: input.parents.split(",").map(value => value.trim()).filter(Boolean) });
    };
    root.querySelector("#rm-baseline").onsubmit = event => { event.preventDefault(); act({ action: "baseline", ...Object.fromEntries(new FormData(event.target)) }); };
    root.querySelectorAll("[data-rm]").forEach(button => { button.onclick = async () => {
      try {
        const action = button.dataset.rm;
        if (action === "new") { selected = ""; render(); return; }
        if (action === "refresh") { await load(); render(); return; }
        if (action === "review" || action === "clear") {
          if (await requestConfirmation(action === "review" ? "Confirm you personally reviewed this exact requirement revision?" : "Confirm you reviewed all current parent requirements and their impact?")) await act({ action, id: selected });
          return;
        }
        if (action === "export" || action === "publish") {
          const bundle = await api("/api/requirements/export");
          if (action === "export") download("FileAnalyst-6.5.0-doorstop-bundle.json", JSON.stringify(bundle, null, 2));
          else download("requirements.md", `# Requirements · revision ${data.revision}\n\nCandidate engineering content; formal approval remains with authorized reviewers.\n\n` + data.items.map(item => `## ${item.id} — ${item.title}\n\n${item.body}\n\nVerification: ${item.verification || "Not defined"}\n\nParents: ${item.parents.join(", ") || "Root"}\n`).join("\n"), "text/markdown");
          return;
        }
        const picker = document.createElement("input"); picker.type = "file";
        if (action === "import") { picker.multiple = true; picker.webkitdirectory = true; } else picker.accept = ".json";
        picker.onchange = async () => {
          try {
            const selectedFiles = Array.from(picker.files || []);
            if (!selectedFiles.length) return;
            if (selectedFiles.reduce((total, file) => total + file.size, 0) > 10000000) throw new Error("Import exceeds 10 MB");
            let files;
            if (action === "bundle") {
              const bundle = JSON.parse(await selectedFiles[0].text());
              if (bundle.schema !== "fileanalyst.doorstop-bundle/1") throw new Error("Unsupported bundle");
              files = bundle.files;
            } else files = await Promise.all(selectedFiles.filter(file => /\.ya?ml$/i.test(file.name)).map(async file => ({ path: file.webkitRelativePath || file.name, content: await file.text() })));
            if (await requestConfirmation(`Import ${files.length} YAML files as unreviewed engineering content? Existing IDs are never overwritten.`)) await act({ action: "import", files });
          } catch (error) { message = error.message; render(); }
        };
        picker.click();
      } catch (error) { message = error.message; render(); }
    }; });
  }
  try { await load(); render(); } catch (error) { root.textContent = `Requirements unavailable: ${error.message}`; }
}
