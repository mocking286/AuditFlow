import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const routingSource = await readFile(new URL("../workbench-routing.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const authSource = await readFile(new URL("../auth-gate.js", import.meta.url), "utf8");

function redirectsFor(href) {
  const replacements = [];
  const current = new URL(href);
  const location = {
    href: current.href,
    pathname: current.pathname,
    search: current.search,
    hash: current.hash,
    replace(value) { replacements.push(String(value)); }
  };
  vm.runInNewContext(routingSource, { URL, URLSearchParams, location });
  return replacements;
}

test("bare index stays on the login-first workbench entry", () => {
  assert.deepEqual(redirectsFor("https://auditflow.example.test/index.html"), []);
  assert.match(indexSource, /id="authGate" class="auth-gate"/);
  assert.match(indexSource, /feedback-modal\.js/);
});

test("shared authentication entry offers feedback and the explicit promotional page", () => {
  assert.match(authSource, /data-auth-feedback/);
  assert.match(authSource, /href="\.\/landing\.html"/);
  assert.match(authSource, /source:\s*"login"/);
});
