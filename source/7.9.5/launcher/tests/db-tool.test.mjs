import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  connectionUrls,
  parsePlistXml,
  schemaFiles,
  tablePlusCandidates,
  targetDatabase
} from "../JEAuditFlowLauncher.app/Contents/Resources/db-tool.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, "fixtures/tableplus-connections.xml"), "utf8");
const schemaDirectory = path.resolve(here, "../../database/schema");

test("parses plutil XML including entities, empty containers, dates and data", () => {
  const connections = parsePlistXml(fixture);
  assert.equal(connections.length, 6);
  assert.equal(connections[1].ConnectionName, "JEAuditFlow 7.9.5 & TablePlus");
  assert.deepEqual(connections[0].Favorites, {});
  assert.deepEqual(connections[0].RecentlyOpened, ["mysql"]);
  assert.equal(connections[0].DatabaseName, "");
  assert.equal(connections[1].isOverSSH, false);
  assert.equal(connections[2].isOverSSH, 1);
  assert.equal(connections[5].DatabasePort, 43324);
  assert.equal(connections[1].LastOpened, "2026-11-18T08:02:14Z");
  assert.throws(() => parsePlistXml("<plist><array><dict><string>x</string></dict></array></plist>"), /expected <key>/);
});

test("keeps only local MySQL/MariaDB connections and ranks the 7.9.5 database first", () => {
  const candidates = tablePlusCandidates(parsePlistXml(fixture));
  assert.deepEqual(candidates.map(candidate => candidate.name), [
    "JEAuditFlow 7.9.5 & TablePlus",
    "AuditFlow 7.7 native",
    "Homebrew MySQL"
  ]);
  const [best, legacy, homebrew] = candidates;
  assert.equal(best.port, 43327);
  assert.equal(best.targetDatabase, "jeauditflow_795");
  assert.ok(best.score > legacy.score && legacy.score > homebrew.score);
  assert.equal(legacy.targetDatabase, "jeauditflow_795", "a 7.7 connection must not make 7.9.5 write into jeauditflow_770");
  assert.equal(homebrew.host, "localhost");
  assert.equal(homebrew.targetDatabase, "jeauditflow_795");
});

test("treats a connection with a remote SSH server as remote even without isOverSSH", () => {
  const candidates = tablePlusCandidates([{
    ID: "X", ConnectionName: "tunnel", Driver: "MySQL", DatabaseHost: "127.0.0.1", DatabasePort: "3306",
    DatabaseUser: "root", ServerAddress: "bastion.example.com", ServerUser: "ops"
  }]);
  assert.deepEqual(candidates, []);
});

test("targets only a 795 database name", () => {
  assert.equal(targetDatabase("jeauditflow_795"), "jeauditflow_795");
  assert.equal(targetDatabase("jeauditflow_795_local"), "jeauditflow_795_local");
  assert.equal(targetDatabase("jeauditflow_770"), "jeauditflow_795");
  assert.equal(targetDatabase("bad name 795"), "jeauditflow_795");
});

test("encodes credentials the way the API and FileAnalyst decode them", () => {
  const password = "Tp!pa:ss@w#rd /1%";
  const urls = connectionUrls({ host: "localhost", port: 3306, user: "root", password, database: "jeauditflow_795" });
  const parsed = new URL(urls.mysql);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(decodeURIComponent(parsed.username), "root");
  assert.equal(decodeURIComponent(parsed.password), password);
  assert.equal(parsed.pathname, "/jeauditflow_795");
  assert.equal(urls.jdbc, "jdbc:mysql://127.0.0.1:3306/jeauditflow_795?sslMode=DISABLED&allowPublicKeyRetrieval=true");
  assert.throws(() => connectionUrls({ host: "::1", port: 1, user: "u", password: "", database: "x;drop" }), /Invalid database/);
});

test("accepts the shipped 7.9.5 schema and refuses destructive SQL", () => {
  const files = schemaFiles(schemaDirectory);
  assert.ok(files.some(file => file.name === "collaboration-schema.sql"));
  assert.ok(files.length >= 6);
  const unsafe = mkdtempSync(path.join(tmpdir(), "schema-"));
  writeFileSync(path.join(unsafe, "collaboration-schema.sql"), "-- drop table is fine in a comment\ncreate table if not exists t (id int);\n");
  assert.equal(schemaFiles(unsafe).length, 1);
  writeFileSync(path.join(unsafe, "zz.sql"), "DROP TABLE auditflow_accounts;");
  assert.throws(() => schemaFiles(unsafe), /DROP/i);
});
