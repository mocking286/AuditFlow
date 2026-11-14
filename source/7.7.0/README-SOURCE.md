# JEAuditFlow 7.7.0 Source

This snapshot contains the exact public client/API source from this release, FileAnalyst source, merged JiraFlow Java source, JEAuditFlow launcher source, schema tooling and focused synthetic regression tests. The 7.7 source also includes the separate macOS Atlassian bridge launcher and its tests. Controlled customer audit datasets, account databases, credentials, uploads, logs and private fixtures are omitted. Public dataset adapters intentionally contain empty collections.

The source is assembled from verified release staging directories so it does not sweep unrelated changes from the development checkout into this archive. Build stamps and neutral dataset adapters are part of the public snapshot.

## API and Tests

Node.js 26.13.1 is the tested runtime:

```sh
cd src/AuditFlowDesktop/WebApp
npm ci
npm run check
npm test
AUDITFLOW_LOCAL_TEST=1 AUDITFLOW_SERVER_ROLE=desktop AUDITFLOW_PORT=4173 AUDITFLOW_CLIENT_ROOT="$PWD" node server.mjs serve
```

The included test suite uses synthetic local providers and HTTP upstreams. It does not call a paid model. Proprietary fixture-based development suites are not included.

## Rebuild Packages

Requires OpenJDK 27.0.1 and Node.js 26.13.1, zip/unzip, Python 3 with defusedxml, and Chromium for printing the operation manuals. The promotion export is included as a prebuilt public asset. JiraFlow keeps Java 21 bytecode compatibility while the release launcher executes it with the pinned JDK 27 runtime.

```sh
AUDITFLOW_USE_BUNDLED_CHECKLIST_CATALOG=1 node scripts/package-7.7-release.mjs
```

The bundled checklist switch validates the checked-in generic catalog rather than requiring the original checklist documents. JiraFlow builds from src/JiraFlow and the database package reads database/7.6.0. These contain source and fresh-install schema only. The 7.7 packager adds the managed InnoDB JiraFlow table and native MySQL wrappers; the older source schema directory is an input to that build, not the 7.7 deployment default.

## macOS Launcher

```sh
bash local-deploy/launcher/script/build_and_run.sh --build-only
```

The JEAuditFlow launcher is locally signed and is not Apple-notarized. For 7.7, the independent Atlassian bridge launcher is under tools/AtlassianServiceLauncher and can be tested with `swift test`; it requires an active local Jira/Confluence service and an explicitly configured Polarion URL. The public reverse bridge requires installation on a public HTTPS server plus an active Mac connector; source availability alone does not establish deployment.
