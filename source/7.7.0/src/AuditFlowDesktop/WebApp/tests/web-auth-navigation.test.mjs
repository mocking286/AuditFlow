import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../web-auth.js", import.meta.url), "utf8");

function authenticationPage(href, logoutStatus = 200) {
  const current = new URL(href);
  const redirects = [];
  const calls = [];
  const location = {
    href: current.href, origin: current.origin, protocol: current.protocol,
    assign: value => redirects.push(String(value)),
    reload: () => redirects.push("reload")
  };
  const shell = { inert: false, setAttribute() {} };
  const gate = {};
  const window = {};
  vm.runInNewContext(source, {
    URL, URLSearchParams, AbortSignal, location, window,
    document: {
      getElementById: () => gate,
      querySelector: () => shell
    },
    fetch: (pathname, options) => {
      calls.push({ pathname, options });
      if (pathname !== "/api/auth/logout") return new Promise(() => {});
      return Promise.resolve({
        ok: logoutStatus === 200, status: logoutStatus,
        json: async () => logoutStatus === 200 ? { authenticated: false } : { error: "Synthetic sign-out failure" }
      });
    }
  });
  return { auth: window.AuditFlowAuth, redirects, calls };
}

test("sign out invalidates the current session then returns to the same-origin promotional entry", async () => {
  const page = authenticationPage("http://127.0.0.1:47683/index.html?fromLanding=1#/standard/EXISTING");
  await page.auth.logout();
  assert.deepEqual(page.redirects, ["http://127.0.0.1:47683/"]);
  const logout = page.calls.find(call => call.pathname === "/api/auth/logout");
  assert.equal(logout.options.method, "POST");
  assert.equal(logout.options.credentials, "same-origin");
});

test("sign out returns to the deployment promotional entry even when invalidation is unavailable", async () => {
  const page = authenticationPage("https://auditflow.example.test/index.html#/dashboard", 503);
  await assert.rejects(page.auth.logout(), /Synthetic sign-out failure/);
  assert.deepEqual(page.redirects, ["https://auditflow.example.test/"]);
});
