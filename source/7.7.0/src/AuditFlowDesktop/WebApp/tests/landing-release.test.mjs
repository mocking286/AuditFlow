import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const exportedPage = new URL("../../../../artifacts/jeauditflow/out/index.html", import.meta.url);
test("the actual exported promotional page identifies the 7.7 release", {
  skip: existsSync(exportedPage) ? false : "Next.js export is a source-checkout build input, not a backend runtime file"
}, async () => {
  const html = await readFile(exportedPage, "utf8");
  assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1], "JEAuditFlow 7.7.0 | ASPICE Audit Workbench");
  assert.equal(html.includes("JEAuditFlow 7.7.0"), true);
  assert.equal(/JEAuditFlow 7\.5|JEAUDITFLOW 7\.5|v7\.5\.0/.test(html), false);
});
