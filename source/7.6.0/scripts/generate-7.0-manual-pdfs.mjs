#!/usr/bin/env node

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.AUDITFLOW_RELEASE_VERSION || process.env.AUDITFLOW_MANUAL_VERSION || "7.1.0";
const webRoot = path.join(projectRoot, "src", "AuditFlowDesktop", "WebApp");
const sourceHtml = path.join(webRoot, "help-manual.html");
const outputRoot = path.resolve(process.env.AUDITFLOW_MANUAL_OUTPUT_DIR || path.join(webRoot, "downloads"));
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
].filter(Boolean);
const chrome = chromeCandidates.find(existsSync);

if (!chrome) throw new Error(`A Chromium browser is required to render the ${version} manuals.`);

const html = await readFile(sourceHtml, "utf8");
const localized = html
  .replaceAll("6.9.0", version)
  .replaceAll("6.9", version.replace(/\.0$/, ""))
  .replaceAll("7.0.0", version)
  .replaceAll("7.0", version.replace(/\.0$/, ""));

const tempRoot = await mkdtemp(path.join(os.tmpdir(), `jeauditflow-${version}-manual-`));
try {
  const variants = [
    {
      language: "ZH",
      document: localized,
      output: path.join(outputRoot, `JEAuditFlow-Operation-Manual-${version}-ZH.pdf`)
    },
    {
      language: "EN",
      document: localized
        .replace('<html lang="zh-CN">', '<html lang="en" class="manual-lang-en">')
        .replace('placeholder="搜索章节、功能、过程或关键词"', 'placeholder="Search chapters, features, processes or keywords"')
        .replace('aria-label="清除搜索"', 'aria-label="Clear search"'),
      output: path.join(outputRoot, `JEAuditFlow-Operation-Manual-${version}-EN.pdf`)
    }
  ];

  for (const variant of variants) {
    const input = path.join(tempRoot, `manual-${variant.language}.html`);
    const rendered = path.join(tempRoot, `manual-${variant.language}.pdf`);
    await writeFile(input, variant.document, "utf8");
    const browserArgs = [
      "--headless=new",
      `--user-data-dir=${path.join(tempRoot, `browser-${variant.language}`)}`,
      "--no-first-run",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--run-all-compositor-stages-before-draw",
      "--no-pdf-header-footer",
      `--print-to-pdf=${rendered}`,
      `file://${input}`
    ];
    try {
      execFileSync(chrome, browserArgs, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const diagnostic = String(error.stderr || "");
      if (error.status !== 2 || !diagnostic.includes("Teardown watchdog expired")
        || !diagnostic.includes(`bytes written to file ${rendered}`)) throw error;
      // Chromium can finish printing and then fail during process teardown.
      // Accept only a newly rendered PDF that an independent parser can open.
      const information = execFileSync(process.env.PDFINFO_BIN || "pdfinfo", [rendered], { encoding: "utf8" });
      const pages = Number(information.match(/^Pages:\s*(\d+)/m)?.[1] || 0);
      if (pages < 1) throw new Error(`Invalid rendered ${variant.language} manual`);
      console.warn(`Validated ${variant.language} manual (${pages} pages) after Chromium teardown warning.`);
    }
    const pdf = await readFile(rendered);
    if (pdf.subarray(0, 5).toString() !== "%PDF-" || !pdf.subarray(-1024).toString().includes("%%EOF")) {
      throw new Error(`Incomplete rendered ${variant.language} manual`);
    }
    await cp(rendered, variant.output);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  version,
  outputs: [
    path.join(outputRoot, `JEAuditFlow-Operation-Manual-${version}-ZH.pdf`),
    path.join(outputRoot, `JEAuditFlow-Operation-Manual-${version}-EN.pdf`)
  ]
}, null, 2));
