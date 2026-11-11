import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function externalizeInlineScripts(destinationRoot, page) {
  const runtimeDirectory = path.join(destinationRoot, "next-runtime");
  const scripts = [];
  let inlineIndex = 0;
  const rewrittenPage = page.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attributes, body) => {
    if (/\bsrc\s*=/i.test(attributes) || !body.trim()) return full;
    const fileName = `inline-${String(inlineIndex++).padStart(2, "0")}.js`;
    const normalizedAttributes = attributes.trim() ? ` ${attributes.trim()}` : "";
    scripts.push({ fileName, source: `${body}\n` });
    return `<script${normalizedAttributes} src="./next-runtime/${fileName}"></script>`;
  });

  await rm(runtimeDirectory, { recursive: true, force: true });
  if (scripts.length) {
    await mkdir(runtimeDirectory, { recursive: true });
    for (const script of scripts) {
      await writeFile(path.join(runtimeDirectory, script.fileName), script.source, "utf8");
    }
  }
  return rewrittenPage;
}
