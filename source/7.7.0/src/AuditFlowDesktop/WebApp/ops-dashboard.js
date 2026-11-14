(() => {
  "use strict";

  const dashboard = document.getElementById("dashboard");
  const accessMessage = document.getElementById("accessMessage");
  const status = document.getElementById("opsStatus");
  const refreshLabel = document.getElementById("lastRefresh");
  let timer = null;
  let stopped = false;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
  }

  function shortTime(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function api(pathname) {
    const response = await fetch(pathname, { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  function renderMetrics(summary) {
    const items = [
      ["注册用户", summary.registeredUsers],
      ["5 分钟活跃", summary.activeUsers5m],
      ["当前会话", summary.activeSessions],
      ["24 小时事件", summary.events24h],
      ["待处理意见", summary.feedbackNew],
      ["平均评分", summary.averageRating ? `${summary.averageRating} / 5` : "—"]
    ];
    document.getElementById("metrics").innerHTML = items.map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
  }

  function renderBars(items) {
    const maximum = Math.max(1, ...items.map(item => Number(item.count || 0)));
    document.getElementById("eventBars").innerHTML = items.length
      ? items.map(item => `<div class="event-bar"><span class="label" title="${escapeHtml(item.event)}">${escapeHtml(item.event)}</span><span class="track"><span class="fill" style="width:${Math.max(4, Number(item.count || 0) / maximum * 100)}%"></span></span><strong>${escapeHtml(item.count)}</strong></div>`).join("")
      : `<div class="empty-row">暂无使用事件</div>`;
  }

  function renderFeedback(items) {
    document.getElementById("feedbackCount").textContent = `${items.length} 条`;
    document.getElementById("feedbackBody").innerHTML = items.length
      ? items.map(item => `<tr><td>${escapeHtml(shortTime(item.timestamp))}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.category)}</td><td class="rating">${"★".repeat(Number(item.rating || 0))}</td><td class="message-cell">${escapeHtml(item.message)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-row">暂无用户意见</td></tr>`;
  }

  function renderActivity(items) {
    document.getElementById("activityBody").innerHTML = items.length
      ? items.slice(0, 60).map(item => `<tr><td>${escapeHtml(shortTime(item.timestamp))}</td><td>${escapeHtml(item.event)}</td><td>${escapeHtml(item.page || "—")}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty-row">暂无活动</td></tr>`;
  }

  function renderPaths(summary) {
    document.getElementById("dataPaths").innerHTML = `<div class="form-field"><label>运营数据</label><textarea readonly>${escapeHtml(summary.dataRoot)}</textarea></div><div class="form-field"><label>发布目录</label><textarea readonly>${escapeHtml(summary.releaseRoot)}</textarea></div>`;
  }

  async function refresh() {
    try {
      const session = await api("./api/v1/auth/session");
      if (!session.authenticated || session.user?.role !== "admin") {
        throw Object.assign(new Error(session.authenticated ? "当前账户没有管理员权限。" : "请先登录管理员账户。"), { status: 403 });
      }
      const [summary, feedback, activity] = await Promise.all([
        api("./api/v1/admin/summary"),
        api("./api/v1/admin/feedback"),
        api("./api/v1/admin/activity")
      ]);
      dashboard.hidden = false;
      accessMessage.hidden = true;
      status.textContent = "实时监控";
      status.classList.add("online");
      refreshLabel.textContent = `最后刷新：${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      renderMetrics(summary);
      renderBars(summary.topEvents || []);
      renderFeedback(feedback || []);
      renderActivity(activity || []);
      renderPaths(summary);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        dashboard.hidden = true;
        accessMessage.hidden = false;
        document.getElementById("accessText").textContent = error.message;
        status.textContent = "需要登录";
        status.classList.remove("online");
        stopped = true;
        window.clearTimeout(timer);
      } else {
        status.textContent = "刷新失败";
        status.classList.remove("online");
      }
    }
  }

  function scheduleRefresh(delay = 5_000) {
    window.clearTimeout(timer);
    if (stopped || document.visibilityState !== "visible") return;
    timer = window.setTimeout(async () => {
      await refresh();
      scheduleRefresh();
    }, delay);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || stopped) return;
    refresh().finally(() => scheduleRefresh());
  });

  refresh().finally(() => scheduleRefresh());
})();
