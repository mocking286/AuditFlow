/* AuditFlow v8.7 Codex Assistant loopback bridge.
 *
 * The browser never stores a model credential or calls a model provider
 * directly. All assistant requests go through the user-controlled AuditFlow
 * connection service exposed by backend-client.js.
 */
(function () {
  "use strict";

  const HISTORY_KEY = "auditflow-codex-chat-v1";
  const HISTORY_LIMIT = 40;

  function localBridgeReady() {
    try {
      const url = new URL(window.AuditFlowBackend?.assistantBaseUrl || "");
      return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    } catch (_) { return false; }
  }

  function storage() {
    try { return window.localStorage; } catch (_) { return null; }
  }

  function abortedError() {
    const error = new Error("请求已取消");
    error.name = "AbortError";
    error.code = "aborted";
    return error;
  }

  const CodexAssistant = {
    loadHistory(projectId) {
      const store = storage();
      if (!store) return [];
      try {
        const all = JSON.parse(store.getItem(HISTORY_KEY) || "{}");
        return Array.isArray(all[projectId]) ? all[projectId] : [];
      } catch (_) { return []; }
    },

    saveHistory(projectId, messages) {
      const store = storage();
      if (!store) return;
      try {
        const all = JSON.parse(store.getItem(HISTORY_KEY) || "{}");
        all[projectId] = messages.slice(-HISTORY_LIMIT);
        const keys = Object.keys(all);
        if (keys.length > 12) keys.slice(0, keys.length - 12).forEach(key => delete all[key]);
        store.setItem(HISTORY_KEY, JSON.stringify(all));
      } catch (_) { /* Chat history is optional when storage is unavailable. */ }
    },

    clearHistory(projectId) { this.saveHistory(projectId, []); },

    systemPrompt(contextText) {
      return [
        "你是一名资深 Automotive SPICE 主任评估师（Lead Assessor），精通 VDA Automotive SPICE 4.0（ASPICE PAM 4.0）过程评估模型与 ISO/IEC 330xx 评估框架，并熟悉 ISO 26262 功能安全和 ISO/SAE 21434 网络安全与过程评估的接口。",
        "",
        "你的职责：",
        "1. 基于下方提供的评估工作台项目上下文，给出结构化、专业的整体评估；",
        "2. 回答评估员提出的 ASPICE 专业问题：BP/GP 解读、PA 1.1 / PA 2.1 / PA 2.2 评级规则、N-P-L-F 评级尺度、直接证据（direct）/ 佐证（corroborating）/ 仅索引（index-only）的区分、双向追溯、评估准备、关闭门禁、整改闭环（SUP.9 → SUP.10 → 工作产品更新 → 验证 → SUP.8 基线）等。",
        "",
        "回答要求：",
        "- 使用与提问相同的语言回答（默认中文）；",
        "- 使用 Markdown 结构化输出（标题、列表、必要时表格）；",
        "- 严格区分「有证据支持的事实」「推断」与「尚需补充的证据」；不得代替评估师作出正式认证结论或能力等级声明；",
        "- 引用 BP/GP 时使用 ASPICE 4.0 官方编号，并说明其含义；",
        "- 评级术语：N（未达成）、P（部分达成）、L（大部分达成）、F（完全达成）；PA 聚合必须说明硬门禁；",
        "- 按 ISO/IEC 33020 评级区间解释候选：N 0–15%，P >15–50%，L >50–85%，F >85–100%；可使用 P-/P+/L-/L+ 细分，但不能把算术平均当作最终依据；",
        "- 没有正向客观证据时必须给出 N 候选；PA 候选应受最弱关键指标和实际过程风险约束，关键 P/N 不能被其他指标的高分平均掩盖；",
        "- 只有正式范围内目标过程的 direct 证据可支撑正式评分；corroborating 只能支持接口、一致性、配置、问题、变更或治理关系；index-only 只能证明条目存在；",
        "- Capability Level 候选遵守阶梯门禁：CL1 需要 PA1.1 至少 L；CL2 需要 PA1.1 为 F 且 PA2.1/PA2.2 至少 L；更高等级需当前 PA 至少 L 且所有较低 PA 为 F。",
        "- 结论简洁、专业、可执行，优先给出可核实的证据方向和最小关闭证据建议。",
        "",
        "<当前项目上下文>",
        String(contextText || "（未提供项目上下文）"),
        "</当前项目上下文>"
      ].join("\n");
    },

    overallRequest() {
      return [
        "请基于当前项目上下文，对该 ASPICE 评估项目进行一次整体评估，输出以下结构：",
        "",
        "1. 项目概况与评估状态",
        "2. 过程能力概览（逐过程：当前能力等级、PA 1.1/2.1/2.2 评级及主要依据）",
        "3. 主要优势",
        "4. 主要弱项与风险（按优先级排序，并给出最小关闭证据建议）",
        "5. 证据与追溯状态",
        "6. 关闭准备度与建议的下一步行动",
        "",
        "请明确指出哪些结论有证据支持、哪些属于推断、哪些需要评估师进一步核实；不要宣称正式认证结论。"
      ].join("\n");
    },

    async chat({ messages, onDelta, signal }) {
      if (signal?.aborted) throw abortedError();
      if (!window.AuditFlowBackend?.opinion) {
        throw Object.assign(new Error("AuditFlow Codex 连接脚本未加载。"), { code: "network" });
      }
      if (!localBridgeReady()) {
        throw Object.assign(new Error("Codex 助手只允许连接用户电脑上的 127.0.0.1 / localhost 本机脚本。"), { code: "network" });
      }

      const prompt = (messages || [])
        .slice(-25)
        .map(message => `[${String(message.role || "user").toUpperCase()}]\n${String(message.content || "")}`)
        .join("\n\n")
        .slice(0, 180000);

      let payload;
      try {
        payload = await window.AuditFlowBackend.opinion(prompt, { source: "codex-assistant" });
      } catch (error) {
        if (signal?.aborted) throw abortedError();
        const detail = String(error?.message || "连接失败");
        const normalized = detail.toLowerCase();
        if (error?.code === "request-timeout" || /timed out|timeout|超时/.test(normalized)) {
          throw Object.assign(new Error("Codex 模型请求超时：已等待 5 分钟。模型可能正在冷启动或处理较长上下文，请稍后重试。"), { code: "timeout" });
        }
        if (/failed to fetch|networkerror|connection refused|econnrefused|load failed/.test(normalized)) {
          throw Object.assign(new Error("Codex 连接脚本未启动或不可访问。请运行 start-auditflow-codex-bridge.cmd 后重试。"), { code: "network" });
        }
        throw Object.assign(new Error(`Codex 请求未完成：${detail}`), { code: "network" });
      }
      if (signal?.aborted) throw abortedError();

      const content = String(payload?.output || "").trim();
      if (!content) {
        throw Object.assign(new Error("Codex 未返回可用内容，请检查本地连接脚本的会话状态。"), { code: "network" });
      }
      if (onDelta) onDelta(content, content);
      return content;
    },

    async ping() {
      if (!window.AuditFlowBackend?.codexStatus) {
        throw Object.assign(new Error("AuditFlow Codex 连接脚本未加载。"), { code: "network" });
      }
      if (!localBridgeReady()) throw Object.assign(new Error("Codex 状态只允许从用户电脑的本机脚本读取。"), { code: "network" });
      try {
        return await window.AuditFlowBackend.codexStatus();
      } catch (error) {
        throw Object.assign(new Error(`无法访问 Codex 连接脚本：${String(error?.message || "连接失败")}`), { code: "network" });
      }
    }
  };

  window.CodexAssistant = CodexAssistant;
})();
