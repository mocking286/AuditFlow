(function () {
  "use strict";

  var LAYOUT_STORAGE_KEY = "auditflow-table-layouts-v6";
  var RATING_SCORE = { "N": 7.5, "P-": 23.75, "P": 32.5, "P+": 41.25, "L-": 58.75, "L": 67.5, "L+": 76.25, "F": 92.5 };
  var DEFAULT_WIDTHS = {
    "current-audit-status": [330, 150, 130, 120, 128, 105, 300, 112],
    "evidence-inventory": [105, 285, 170, 250, 145, 125, 155, 105],
    "versions": [145, 135, 300, 110, 130, 250],
    "close-reports": [140, 120, 160, 420],
    "conduct-assessment": [104, 740, 125, 98, 118],
    "trace-grid-assessment": [54, 450, 70, 75, 65],
    "helix-items": [220, 450, 175, 155, 260]
  };

  function english() {
    return !!(window.AuditFlowI18n && window.AuditFlowI18n.isEnglish && window.AuditFlowI18n.isEnglish());
  }

  function text(zh, en) {
    return english() ? en : zh;
  }

  function loadLayouts() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }

  function saveLayouts(layouts) {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts)); }
    catch (_) { /* A full browser store must not block audit work. */ }
  }

  function normaliseLayout(key, labels) {
    var all = loadLayouts();
    var current = all[key] || {};
    var fallback = DEFAULT_WIDTHS[key] || labels.map(function () { return 180; });
    var layout = {
      widths: labels.map(function (_, index) {
        return Math.max(72, Number((current.widths || [])[index] || fallback[index] || 180));
      }),
      visible: labels.map(function (_, index) {
        return (current.visible || [])[index] !== false;
      }),
      labels: labels.map(function (label, index) {
        return String((current.labels || [])[index] || label);
      })
    };
    return layout;
  }

  function persistLayout(key, layout) {
    var all = loadLayouts();
    all[key] = layout;
    saveLayouts(all);
  }

  function tableKey(table) {
    if (table.classList.contains("live-audit-table")) return "current-audit-status";
    if (table.classList.contains("evidence-inventory-table")) return "evidence-inventory";
    if (table.closest(".close-layout")) return "close-reports";
    var headings = Array.prototype.map.call(table.querySelectorAll("thead th"), function (cell) { return cell.textContent.trim(); }).join(" ");
    if (/版本|version/i.test(headings)) return "versions";
    return "";
  }

  function createButton(label, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "v6-column-config-button";
    button.textContent = label;
    return button;
  }

  function ensureTableShell(table) {
    var shell = table.closest(".live-table-wrap");
    if (shell) return shell;
    shell = document.createElement("div");
    shell.className = "live-table-wrap v6-table-wrap";
    table.parentNode.insertBefore(shell, table);
    shell.appendChild(table);
    return shell;
  }

  function labelNode(cell) {
    var node = cell.querySelector(":scope > .v6-column-title");
    if (node) return node;
    node = document.createElement("span");
    node.className = "v6-column-title";
    while (cell.firstChild) node.appendChild(cell.firstChild);
    cell.appendChild(node);
    return node;
  }

  function renderControls(host, key, labels, layout, apply) {
    var parent = host.parentElement;
    var existing = parent.querySelector(":scope > .v6-table-tools[data-v6-layout-key='" + key + "']");
    if (existing) return existing;
    var tools = document.createElement("div");
    tools.className = "v6-table-tools";
    tools.dataset.v6LayoutKey = key;
    var button = createButton("", "v6-column-config-button");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
    button.title = text("列设置", "Column settings");
    button.setAttribute("aria-label", button.title);
    button.dataset.v6ColumnMenu = key;
    button.setAttribute("aria-expanded", "false");
    var panel = document.createElement("div");
    panel.className = "v6-column-menu";
    panel.hidden = true;
    panel.dataset.v6ColumnPanel = key;

    labels.forEach(function (label, index) {
      var row = document.createElement("div");
      row.className = "v6-column-menu-row";
      var toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = layout.visible[index];
      toggle.dataset.v6ColumnVisibility = String(index);
      toggle.dataset.v6LayoutKey = key;
      toggle.addEventListener("change", function () {
        var visibleCount = layout.visible.filter(Boolean).length;
        if (!toggle.checked && visibleCount <= 1) {
          toggle.checked = true;
          return;
        }
        layout.visible[index] = toggle.checked;
        persistLayout(key, layout);
        apply();
      });
      var title = document.createElement("input");
      title.type = "text";
      title.value = layout.labels[index] || label;
      title.setAttribute("aria-label", text("列标题", "Column title"));
      title.dataset.v6ColumnLabel = String(index);
      title.addEventListener("change", function () {
        layout.labels[index] = title.value.trim() || label;
        persistLayout(key, layout);
        apply();
      });
      row.appendChild(toggle);
      row.appendChild(title);
      panel.appendChild(row);
    });
    var reset = createButton(text("恢复默认", "Reset defaults"), "v6-column-reset");
    reset.dataset.v6ColumnReset = key;
    reset.addEventListener("click", function () {
      var all = loadLayouts();
      delete all[key];
      saveLayouts(all);
      var fresh = normaliseLayout(key, labels);
      layout.widths = fresh.widths;
      layout.visible = fresh.visible;
      layout.labels = fresh.labels;
      apply();
      tools.remove();
      renderControls(host, key, labels, layout, apply);
    });
    panel.appendChild(reset);
    tools.appendChild(button);
    tools.appendChild(panel);
    parent.insertBefore(tools, host);
    return tools;
  }

  function attachResizer(cell, key, layout, index, apply) {
    if (cell.querySelector(":scope > .v6-column-resizer")) return;
    var handle = document.createElement("span");
    handle.className = "v6-column-resizer";
    handle.title = text("拖动调整列宽", "Drag to resize column");
    handle.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var startX = event.clientX;
      var startWidth = layout.widths[index];
      var move = function (moveEvent) {
        layout.widths[index] = Math.max(72, Math.min(1200, startWidth + moveEvent.clientX - startX));
        apply();
      };
      var finish = function () {
        persistLayout(key, layout);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
    });
    cell.appendChild(handle);
  }

  function enhanceTable(table) {
    var key = tableKey(table);
    if (!key) return;
    var headers = Array.prototype.slice.call(table.querySelectorAll("thead th"));
    if (!headers.length) return;
    var labels = headers.map(function (header) {
      return header.dataset.v6OriginalLabel || header.textContent.trim();
    });
    headers.forEach(function (header, index) {
      header.dataset.v6OriginalLabel = labels[index];
    });
    var layout = normaliseLayout(key, labels);
    var shell = ensureTableShell(table);
    var apply = function () {
      var group = table.querySelector(":scope > colgroup");
      if (!group) {
        group = document.createElement("colgroup");
        table.insertBefore(group, table.firstChild);
      }
      while (group.children.length < headers.length) group.appendChild(document.createElement("col"));
      Array.prototype.slice.call(group.children).forEach(function (column, index) {
        column.style.width = layout.visible[index] ? layout.widths[index] + "px" : "0px";
      });
      table.style.tableLayout = "fixed";
      table.style.minWidth = layout.visible.reduce(function (total, visible, index) {
        return total + (visible ? layout.widths[index] : 0);
      }, 0) + "px";
      headers.forEach(function (header, index) {
        var title = labelNode(header);
        title.textContent = layout.labels[index] || labels[index];
        header.classList.toggle("v6-column-hidden", !layout.visible[index]);
        attachResizer(header, key, layout, index, apply);
      });
      Array.prototype.slice.call(table.querySelectorAll("tbody tr")).forEach(function (row) {
        Array.prototype.slice.call(row.cells).forEach(function (cell, index) {
          if (cell.colSpan > 1) return;
          cell.classList.toggle("v6-column-hidden", !layout.visible[index]);
        });
      });
    };
    apply();
    renderControls(shell, key, labels, layout, apply);
  }

  function enhanceGrid(grid, key) {
    var header = grid.querySelector(":scope > .assessment-grid-head, :scope > .helix-grid-head");
    if (!header) return;
    var heads = Array.prototype.slice.call(header.children);
    if (!heads.length) return;
    var labels = heads.map(function (cell) {
      return cell.dataset.v6OriginalLabel || cell.textContent.trim();
    });
    heads.forEach(function (cell, index) {
      cell.dataset.v6OriginalLabel = labels[index];
    });
    var layout = normaliseLayout(key, labels);
    var apply = function () {
      var columns = layout.visible.reduce(function (parts, visible, index) {
        if (visible) parts.push(layout.widths[index] + "px");
        return parts;
      }, []);
      var template = columns.join(" ");
      grid.style.gridTemplateColumns = template;
      grid.style.minWidth = columns.reduce(function (sum, value) { return sum + Number(value.replace("px", "")); }, 0) + "px";
      [header].concat(Array.prototype.slice.call(grid.querySelectorAll(":scope > .assessment-grid-row, :scope > .helix-grid-row"))).forEach(function (row) {
        row.style.gridTemplateColumns = template;
        Array.prototype.slice.call(row.children).forEach(function (cell, index) {
          cell.classList.toggle("v6-column-hidden", !layout.visible[index]);
        });
      });
      heads.forEach(function (cell, index) {
        var title = labelNode(cell);
        title.textContent = layout.labels[index] || labels[index];
        attachResizer(cell, key, layout, index, apply);
      });
    };
    apply();
    var host = grid.parentElement;
    renderControls(host, key, labels, layout, apply);
  }

  function prepareHelixLists() {
    Array.prototype.slice.call(document.querySelectorAll(".helix-row-list")).forEach(function (list) {
      if (list.dataset.v6Prepared === "true") return;
      var rows = Array.prototype.slice.call(list.querySelectorAll(":scope > .helix-item-row"));
      if (!rows.length) return;
      var grid = document.createElement("div");
      grid.className = "helix-grid-table";
      grid.dataset.v6Grid = "helix";
      var head = document.createElement("div");
      head.className = "helix-grid-head";
      ["Tag", "Summary", "REQ/RE/TASK Type", "Status", "Document List"].forEach(function (label) {
        var cell = document.createElement("span");
        cell.textContent = label;
        head.appendChild(cell);
      });
      grid.appendChild(head);
      rows.forEach(function (row) {
        var check = row.querySelector("button.helix-row-check");
        var meta = row.querySelector("div");
        var summary = row.querySelector("p");
        var status = row.querySelector("span");
        var tag = meta && meta.querySelector("strong") ? meta.querySelector("strong").textContent.trim() : "—";
        var kind = meta && meta.querySelector("small") ? meta.querySelector("small").textContent.trim() : "—";
        var summaryText = summary ? summary.textContent.trim() : "—";
        var statusText = status ? status.textContent.trim() : "—";
        var suppliedDetail = null;
        try { suppliedDetail = JSON.parse(row.dataset.v6HelixDetail || "null"); } catch (_) { suppliedDetail = null; }
        var documentText = suppliedDetail && suppliedDetail.documents ? suppliedDetail.documents : (/attachment|link|file|document/i.test(statusText) ? statusText : text("未返回文档清单", "No document list returned"));
        row.className = "helix-grid-row";
        row.tabIndex = 0;
        row.title = text("双击查看 Helix 条目详情", "Double-click to inspect this Helix item");
        row._v6HelixDetail = suppliedDetail || { tag: tag, summary: summaryText, kind: kind, status: statusText, documents: documentText, fields: [] };
        row.replaceChildren();
        var tagCell = document.createElement("div");
        tagCell.className = "helix-grid-tag";
        if (check) tagCell.appendChild(check);
        var tagText = document.createElement("div");
        var tagStrong = document.createElement("strong");
        tagStrong.textContent = tag;
        var tagSmall = document.createElement("small");
        tagSmall.textContent = kind;
        tagText.appendChild(tagStrong);
        tagText.appendChild(tagSmall);
        tagCell.appendChild(tagText);
        var summaryCell = document.createElement("p");
        summaryCell.textContent = summaryText;
        var typeCell = document.createElement("span");
        typeCell.textContent = kind;
        var statusCell = document.createElement("span");
        statusCell.textContent = statusText;
        var docsCell = document.createElement("span");
        docsCell.textContent = documentText;
        docsCell.title = documentText;
        row.appendChild(tagCell);
        row.appendChild(summaryCell);
        row.appendChild(typeCell);
        row.appendChild(statusCell);
        row.appendChild(docsCell);
        grid.appendChild(row);
      });
      list.replaceChildren(grid);
      list.dataset.v6Prepared = "true";
    });
  }

  function openHelixDetail(row) {
    var detail = row._v6HelixDetail;
    if (!detail) return;
    var root = document.getElementById("modalRoot");
    if (!root) return;
    root.replaceChildren();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var modal = document.createElement("section");
    modal.className = "modal wide";
    var header = document.createElement("header");
    header.className = "modal-head";
    var title = document.createElement("h2");
    title.textContent = "Helix element · " + detail.tag;
    var close = createButton("×", "close-btn");
    close.setAttribute("aria-label", text("关闭", "Close"));
    close.addEventListener("click", function () { root.replaceChildren(); });
    header.appendChild(title);
    header.appendChild(close);
    var body = document.createElement("div");
    body.className = "modal-body";
    var table = document.createElement("table");
    table.className = "data-table v6-detail-table";
    var thead = document.createElement("thead");
    var headerRow = document.createElement("tr");
    ["Field", "Value"].forEach(function (value) {
      var cell = document.createElement("th");
      cell.textContent = value;
      headerRow.appendChild(cell);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var details = [["Tag", detail.tag], ["Summary", detail.summary], ["REQ/RE/TASK Type", detail.kind], ["Status", detail.status], ["Document List", detail.documents], ["Links", detail.links || 0], ["Attachments", detail.attachments || 0], ["Events", detail.events || 0], ["Folders", detail.folders || 0]];
    (detail.fields || []).forEach(function (field) { details.push([field.label || "Field", field.value || "—"]); });
    details.forEach(function (pair) {
      var tr = document.createElement("tr");
      var field = document.createElement("td");
      field.textContent = pair[0];
      var value = document.createElement("td");
      value.textContent = pair[1];
      tr.appendChild(field);
      tr.appendChild(value);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    modal.appendChild(header);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) root.replaceChildren();
    });
    root.appendChild(backdrop);
  }

  function injectProjectDeleteButtons() {
    Array.prototype.slice.call(document.querySelectorAll(".live-audit-table tbody tr")).forEach(function (row) {
      if (row.querySelector("[data-v6-delete-project],[data-action='soft-delete-project']")) return;
      var idNode = row.querySelector("td small");
      var match = idNode && idNode.textContent.match(/([A-Z]+-\d{4}-\d+)/);
      if (!match) return;
      var actions = row.lastElementChild;
      if (!actions || actions.tagName !== "TD") return;
      var button = createButton("", "action-icon v6-delete-project");
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      button.dataset.v6DeleteProject = match[1];
      button.title = text("删除项目", "Delete project");
      button.setAttribute("aria-label", button.title);
      var box = actions.querySelector(".row-actions");
      if (!box) {
        box = document.createElement("div");
        box.className = "row-actions";
        Array.prototype.slice.call(actions.querySelectorAll(":scope > button")).forEach(function (existing) { box.appendChild(existing); });
        actions.appendChild(box);
      }
      box.appendChild(button);
    });
  }

  function removeDashboardWorkflowFunnel() {
    Array.prototype.slice.call(document.querySelectorAll(".live-workflow-panel")).forEach(function (panel) { panel.remove(); });
  }

  function injectVersionCompareButtons() {
    Array.prototype.slice.call(document.querySelectorAll("table")).forEach(function (table) {
      if (tableKey(table) !== "versions") return;
      Array.prototype.slice.call(table.querySelectorAll("button[data-action='preview-run']")).forEach(function (button) {
        var parent = button.parentElement;
        if (parent.querySelector("[data-v6-compare-run]")) return;
        var compare = createButton(text("与当前比较", "Compare to current"), "btn secondary sm");
        compare.dataset.v6CompareRun = button.dataset.id || "";
        parent.appendChild(compare);
      });
    });
  }

  function relabelTraceProjectCheck() {
    Array.prototype.slice.call(document.querySelectorAll("[data-action='trace-ai-project']")).forEach(function (button) {
      var label = text("AL 项目追溯检查", "AL Project Traceability Check");
      if (button.dataset.v63TraceLabel === label) return;
      button.dataset.v63TraceLabel = label;
      button.textContent = "✦ " + label;
      button.setAttribute("aria-label", label);
    });
  }

  function projectFromRoute() {
    var parts = location.hash.replace(/^#\//, "").split("/");
    if (parts[0] !== "standard" || !parts[1]) return null;
    try {
      var workspace = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "{}");
      return (workspace.standardProjects || []).find(function (project) { return project.id === parts[1]; }) || null;
    } catch (_) { return null; }
  }

  function rating(score) {
    return Object.keys(RATING_SCORE).reduce(function (best, candidate) {
      return Math.abs(RATING_SCORE[candidate] - score) < Math.abs(RATING_SCORE[best] - score) ? candidate : best;
    }, "N");
  }

  function openVersionComparison(runId) {
    var project = projectFromRoute();
    if (!project || !Array.isArray(project.runs) || project.runs.length < 2) return;
    var current = project.runs[0];
    var compared = project.runs.find(function (run) { return run.id === runId; });
    if (!compared || compared.id === current.id) return;
    var before = new Map((compared.assessments || []).map(function (item) { return [String(item.process) + "|" + String(item.code), item]; }));
    var after = new Map((current.assessments || []).map(function (item) { return [String(item.process) + "|" + String(item.code), item]; }));
    var keys = new Set(Array.from(before.keys()).concat(Array.from(after.keys())));
    var changes = [];
    keys.forEach(function (key) {
      var oldItem = before.get(key);
      var newItem = after.get(key);
      var oldScore = oldItem ? RATING_SCORE[oldItem.rating] || 0 : 0;
      var newScore = newItem ? RATING_SCORE[newItem.rating] || 0 : 0;
      if (oldItem && newItem && oldScore === newScore) return;
      changes.push({ item: newItem || oldItem, before: oldItem ? oldItem.rating : "—", after: newItem ? newItem.rating : "—", delta: newScore - oldScore });
    });
    changes.sort(function (a, b) { return a.delta - b.delta; });
    var improved = changes.filter(function (item) { return item.delta > 0; }).length;
    var regressed = changes.filter(function (item) { return item.delta < 0; }).length;
    var remaining = (current.assessments || []).filter(function (item) { return (RATING_SCORE[item.rating] || 0) < 50; });
    var root = document.getElementById("modalRoot");
    if (!root) return;
    root.replaceChildren();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var modal = document.createElement("section");
    modal.className = "modal wide";
    var head = document.createElement("header");
    head.className = "modal-head";
    var heading = document.createElement("h2");
    heading.textContent = text("版本差异与剩余差距", "Version difference and remaining gaps") + " · " + compared.id + " → " + current.id;
    var close = createButton("×", "close-btn");
    close.addEventListener("click", function () { root.replaceChildren(); });
    head.appendChild(heading);
    head.appendChild(close);
    var body = document.createElement("div");
    body.className = "modal-body";
    var metrics = document.createElement("div");
    metrics.className = "v6-compare-metrics";
    [[text("总体评分", "Overall rating"), compared.assessments ? rating((compared.assessments.reduce(function (sum, item) { return sum + (RATING_SCORE[item.rating] || 0); }, 0) / Math.max(1, compared.assessments.length))) : "—", current.assessments ? rating((current.assessments.reduce(function (sum, item) { return sum + (RATING_SCORE[item.rating] || 0); }, 0) / Math.max(1, current.assessments.length))) : "—"],
      [text("改善项", "Improved"), String(improved), text("项", " items")],
      [text("回退项", "Regressed"), String(regressed), text("项", " items")],
      [text("仍需关闭", "Remaining gaps"), String(remaining.length), text("项 BP/GP", " BP/GP items")]].forEach(function (item) {
      var card = document.createElement("article");
      var label = document.createElement("span");
      label.textContent = item[0];
      var value = document.createElement("strong");
      value.textContent = item[1] + (item[2] ? " → " + item[2] : "");
      card.appendChild(label);
      card.appendChild(value);
      metrics.appendChild(card);
    });
    body.appendChild(metrics);
    var note = document.createElement("p");
    note.className = "v6-compare-note";
    note.textContent = text("剩余差距按当前版本中低于 L- 的 BP/GP 统计；请将评分变化与相关证据、评估师记录和未关闭弱项一起复核。", "Remaining gaps are current BP/GP items below L-. Review every change together with linked evidence, assessor records, and open weaknesses.");
    body.appendChild(note);
    var operationSection = document.createElement("section");
    operationSection.className = "v6-version-operations";
    var operationHeading = document.createElement("h3");
    operationHeading.textContent = text("版本中的用户操作", "User operations in these versions");
    operationSection.appendChild(operationHeading);
    [compared, current].forEach(function (run) {
      var group = document.createElement("article");
      var title = document.createElement("strong");
      title.textContent = text("版本 ", "Version ") + String(run.version || "") + " · " + (run.source === "aspice-audit-master" ? "aspice-audit-master" : text("评估记录", "assessment record"));
      group.appendChild(title);
      var operations = Array.isArray(run.operations) ? run.operations : [];
      if (!operations.length) {
        var empty = document.createElement("p");
        empty.textContent = text("旧版本未保存操作快照。", "No operation snapshot was stored for this legacy version.");
        group.appendChild(empty);
      } else {
        var list = document.createElement("ul");
        operations.forEach(function (operation) {
          var item = document.createElement("li");
          item.textContent = [operation.date ? new Date(operation.date).toLocaleString() : "", operation.action || text("操作", "Operation"), operation.detail || operation.comment || ""].filter(Boolean).join(" · ");
          list.appendChild(item);
        });
        group.appendChild(list);
      }
      operationSection.appendChild(group);
    });
    body.appendChild(operationSection);
    var table = document.createElement("table");
    table.className = "data-table v6-compare-table";
    var thead = document.createElement("thead");
    var tr = document.createElement("tr");
    [text("指标", "Indicator"), text("旧版本", "Earlier"), text("当前版本", "Current"), text("变化", "Change")].forEach(function (value) {
      var th = document.createElement("th");
      th.textContent = value;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    changes.forEach(function (change) {
      var row = document.createElement("tr");
      [String(change.item.process || "") + " · " + String(change.item.code || "") + " " + String(change.item.title || ""),
        change.before,
        change.after,
        (change.delta > 0 ? "+" : "") + Math.round(change.delta) + " " + (change.delta > 0 ? text("改善", "improved") : change.delta < 0 ? text("回退", "regressed") : text("新增/移除", "added/removed"))].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    if (!changes.length) {
      var noChange = document.createElement("tr");
      var cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = text("两个版本的 BP/GP 评分一致。", "The BP/GP ratings are unchanged between these versions.");
      noChange.appendChild(cell);
      tbody.appendChild(noChange);
    }
    table.appendChild(tbody);
    body.appendChild(table);
    modal.appendChild(head);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) root.replaceChildren();
    });
    root.appendChild(backdrop);
  }

  function handleDocumentClick(event) {
    var menu = event.target.closest("[data-v6-column-menu]");
    if (menu) {
      var panel = menu.parentElement.querySelector("[data-v6-column-panel]");
      var next = panel.hidden;
      document.querySelectorAll(".v6-column-menu").forEach(function (candidate) { candidate.hidden = true; });
      document.querySelectorAll("[data-v6-column-menu]").forEach(function (candidate) { candidate.setAttribute("aria-expanded", "false"); });
      panel.hidden = !next;
      menu.setAttribute("aria-expanded", String(next));
      return;
    }
    if (!event.target.closest(".v6-table-tools")) {
      document.querySelectorAll(".v6-column-menu").forEach(function (panel) { panel.hidden = true; });
      document.querySelectorAll("[data-v6-column-menu]").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
    }
    var deleteButton = event.target.closest("[data-v6-delete-project]");
    if (deleteButton) {
      var projectId = deleteButton.dataset.v6DeleteProject;
      if (typeof window.AuditFlowSoftDeleteProject === "function") window.AuditFlowSoftDeleteProject(projectId);
      else window.alert(text("删除失败：AuditFlow 工作区尚未准备好。", "Deletion failed: the AuditFlow workspace is not ready."));
      return;
    }
    var compare = event.target.closest("[data-v6-compare-run]");
    if (compare) openVersionComparison(compare.dataset.v6CompareRun);
  }

  function handleDoubleClick(event) {
    var row = event.target.closest(".helix-grid-row");
    if (row && !event.target.closest("button")) openHelixDetail(row);
  }

  var scheduled = false;
  function enhance() {
    scheduled = false;
    prepareHelixLists();
    Array.prototype.slice.call(document.querySelectorAll("table")).forEach(enhanceTable);
    Array.prototype.slice.call(document.querySelectorAll(".assessment-grid-table")).forEach(function (grid) { enhanceGrid(grid, grid.closest(".trace-grid-workbench") ? "trace-grid-assessment" : "conduct-assessment"); });
    Array.prototype.slice.call(document.querySelectorAll(".helix-grid-table")).forEach(function (grid) { enhanceGrid(grid, "helix-items"); });
    injectProjectDeleteButtons();
    injectVersionCompareButtons();
    relabelTraceProjectCheck();
    removeDashboardWorkflowFunnel();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  }

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("dblclick", handleDoubleClick);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
  else schedule();
}());
