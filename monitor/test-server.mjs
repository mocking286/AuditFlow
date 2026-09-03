/* 监控服务 mock 测试：验证路由、鉴权、JSON 结构与 HTML 托管 */
import { createMonitorServer } from "/Users/maplemock/Downloads/auditflow-v69/monitor/monitor-server.mjs";

const iso = (ms) => new Date(Date.now() - ms).toISOString();
const h = 3600e3, d = 86400e3;

const mockStore = {
  provider: "MySQL(mock)",
  async health() { return { ok: true, pingMs: 3, mysql: true }; },
  async overview() {
    return {
      generatedAt: iso(0), todayKey: "2026-08-30",
      stats: { projects: 2, events: 8, events24h: 3, events7d: 7, activeLocks: 1, onlineUsers: 1, aiAssessed: 5, reviewed: 3, pendingAi: 2, traceLinks: 9, confirmedLinks: 6, evidence: 12 },
      daily: [{ date: "2026-08-29", count: 2 }, { date: "2026-08-30", count: 3 }],
      processDist: [{ process: "SUP.1", count: 4 }, { process: "SUP.8", count: 3 }],
      topProjects: [{ id: "P1", name: "Demo 项目", eventCount: 5 }],
      today: {
        locks: [{ id: "L1", projectId: "P1", resourceId: "r1", kind: "evidence-chain", label: "Demo 证据链", process: "SUP.1", affectedProcesses: ["SUP.1"], userId: "U1", userName: "张三", acquiredAt: iso(1 * h), expiresAt: iso(-5 * 60e3) }],
        online: [{ projectId: "P1", userId: "U1", userName: "张三", projectName: "Demo", phase: "grid", status: "editing", lastSeen: iso(60e3) }],
        modified24h: [{ id: "P1", name: "Demo 项目", updatedByName: "张三", updatedAt: iso(2 * h), revision: 12 }],
        pendingAi: [{ projectId: "P1", projectName: "Demo 项目", id: "A1", code: "SUP.1.B1", title: "配置管理", process: "SUP.1", aiCandidateRating: "Level 2" }]
      }
    };
  },
  async projects() {
    return [
      { id: "P1", workspaceId: "WS-DEMO", revision: 12, updatedBy: "U1", updatedByName: "张三", updatedAt: iso(2 * h), name: "Demo 项目", organization: "Org", product: "Prod", status: "review", statusLabel: "待复审", progress: 60, achievedLevel: "Level 2", aiAssessed: 5, reviewed: 3, pendingAi: 2, traceLinkCount: 9, aiInferredLinks: 3, confirmedLinks: 6, evidenceCount: 12, processCount: 3, eventCount: 8, lastEventSummary: "评估 SUP.1", lastEventAt: iso(2 * h), aiOpinion: "demo opinion" }
    ];
  },
  async project(id) {
    if (id !== "P1") return null;
    return {
      id: "P1", workspaceId: "WS-DEMO", revision: 12, ownerId: "U1", updatedBy: "U1", updatedByName: "张三", updatedAt: iso(2 * h),
      name: "Demo 项目", organization: "Org", product: "Prod", status: "review", statusLabel: "待复审", progress: 60, achievedLevel: "Level 2",
      aiAssessed: 5, reviewed: 3, pendingAi: 2, traceLinkCount: 9, aiInferredLinks: 3, confirmedLinks: 6, evidenceCount: 12, processCount: 3,
      events: [{ id: 1, projectId: "P1", revision: 12, userId: "U1", userName: "张三", changeSummary: "评估 SUP.1 证据链", processes: ["SUP.1"], createdAt: iso(2 * h), changeType: "assessment", entityId: "A1", operation: "" }],
      locks: [], presence: [],
      assessments: [{ id: "A1", code: "SUP.1.B1", title: "配置管理", process: "SUP.1", pa: "B1", rating: "Level 2", aiCandidateRating: "Level 2", reviewed: false, confidence: 0.9, reason: "r", evidenceAnalysis: [{ evidenceId: "E1", evidenceCode: "E1", strength: "direct", relationType: "direct", locator: "docs/a.xlsx", claim: "c" }] }],
      traceLinks: [{ id: "T1", indicator: "SUP.1.B1", evidenceId: "E1", evidenceCode: "E1", strength: "direct", claim: "c", locator: "docs/a.xlsx", source: "AI inferred", confirmed: false }],
      evidence: [{ id: "E1", code: "E1", name: "证据一", type: "excel", primaryProcesses: ["SUP.1"], helixBlocked: 0, locators: ["docs/a.xlsx"] }],
      processes: ["SUP.1"], aiOpinion: "opinion"
    };
  },
  async events() {
    return [{ id: 1, projectId: "P1", revision: 12, userId: "U1", userName: "张三", changeSummary: "评估 SUP.1", processes: ["SUP.1"], createdAt: iso(2 * h), changeType: "assessment", entityId: "A1", operation: "" }];
  },
  async traceEval() {
    return [{ id: "P1", name: "Demo 项目", updatedAt: iso(2 * h), aiAssessed: 5, reviewed: 3, pendingAi: 2, traceLinkCount: 9, aiInferredLinks: 3, confirmedLinks: 6, evidenceCount: 12, aiOpinion: "demo", indicators: [{ key: "SUP.1.B1", process: "SUP.1", pa: "B1", title: "配置管理", rating: "Level 2", aiCandidateRating: "Level 2", reviewed: false, evidenceLinks: 2 }] }];
  },
  async close() {}
};

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || "" });
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "  -> " + extra));
}

const service = createMonitorServer({ store: mockStore, token: "sekret123", port: 4187, host: "127.0.0.1", htmlPath: "/Users/maplemock/Downloads/auditflow-v69/monitor/monitor.html" });
service.listen(() => {
  const base = "http://127.0.0.1:4187";
  const get = (p, headers) => fetch(base + p, { headers: headers || {} }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  const getText = (p) => fetch(base + p).then(async r => ({ status: r.status, text: await r.text() }));

  (async () => {
    // 1. 未带 token → 401
    let r = await get("/api/monitor/overview");
    check("无 token 拒绝访问", r.status === 401 && r.body.error, JSON.stringify(r.body));
    // 2. header token 正确
    r = await get("/api/monitor/overview", { "X-Monitor-Token": "sekret123" });
    check("token header 可访问 overview", r.status === 200 && r.body.stats.projects === 2);
    // 3. query token 正确
    r = await get("/api/monitor/overview?token=sekret123");
    check("query token 可访问", r.status === 200 && !!r.body.stats);
    // 4. 错误 token → 401
    r = await get("/api/monitor/health?token=wrong");
    check("错误 token 拒绝", r.status === 401);
    // 5. projects 列表
    r = await get("/api/monitor/projects?token=sekret123");
    check("projects 列表", r.status === 200 && r.body.projects.length === 1 && r.body.projects[0].name === "Demo 项目");
    // 6. 单项目详情
    r = await get("/api/monitor/projects/P1?token=sekret123");
    check("项目详情含 assessments/traceLinks", r.status === 200 && r.body.project.assessments.length === 1 && r.body.project.traceLinks[0].source === "AI inferred");
    // 7. 不存在的项目 → 404
    r = await get("/api/monitor/projects/NOPE?token=sekret123");
    check("不存在项目 404", r.status === 404);
    // 8. events
    r = await get("/api/monitor/events?limit=50&token=sekret123");
    check("events 列表", r.status === 200 && r.body.events[0].changeType === "assessment");
    // 9. trace-eval
    r = await get("/api/monitor/trace-eval?token=sekret123");
    check("trace-eval", r.status === 200 && r.body.projects[0].indicators[0].aiCandidateRating === "Level 2");
    // 10. health
    r = await get("/api/monitor/health?token=sekret123");
    check("health", r.status === 200 && r.body.mysql === true && r.body.ok === true);
    // 11. HTML 托管
    const html = await getText("/");
    check("HTML 托管", html.status === 200 && html.text.includes("AuditFlow 后台数据监控台"));
    // 12. 未知路由 → 404
    r = await get("/api/monitor/nope?token=sekret123");
    check("未知路由 404", r.status === 404);
    // 13. OPTIONS preflight
    const preflight = await fetch(base + "/api/monitor/overview", { method: "OPTIONS" });
    check("OPTIONS 204", preflight.status === 204);

    const failed = results.filter(x => !x.ok);
    console.log("\n共 " + results.length + " 项，失败 " + failed.length + " 项");
    service.close();
    process.exit(failed.length ? 1 : 0);
  })();
});
