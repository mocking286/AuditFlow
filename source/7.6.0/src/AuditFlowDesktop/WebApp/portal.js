(() => {
  "use strict";

  const grid = document.getElementById("releaseGrid");
  const status = document.getElementById("serviceStatus");
  const timestamp = document.getElementById("releaseTimestamp");
  const labels = {
    windows: { title: "Windows 桌面程序", short: "WIN" },
    browser: { title: "浏览器插件", short: "WEB" },
    "codex-plugin": { title: "Codex 本地插件", short: "MCP" }
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
  }

  function bytes(value) {
    const number = Number(value || 0);
    if (!number) return "—";
    if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(2)} GB`;
    if (number >= 1024 ** 2) return `${(number / 1024 ** 2).toFixed(1)} MB`;
    return `${(number / 1024).toFixed(1)} KB`;
  }

  function card(release) {
    const identity = labels[release.channel] || { title: release.channel, short: "FILE" };
    const published = release.publishedAt ? new Date(release.publishedAt).toLocaleString("zh-CN", { hour12: false }) : "—";
    return `<article class="release-card">
      <div class="release-card-head"><h3>${escapeHtml(identity.title)}</h3><span class="channel">${escapeHtml(identity.short)}</span></div>
      <div class="release-meta">
        <span>版本</span><strong>${escapeHtml(release.version)}</strong>
        <span>大小</span><strong>${escapeHtml(bytes(release.size))}</strong>
        <span>发布时间</span><strong>${escapeHtml(published)}</strong>
        <span>SHA-256</span><strong title="${escapeHtml(release.sha256)}">${escapeHtml(release.sha256 || "—")}</strong>
      </div>
      <p class="release-notes">${escapeHtml(release.notes || "受控本地发布版本。")}</p>
      <a class="btn" href="./downloads/${encodeURIComponent(release.file)}" download>下载 ${escapeHtml(identity.title)}</a>
    </article>`;
  }

  async function load() {
    try {
      const [healthResponse, releasesResponse] = await Promise.all([
        fetch("./api/v1/ops/health", { cache: "no-store" }),
        fetch("./api/v1/releases", { cache: "no-store" })
      ]);
      if (!healthResponse.ok || !releasesResponse.ok) throw new Error("本地发布服务不可用");
      const health = (await healthResponse.json()).data;
      const manifest = (await releasesResponse.json()).data;
      const releases = Array.isArray(manifest.releases) ? manifest.releases : [];
      status.textContent = `服务正常 · ${health.version}`;
      status.classList.add("online");
      timestamp.textContent = manifest.generatedAt
        ? `清单生成：${new Date(manifest.generatedAt).toLocaleString("zh-CN", { hour12: false })}`
        : "本地发布清单";
      grid.innerHTML = releases.length
        ? releases.map(card).join("")
        : `<article class="release-card"><p class="release-notes">发布目录尚无可下载文件。</p></article>`;
    } catch (error) {
      status.textContent = "服务未连接";
      grid.innerHTML = `<article class="release-card"><p class="release-notes">${escapeHtml(error.message)}</p></article>`;
    }
  }

  load();
})();
