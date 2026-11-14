# JEAuditFlow 7.7 Verification

Date: 2026-11-14; continued bridge verification 2026-11-15, Asia/Shanghai.
This is software verification evidence, not an Automotive SPICE assessment or rating.

## Requirements and Checks

The criteria below derive from the user's nine requested outcomes [R].
They concern digital behavior; physical temperature and ASIL sampling criteria do not apply.
No generated criterion constitutes an assessor's formal project conclusion.

| Requirement | Method and pass criterion | Evidence and result |
| --- | --- | --- |
| R1 Polarion bridge | Test + Demonstration: configured private target returns a page; route enforces session ownership; unconfigured route is unavailable | Actual Edge + installed Atlassian connector: administrator login, E-Library project, document content and navigation to Catalog Specification passed after the Cookie, asset budget, Base64 and GWT module-base fixes. Public remote installation is not verified |
| R2 readable Excel evidence | Test + Inspection: retain reference first 14 columns; export actual linked text and locators; missing content remains explicitly unavailable; do not raise ratings | Report export, Trace content and real MBEAL fixture tests passed; field mapping documented |
| R3 Jira bidirectional trace | Test: preview creates zero tickets; confirmed creation reads back one matching issue; retry does not create a second issue; status update changes no formal rating or closure | Actual Jira REST HTTP mock tests and JiraFlow evidence tests passed; real Jira credentials absent |
| R4 Finding mapping | Inspection + Test: map finding, process/BP/GP, severity, description, evidence, owner, due date, assessment and source URL; attach only corroborating evidence | Jira channel mapping and server readback assertions passed |
| R5 runtime update | Inspection: version-pinned binaries identify their versions and downloaded hashes match receipts; Docker Jira runtime is excluded | Node 26.13.1, JDK 27.0.1.0.3 and Connector/J 26.10.0 receipt; official Node index reread 2026-11-14 identifies v26.13.1 as latest stable/LTS |
| R6 Windows plugin details | Inspection: provide only paths/APIs actually present and screenshots with no credentials | Codex configuration exists; target Dashboard extension and its API configuration not found in Windows LYM |
| R7 SSO and mail | Test: OIDC rejects invalid tokens and state; assignment permissions hold; concurrent notification retries submit once; accepted is distinct from delivered | SSO/Graph/Outlook/task tests and retry guard tests passed. Real SSO and mail remain unverified due to missing registration and Outlook -1712 |
| R8 native MySQL | Test + Inspection: migrated row counts/content hashes and file hashes match; JiraFlow reloads its legacy snapshot and persists to InnoDB; no old source destruction | Actual migration verified 22 tables / 927 rows and 16 files. Source hashes unchanged. MySQL and JiraFlow persistence verified after restart |
| R9 process boards and assignments | Test + Demonstration: process-specific counts/events derive from authorized project data; Lead/Assessor delegation rejects outside-scope targets; modal saves a revisioned task | Task tests and desktop/mobile assignment UI passed. Installed 7.7 entry, service health, package and launcher identity verified separately |

## Automated Results

- Original feature-baseline complete WebApp suite on the pinned Node.js 26.13.1 runtime:
  528 tests, 528 passed, 0 failed, 0 skipped.
- npm run check and syntax checks for app.js, assessment-tasks.mjs,
  assessment-mail.mjs, outlook-desktop-mail.mjs, jira-rest-channel.mjs and
  jira-finding-integration.mjs passed.
- Jira HTTP tests use an isolated mock upstream and synthetic records.
  They do not write production Jira issues.
- Provider tests do not invoke a paid model. No email was sent by these tests.
- Public neutral template sanitization and valid generation across all six
  public template files: 3 tests, 3 passed. The missing legacy worksheet-name
  fallback was corrected before the final package build.
- A live Polarion smoke test used the actual VM at 192.168.128.4 through an
  isolated collaboration server, not a mock Polarion. It verified a connected
  outbound relay, HTTP 200 for the login page, bridge-scoped resource rewriting,
  and HTTP 401 without AuditFlow authentication. The temporary server and
  connector were then stopped. No public server deployment was implied.

## Runtime Sources

The release installer records download URLs and SHA-256 in
local-deploy/runtime/toolchains/7.7-runtime-receipt.json.
Primary runtime sources checked:

- https://nodejs.org/dist/index.json
- https://jdk.java.net/27/
- https://repo.maven.apache.org/maven2/com/mysql/mysql-connector-j/26.10.0/

The Node index was read using HTTPS on 2026-11-14. Its v26.13.1 release date is
2026-11-10; the v27 entries are alpha previews. The JDK page identifies
27.0.1.0.3 as its GA build. These checks do not update Docker Jira.

## Installation and Live Checks

Browser QA in an isolated synthetic project exercised the assignment modal,
saved a SUP.9 BP1 task to another project assessor, retained its remark and
due date, showed the process task count move from 0 to 1, and persisted the task
after reload. SYS.2/SUP.9 process cards and per-process/global Recent Activity
rendered. At a 390-pixel viewport the document width stayed 390 pixels.
Activity secondary text was changed to a separate line after visual inspection.
The Polarion top action was visible and opened its intended local API URL;
fresh HTTP tests separately verified that route's authenticated redirect and
its denial for remote server access.

### Actual Local Upgrade

Migration completed at 15:45 Asia/Shanghai on 2026-11-14. The restart acceptance
receipt was written at 15:56; fresh health checks at 17:19 again returned HTTP
200 for AuditFlow, FileAnalyst, JiraFlow and the AI bridge.

| Check | Verified result |
| --- | --- |
| Source to target | jeauditflow_760 to independent native jeauditflow_770 |
| Migrated tables | 22 tables, 927 rows; source and destination content SHA-256 matched |
| Key row counts | 6 accounts, 8 AuditFlow projects, 744 assessor records retained |
| Migrated files | 16 files, 2,295,535 bytes; complete copied file manifest matched |
| Source integrity | All 22 source table hashes still matched after 7.7 restart |
| Native MySQL | 26.10.0, InnoDB, loopback port 43324, private version-specific data directory |
| JiraFlow persistence | After restart: 9 projects, 16 issues, 4 users, 8 events, revision 2 |
| Application services | AuditFlow 7.7.0 / FileAnalyst 6.5.0 / JiraFlow 2.1.0 / AI bridge 7.7.0, all HTTP 200 |
| Launcher | Installed 7.7.0; ad-hoc signature verification passed; bundle files matched the packaged launcher |
| Source distribution | Extracted public source npm run check and 216 focused tests passed |
| Rollback preservation | 7.6 application services stopped; Docker MySQL and old files retained; no Docker volume removed |

Native MySQL is kept alive through the harness's persistent service manager.
The deep-path socket and command-session lifetime failures found during
installation were corrected and retested before the successful restart.
Docker Jira's runtime, schema and volume were not upgraded.

The migration receipt is
`local-deploy/runtime/backups/7.6-to-7.7/migration-receipt.json`.
The aggregate, credential-free local acceptance is included in the release as
`LOCAL-ACCEPTANCE-7.7.json`. AI bridge health does not mean a model provider is
configured; no provider key was supplied.

The installed web entry at `http://127.0.0.1:47683/index.html` rendered the
JEAuditFlow 7.7.0 sign-in page, not a blank screen or framework overlay.
The only initial console error was the expected anonymous `/api/auth/me` 401.
No real assessment was changed for this installed-entry check. Full task
interaction screenshots use the isolated synthetic UI project, not live
customer records.

Native launcher visual inspection through Computer Use timed out. Its version,
signature and package-file identity were verified, but no successful final
native-window screenshot is claimed for that original upgrade check.

### Continued Bridge Repair, 2026-11-14

This subsection records the later Jira/Polarion repair separately from the
original migration and feature-baseline results above. It does not renew the
earlier database-integrity checks or certify the final repair package.

- The installed backend had started before the earlier Polarion Cookie fix
  and its runtime module still used the old path mapping. A source/archive
  checksum alone did not establish that the running process used that fix.
  Final acceptance must compare the installed runtime with the corrected
  source after the controlled backend reload.
- Polarion sends `JSESSIONID` and `X-CSRF-Token` with `Path=/polarion`.
  The earlier proxy mapping duplicated that context beneath the bridge prefix,
  preventing normal browser Cookie matching. The correction removes the
  upstream context before applying the session-isolated bridge path.
- Foundation URLSession can combine multiple `Set-Cookie` headers into one
  string. The bridge now separates Cookie pairs while preserving commas in
  `Expires` dates and quoted values; this retains both the session and CSRF
  Cookies without exposing their values in evidence.
- The Atlassian launcher can fill its Polarion target from an explicit
  environment value, a valid saved target, or the selected JEAuditFlow project's
  version-specific local configuration. It retains valid operator choices,
  saves the validated target locally and does not embed the VM's private IP in
  public source. Private/loopback addresses are parsed as IP addresses rather
  than accepted by hostname-prefix matching; the `/polarion/` context remains
  fixed.
- The initial authenticated page exposed static-resource HTTP 429 failures.
  Bodyless browser assets now have a separate bounded budget (1200 per minute);
  the session total remains bounded at 128 pending and non-asset/API requests
  retain their own 32 pending and 240 per minute. Regressions cover a
  96-resource startup burst alongside 32 API requests and reject a filename
  in a query parameter as a way to select the larger asset budget.
- The actual GWT main script was 7,082,204 bytes, below the existing 8 MiB
  response limit. Its Base64 validation caused a V8 stack overflow and an
  eventual bridge 504. The validator now checks length, alphabet and padding
  without a repeated regex group; the byte limits remain unchanged. A
  full HTTP connector test verifies exact delivery of that script size.
- The first GWT XSRF RPC then returned 500. A same-account local HTTP
  comparison accepted the native module base (200), rejected a bridge-prefixed
  module base (500), and accepted the native body with a public Host (200).
  Only the GWT module-base metadata and matching header are restored to the
  native `/polarion/gwt/...` context. Other serialized arguments remain
  byte-for-byte unchanged; XSRF and login checks are retained.
- Focused bridge-session, full HTTP relay and bridge-workbench coverage:
  44 tests, 44 passed,
  0 failed. The installed `bridge-session.mjs` and `server.mjs` matched their
  corrected source hashes after a scoped backend reload.
- At approximately 23:24 Asia/Shanghai, Edge through the installed Swift
  Atlassian connector rendered an authenticated System Administrator session,
  the E-Library project, and real document contents. Clicking Catalog
  Specification navigated to that document inside the same bridge session.
  The inspected browser Console had no error/warning entries. Local screenshot:
  `/tmp/jeauditflow77-polarion-verified.jpg` (not included in public archives).
- Final image-path regression adds scoped rewriting for changed DOM attributes
  and off-DOM image `src` preloads. The final running code again rendered
  administrator document content and navigation; visible broken-image count
  was zero. Some detached HTML/menu image preloads still appeared as root-path
  404 entries in resource history, so a completely clean Network trace is not
  claimed. All inspected visible images resolved after scoped insertion.
- Fresh launcher XCTest: 12 passed, 0 failed. The installed Atlassian launcher
  passed strict signature verification and its executable SHA-256 matched the
  built bundle. The saved target and three-service status were read back from
  its native window.
- The installed Atlassian launcher reopened with the validated saved VM target
  populated. Its three-service route summary and most recent Polarion/Jira
  HTTP response were observed. No permanent "waiting for Jira" status remains.
- The operator's Jira login succeeded, but the native post-login navigation
  escaped to the workbench root `/default.jsp`. Navigating back to the
  bridge-scoped Dashboard proved that the Jira authentication was valid.
  Opening the ASPICE board then exposed root-path `/s/...` lazy scripts with
  HTTP 404 and a missing sidebar.
- Jira 11.3.12's native authentication plugin and lazy resource loader use
  `AJS.contextPath()` backed by WRM's cached context data, not the HTML meta
  tag alone. The correction rewrites only the named WRM context assignment
  and the legacy `window.contextPath` initializer before the native loader
  executes. Service-relative `os_destination` is retained to avoid doubling
  the prefix. Regression coverage executes the native lazy-claim pattern,
  checks login and script destinations, and preserves unrelated script text.
- The operator's next login automatically reached the bridge-scoped System
  Dashboard, verifying the native post-login redirect correction.
  The board exposed a second loading-order issue: WRM assigns `script.src`
  and `link.href` before appending those nodes. MutationObserver repair occurs
  too late for those requests. The adapter now scopes script and stylesheet
  property assignments before the native loading operation, alongside the
  existing image preload protection.
- A temporary fixed loopback preview served the exact corrected adapter
  through the existing authenticated bridge without extracting Cookies.
  It rendered the project sidebar, all four board columns with 20 cards,
  and issue details after a card click. No script/stylesheet resource failures
  remained. This preview was then stopped; it is distinct from acceptance
  on the normal installed port.
- The final runtime modules match source after the last scoped backend reload.
  The normal-port login page's native `AJS.contextPath()` reads back the
  current bridge prefix, and its script/stylesheet property adapters are
  installed. A fresh bridge session is connected; final normal-port
  authenticated board acceptance awaits operator login. No password was
  guessed. No further backend reload is planned for this repair.

The updated backend, Web Client, browser extension, support and source
candidates have been rebuilt without changing version 7.7.0. Source ZIP
integrity and internal SHA-256 checks passed; the four changed server/test
files and Atlassian launcher source matched the actual ZIP contents. The
two installed server modules also matched source and backend staging.

The final candidate was rebuilt with both native Jira context and early
script/stylesheet loading corrections:
142,623,800 bytes; SHA-256
`b410a8e3416fe14a2948d4466bd6cd50bcd5ca9fadd909598520c412e789785b`.
Its 384 internal checksum entries passed. After installing the declared
dependencies with `npm ci --ignore-scripts`, source-staging `npm run check`
and all 227 included tests passed. The focused source-staging bridge
coverage separately passed 44/44 tests. The actual ZIP
entries for both service modules, both changed test modules and the
Atlassian launcher source matched their source-file SHA-256 values.
One core rebuild attempt timed out in public PPTX template sanitization;
the sequential retry using the explicit existing Python interpreter
completed successfully without changing the sanitizer.
The earlier migration receipt keeps its original timestamp and scope.
At 00:41:54 Asia/Shanghai on 2026-11-15, the named
`JEAuditFlow-7.7.0-Source.zip` asset on the existing `JEAuditFlow-v7.6.0`
GitHub release was replaced with this candidate. Remote size, SHA-256 and
`uploaded` state matched. The other 17 release assets and the release
tag, target, title, body and draft/prerelease flags were unchanged.
No new release or version was created. The four installed services
returned HTTP 200 with `status=ok` at 00:42 Asia/Shanghai.
Final normal-port authentication after the last reload remains pending;
the full board/interaction result above is explicitly preview acceptance.

### Remaining External Checks

- Entra tenant/client registration and credentials were absent. Actual SSO
  sign-in has not been enabled or tested.
- Jira REST credentials were absent. Actual production Jira issue creation was
  not performed; isolated HTTP/connector coverage does not replace that check.
- Outlook scripting returned AppleEvent timeout -1712. No real notification was
  sent, accepted or received.
- Polarion is configured and its initial actual-VM login-page relay smoke test
  passed. A public JEAuditFlow installation was not updated; external users
  still need the 7.7 server installation, explicit Polarion route enablement
  and a local connector.
- The continued Jira repair still requires authenticated board/sidebar
  acceptance as described above. Polarion authenticated document navigation
  and launcher address/status checks passed locally. A fresh bridge
  session is required after a backend restart because bridge sessions are
  memory-only.
- The requested LLM Cost Dashboard plugin/API was not found on Windows LYM.
  Only the actually present Codex configuration path and non-secret settings
  were documented.
