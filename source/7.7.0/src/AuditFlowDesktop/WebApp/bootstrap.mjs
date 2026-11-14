import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncCoreAssessmentProjects } from "./core-project-bootstrap.mjs";

export const DEFAULT_ADMIN_EMAIL = "yumeng.li@johnsonelectric.com";
// This is the server-side shared project key. The browser-facing project ID
// remains MBEAL-ITMS inside the snapshot so legacy local workspaces can hydrate
// it without creating a second cloud project.
export const MBEAL_ITMS_PROJECT_ID = "AUDITFLOW-WEB::shared::MBEAL-ITMS";
export const MBEAL_ITMS_BROWSER_PROJECT_ID = "MBEAL-ITMS";
export const MBEAL_ITMS_LEGACY_PROJECT_IDS = Object.freeze([
  "AUDITFLOW-WEB::shared::MBEAL-ITMS-DEFAULT"
]);
export const MBEAL_ITMS_PROJECT_NAME = "MBEAL ITMS";
export const MBEAL_ITMS_BOOTSTRAP_KEY = "auditflow.mbeal-itms.v12.3";
export const DEFAULT_MBEAL_LEAD_EMAILS = Object.freeze([
  "zoya.logunova@johnsonelectric.com",
  "min.m.zhang@johnsonelectric.com",
  "anne.q.liu@johnsonelectric.com"
]);

const LEAD_DISPLAY_NAMES = new Map([
  ["zoya.logunova@johnsonelectric.com", "Zoya Logunova"],
  ["min.m.zhang@johnsonelectric.com", "Min M Zhang"],
  ["anne.q.liu@johnsonelectric.com", "Anne Q Liu"]
]);

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function readEmailList(value, fallback) {
  const values = String(value || "").split(/[;,\s]+/).map(normalizeEmail).filter(Boolean);
  return [...new Set(values.length ? values : fallback)];
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function stableUserId(email) {
  return `BOOTSTRAP-${crypto.createHash("sha256").update(email).digest("hex").slice(0, 32)}`;
}

function fallbackDisplayName(email) {
  return email.split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 160) || "AuditFlow Assessor";
}

function assertPassword(password, variable) {
  if (password.length < 10 || password.length > 200) {
    throw new Error(`${variable} must contain 10-200 characters`);
  }
}

function assertLeadPassword(password, variable) {
  if (password.length < 6 || password.length > 200) throw new Error(`${variable} must contain 6-200 characters`);
}

function loadMbealFixture() {
  try {
    const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mbeal-assessment.json");
    return JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (_) { return { assessments: [], processes: [], sourceFile: "" }; }
}

function loadMbealTargetedIssues() {
  try {
    const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mbeal-targeted-issues.json");
    return JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (_) { return []; }
}

function bootstrapSnapshot() {
  const fixture = loadMbealFixture();
  const targetedIssues = loadMbealTargetedIssues();
  const processes = [...new Set((fixture.assessments || []).map(item => item.process).filter(Boolean))];
  const workbookLocators = (fixture.assessments || []).map(item => {
    const source = item.sourceAssessment || {};
    return {
      locator: source.sourceCell ? `${source.sourceSheet}!${source.sourceCell}` : `${item.process}!${item.code}`,
      excerpt: [source.evidence, source.weakness, source.requiredActions, source.internalComment].filter(Boolean).join("\n").slice(0, 1200),
      process: item.process,
      practice: item.code
    };
  });
  const workbookContent = (fixture.assessments || []).map(item => {
    const source = item.sourceAssessment || {};
    return [item.process, item.code, source.practiceTitle, source.evidence, source.weakness, source.requiredActions, source.internalComment].filter(Boolean).join("\n");
  }).join("\n\n");
  const evidence = fixture.sourceFile ? [{ id: "MBEAL-XLS-001", code: "MBEAL.XLS.001", name: fixture.sourceFile, type: "Assessment workbook", source: "Controlled import", sourceSha256: fixture.sourceSha256, parseStatus: "parsed", scope: processes.join(", "), size: workbookContent.length, chars: workbookContent.length, content: workbookContent, locators: workbookLocators, workbookAssessment: { schema: fixture.schema, assessmentCount: fixture.assessmentCount, sourceSha256: fixture.sourceSha256, processSheets: fixture.processes } }] : [];
  return {
    id: MBEAL_ITMS_BROWSER_PROJECT_ID,
    projectId: MBEAL_ITMS_BROWSER_PROJECT_ID,
    name: MBEAL_ITMS_PROJECT_NAME,
    organization: MBEAL_ITMS_PROJECT_NAME,
    processes,
    evidence,
    assessments: fixture.assessments || [],
    wbsIssues: targetedIssues,
    workbookImports: [{
      importId: "MBEAL-TARGETED-2026-09",
      sourceFiles: ["260917_MBEAL_ITMS_ASPICE_Spot_Check_Issue_Record_Targeted_EN.xlsx", "260917_MBEAL_ITMS_ASPICE_Spot_Check_Issue_Record_Targeted_CN.xlsx"],
      sourceSha256: {
        en: "e05dfe05c6028b809a21081e199ba12c460372ecfcb2996179a78614a42ad51d",
        zh: "1c3844d7827196dc66c883cb5bb884b9f725e902391999e65b47855357e611ba"
      },
      recordCount: targetedIssues.length,
      duplicatePolicy: "issueId + BP/GP reference; English and Chinese rows are one merged record",
      improvementMeasuresField: "improvementMeasures",
      aiAnalysisStatus: "imported"
    }],
    records: [],
    traceLinks: [],
    traceRelationMarks: {},
    collaboration: {},
    bootstrap: {
      key: MBEAL_ITMS_BOOTSTRAP_KEY,
      version: "12.3.0",
      sourceFile: fixture.sourceFile || "",
      sourceSha256: fixture.sourceSha256 || "",
      importedAt: new Date().toISOString()
    }
  };
}

async function createMissingAccount(store, { email, displayName, password }, passwordDigest) {
  const passwordSalt = crypto.randomBytes(24).toString("hex");
  try {
    await store.createAccount({
      userId: stableUserId(email),
      email,
      displayName,
      passwordSalt,
      passwordHash: await passwordDigest(password, passwordSalt),
      disabled: false
    });
  } catch (error) {
    // Multiple application instances can begin bootstrapping at the same time.
    // A competing successful insert is harmless; any other conflict is retained.
    const concurrent = error?.status === 409 ? await store.accountByEmail(email) : null;
    if (!concurrent) throw error;
  }
  const account = await store.accountByEmail(email);
  if (!account) throw new Error(`Bootstrap account could not be read: ${email}`);
  return account;
}

async function addBootstrapMember(store, projectId, account, administrator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.project(projectId);
    if (!entry) throw new Error(`Bootstrap project disappeared: ${projectId}`);
    if (entry.members?.some(member => member.userId === account.userId)) return false;
    try {
      await store.setMember(projectId, {
        userId: account.userId,
        name: account.displayName,
        role: "Lead Assessor",
        processScopes: ["*"],
        permissions: { view: true, use: true, forms: true, remarks: true, traceability: true },
        expectedRevision: entry.revision
      }, administrator);
      return true;
    } catch (error) {
      if (error?.code !== "revision-conflict" || attempt === 3) throw error;
    }
  }
  return false;
}

async function migrateLegacyMbealProject(store, administrator) {
  for (const legacyProjectId of MBEAL_ITMS_LEGACY_PROJECT_IDS) {
    const legacy = await store.project(legacyProjectId);
    if (!legacy?.snapshot) continue;
    const snapshot = structuredClone(legacy.snapshot);
    snapshot.id = MBEAL_ITMS_BROWSER_PROJECT_ID;
    snapshot.projectId = MBEAL_ITMS_BROWSER_PROJECT_ID;
    snapshot.collaboration = { ...(snapshot.collaboration || {}), cloudProjectId: MBEAL_ITMS_PROJECT_ID };
    await store.saveProject(MBEAL_ITMS_PROJECT_ID, {
      expectedRevision: 0,
      workspaceId: legacy.workspaceId || "AUDITFLOW-WEB::shared",
      changeSummary: `Migrated legacy MBEAL ITMS project from ${legacyProjectId}`,
      snapshot
    }, administrator);
    return legacyProjectId;
  }
  return "";
}

const LEAD_PERMISSIONS = Object.freeze({ view: true, use: true, forms: true, remarks: true, traceability: true });

async function updateMember(store, projectId, account, administrator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.project(projectId);
    if (!entry) throw new Error(`Project disappeared during directory reconciliation: ${projectId}`);
    const current = entry.members?.find(member => member.userId === account.userId);
    if (current?.role === "Lead Assessor" && current.processScopes?.includes("*") && Object.entries(LEAD_PERMISSIONS).every(([key, value]) => current.permissions?.[key] === value)) return false;
    if (current?.userId === entry.ownerId || entry.ownerId === account.userId) return false;
    try {
      await store.setMember(projectId, {
        userId: account.userId,
        name: account.displayName,
        role: "Lead Assessor",
        processScopes: ["*"],
        permissions: LEAD_PERMISSIONS,
        expectedRevision: entry.revision
      }, administrator);
      return true;
    } catch (error) {
      if (error?.code !== "revision-conflict" || attempt === 3) throw error;
    }
  }
  return false;
}

async function removeMember(store, projectId, userId, administrator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.project(projectId);
    if (!entry) throw new Error(`Project disappeared during directory reconciliation: ${projectId}`);
    if (!entry.members?.some(member => member.userId === userId)) return false;
    if (entry.ownerId === userId) throw new Error(`Cannot remove project owner before ownership transfer: ${projectId}`);
    try {
      await store.setMember(projectId, { userId, operation: "remove", expectedRevision: entry.revision }, administrator);
      return true;
    } catch (error) {
      if (error?.code !== "revision-conflict" || attempt === 3) throw error;
    }
  }
  return false;
}

async function transferOwnership(store, projectId, owner, administrator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.project(projectId);
    if (!entry) throw new Error(`Project disappeared during directory reconciliation: ${projectId}`);
    if (entry.ownerId === owner.userId) return false;
    try {
      await store.transferOwnership(projectId, { userId: owner.userId, expectedRevision: entry.revision }, administrator);
      return true;
    } catch (error) {
      if (error?.code !== "revision-conflict" || attempt === 3) throw error;
    }
  }
  return false;
}

async function reconcileCoreDirectory(store, administrator, leads) {
  const retained = [administrator, ...leads];
  const retainedIds = new Set(retained.map(account => account.userId));
  const projects = await store.listProjects(administrator);
  let membersRemoved = 0;
  let membersUpdated = 0;
  let ownersTransferred = 0;

  for (const summary of projects) {
    const projectId = summary.projectId || summary.id;
    if (!projectId) continue;
    // Make room for the administrator first. This handles legacy projects that
    // reached the member cap before the core directory existed.
    let entry = await store.project(projectId);
    while (!entry.members?.some(member => member.userId === administrator.userId) && entry.members.length >= 15) {
      const removable = entry.members.find(member => member.userId !== entry.ownerId && !retainedIds.has(member.userId));
      if (!removable) throw new Error(`Project ${projectId} has no removable member slot for the administrator`);
      if (await removeMember(store, projectId, removable.userId, administrator)) membersRemoved++;
      entry = await store.project(projectId);
    }
    if (await updateMember(store, projectId, administrator, administrator)) membersUpdated++;
    if (await transferOwnership(store, projectId, administrator, administrator)) ownersTransferred++;

    for (const lead of leads) {
      entry = await store.project(projectId);
      while (!entry.members?.some(member => member.userId === lead.userId) && entry.members.length >= 15) {
        const removable = entry.members.find(member => member.userId !== entry.ownerId && !retainedIds.has(member.userId));
        if (!removable) throw new Error(`Project ${projectId} has no removable member slot for ${lead.email}`);
        if (await removeMember(store, projectId, removable.userId, administrator)) membersRemoved++;
        entry = await store.project(projectId);
      }
      if (await updateMember(store, projectId, lead, administrator)) membersUpdated++;
    }

    entry = await store.project(projectId);
    for (const member of entry.members || []) {
      if (!retainedIds.has(member.userId) && await removeMember(store, projectId, member.userId, administrator)) membersRemoved++;
    }
  }

  const accounts = await store.listAccounts(administrator);
  let accountsDeleted = 0;
  for (const account of accounts) {
    if (retained.some(core => core.email === account.email)) continue;
    await store.deleteAccount(account.userId);
    accountsDeleted++;
  }
  return { projects: projects.length, membersUpdated, membersRemoved, ownersTransferred, accountsDeleted };
}

/**
 * Provision the requested shared project only when explicitly enabled at runtime.
 * Passwords are received from deployment secrets, hashed before persistence, and
 * never returned or written to project state. Existing records are never replaced.
 */
export async function bootstrapAuditFlow({ store, passwordDigest, env = process.env } = {}) {
  if (!store || typeof store.accountByEmail !== "function" || typeof passwordDigest !== "function") {
    throw new Error("Bootstrap requires an account-capable collaboration store and password digest function");
  }

  const reconcileDirectory = enabled(env.AUDITFLOW_RECONCILE_CORE_DIRECTORY);
  const mbealEnabled = enabled(env.AUDITFLOW_BOOTSTRAP_MBEAL) || reconcileDirectory;
  const coreProjectsEnabled = enabled(env.AUDITFLOW_BOOTSTRAP_CORE_PROJECTS)
    && String(env.AUDITFLOW_SERVER_ROLE || "").trim().toLowerCase() === "desktop";
  const adminEmail = normalizeEmail(env.AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL) || DEFAULT_ADMIN_EMAIL;
  const leadEmails = readEmailList(env.AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_EMAILS, DEFAULT_MBEAL_LEAD_EMAILS);
  const syncLocalAdminPassword = enabled(env.AUDITFLOW_LOCAL_ADMIN_PASSWORD_SYNC)
    && String(env.AUDITFLOW_SERVER_ROLE || "").trim().toLowerCase() === "desktop";
  if (mbealEnabled && leadEmails.length !== 3) {
    throw new Error("AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_EMAILS must contain exactly three unique valid email addresses");
  }

  const adminPassword = String(env.AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD || env.AUDITFLOW_ADMIN_PASSWORD || "");
  const leadPassword = String(env.AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD || env.AUDITFLOW_BOOTSTRAP_LEAD_PASSWORD || "");
  const shouldProvisionAdmin = mbealEnabled || coreProjectsEnabled || !!adminPassword;
  const existingAdmin = await store.accountByEmail(adminEmail);
  const existingLeads = new Map(await Promise.all(leadEmails.map(async email => [email, await store.accountByEmail(email)])));
  const missingAdmin = shouldProvisionAdmin && !existingAdmin;
  const missingLeads = mbealEnabled ? leadEmails.filter(email => !existingLeads.get(email)) : [];

  // Validate all required secrets before creating anything so a configuration
  // mistake never leaves a partially provisioned default project.
  if (missingAdmin || (syncLocalAdminPassword && existingAdmin)) {
    if (!adminPassword) throw new Error("Missing AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD deployment secret");
    assertPassword(adminPassword, "AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD");
  }
  if (syncLocalAdminPassword && existingAdmin && typeof store.updateAccount !== "function") {
    throw new Error("Local administrator password sync requires an account update-capable store");
  }
  if (missingLeads.length) {
    if (!leadPassword) throw new Error("Missing AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD deployment secret");
    assertLeadPassword(leadPassword, "AUDITFLOW_BOOTSTRAP_MBEAL_LEAD_PASSWORD");
  }
  if (existingAdmin?.disabled) throw new Error(`Bootstrap administrator account is disabled: ${adminEmail}`);
  for (const [email, account] of existingLeads) {
    if (mbealEnabled && account?.disabled) throw new Error(`Bootstrap lead assessor account is disabled: ${email}`);
  }

  const createdAccounts = [];
  let administrator = existingAdmin;
  if (missingAdmin) {
    administrator = await createMissingAccount(store, {
      email: adminEmail,
      displayName: String(env.AUDITFLOW_ADMIN_NAME || "Yumeng Li").trim().slice(0, 160) || "AuditFlow Administrator",
      password: adminPassword
    }, passwordDigest);
    createdAccounts.push(adminEmail);
  } else if (syncLocalAdminPassword && existingAdmin) {
    const passwordSalt = crypto.randomBytes(24).toString("hex");
    administrator = await store.updateAccount(existingAdmin.userId, {
      passwordSalt,
      passwordHash: await passwordDigest(adminPassword, passwordSalt)
    });
  }
  const leads = [];
  for (const email of leadEmails) {
    let account = existingLeads.get(email);
    if (!account && mbealEnabled) {
      account = await createMissingAccount(store, {
        email,
        displayName: LEAD_DISPLAY_NAMES.get(email) || fallbackDisplayName(email),
        password: leadPassword
      }, passwordDigest);
      createdAccounts.push(email);
    }
    if (account) leads.push(account);
  }

  if (!administrator) {
    if (mbealEnabled || coreProjectsEnabled) throw new Error("Bootstrap could not resolve the administrator account");
    return { enabled: false, createdAccounts, projectCreated: false, membersAdded: [], reconciliation: null, coreProjects: { created: [], membersAdded: [] } };
  }
  const administratorIdentity = {
    userId: administrator.userId,
    userName: administrator.displayName,
    account: { email: administrator.email, isAdmin: true },
    isAdmin: true
  };
  const coreProjects = coreProjectsEnabled
    ? await syncCoreAssessmentProjects({
      store,
      administrator: administratorIdentity,
      extraProjects: [{
        projectId: MBEAL_ITMS_PROJECT_ID,
        workspaceId: "AUDITFLOW-WEB::shared",
        snapshot: bootstrapSnapshot()
      }],
      addMember: (projectId, account) => addBootstrapMember(store, projectId, account, administratorIdentity)
    })
    : { created: [], membersAdded: [] };
  if (!mbealEnabled) return { enabled: false, createdAccounts, projectCreated: false, membersAdded: [], reconciliation: null, coreProjects };
  if (leads.length !== 3) throw new Error("Bootstrap could not resolve the three MBEAL ITMS lead assessor accounts");

  let entry = await store.project(MBEAL_ITMS_PROJECT_ID);
  let projectCreated = false;
  if (!entry) {
    const migratedFrom = await migrateLegacyMbealProject(store, administratorIdentity);
    if (migratedFrom) projectCreated = true;
    try {
      if (!migratedFrom) {
        await store.saveProject(MBEAL_ITMS_PROJECT_ID, {
          expectedRevision: 0,
          workspaceId: "AUDITFLOW-WEB::shared",
          changeSummary: "MBEAL ITMS shared project initialized",
          snapshot: bootstrapSnapshot()
        }, administratorIdentity);
        projectCreated = true;
      }
    } catch (error) {
      // MySQL first-publication races are resolved by its transaction retry. A
      // different node can still win, in which case reload before deciding.
      if (error?.status !== 409 && error?.code !== "ER_DUP_ENTRY") throw error;
    }
    entry = await store.project(MBEAL_ITMS_PROJECT_ID);
  }
  if (!entry) throw new Error(`Unable to create ${MBEAL_ITMS_PROJECT_ID}`);

  const membersAdded = [];
  // Only a project with our marker is completed on later starts. This recovers
  // a crash during the initial ACL setup without changing a pre-existing project
  // that merely happens to use the same identifier.
  if (entry.snapshot?.bootstrap?.key === MBEAL_ITMS_BOOTSTRAP_KEY) {
    for (const lead of leads) {
      if (await addBootstrapMember(store, MBEAL_ITMS_PROJECT_ID, lead, administratorIdentity)) membersAdded.push(lead.email);
    }
  }
  const reconciliation = reconcileDirectory ? await reconcileCoreDirectory(store, administrator, leads) : null;
  return { enabled: true, createdAccounts, projectCreated, membersAdded, reconciliation, coreProjects };
}
