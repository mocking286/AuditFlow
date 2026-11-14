# JEAuditFlow 7.7 local deployment

7.7 adds a separate native MySQL 26.10 instance and version-pinned Node.js 26.13.1 and OpenJDK 27.0.1 runtimes. It does not replace the Mac's global Node/Java settings, restart the Homebrew MySQL service, or access Docker Jira containers. Releases 6.9 through 7.6 keep their existing runtime and database configuration.

## Install and verify runtimes

From the unpacked deployment support directory:

```sh
node local-deploy/scripts/prepare-7.7-runtimes.mjs
```

The installer verifies upstream SHA-256 checksums before extraction. Node.js and JDK files stay under the versioned local runtime toolchain directory. The JDBC driver is used only by the JEAuditFlow JiraFlow process.

## Migrate from 7.6

Keep the 7.6 Docker stack and its named volume intact. Select version 7.7 in the local launcher and use **迁移 7.6 数据到 7.7** before starting the 7.7 app. The confirmation names both databases. The equivalent command is:

```sh
JEAUDITFLOW_CONFIRM_MIGRATION='COPY jeauditflow_760 TO jeauditflow_770' \
  bash local-deploy/scripts/jeauditflow-local.sh migrate-native --version 7.7.0
```

Stop the 7.6 application services before migration; keep its Docker MySQL running. The migration uses a consistent read-only source transaction, writes per-table backups under `local-deploy/runtime/backups/7.6-to-7.7`, copies the 7.6 file data without modifying it, verifies imported row counts and content hashes plus the complete nested file tree, and writes a migration receipt. It rejects non-empty or previously initialized 7.7 targets. It does not drop tables, change the 7.6 schema, stop Docker, or delete a Docker volume. If a validation fails, its persisted migration state blocks 7.7 application startup until the preserved target and backups are investigated.

## Start the 7.7 services

Review the generated private file `local-deploy/config/7.7.local.env`. Start is version-isolated and requires launcher confirmation:

```sh
JEAUDITFLOW_CONFIRM_DATABASE='APPLY jeauditflow_770 ON native' \
  bash local-deploy/scripts/jeauditflow-local.sh start --version 7.7.0
bash local-deploy/scripts/jeauditflow-local.sh health --version 7.7.0
```

AuditFlow, FileAnalyst, JiraFlow, and the Node AI bridge use the verified Node/JDK in `local-deploy/runtime/toolchains`. Native MySQL binds only to `127.0.0.1:43324`. AuditFlow uses `47683`, FileAnalyst `47684`, JiraFlow `47685`, and the AI bridge `47686`.

Set `JEAUDITFLOW_POLARION_URL` on the local Mac connector to the explicitly intended private Polarion service, for example `http://192.168.8.90:8080/polarion/` or `https://192.168.8.90/polarion/`. The launcher button opens that validated private URL for the local operator. The connector passes the validated host, port, protocol, and base URL to its HTTP(S) transport; HTTPS uses Node's default certificate validation and does not bypass it. The private target remains on that Mac and is not returned to the hosted server.

To expose Polarion as an optional route on a separately hosted JEAuditFlow collaboration server, set `AUDITFLOW_ENABLE_POLARION_BRIDGE=1` in that server's environment and restart it. The route is omitted from bridge capabilities unless enabled. A user still needs a local connector configured with `JEAUDITFLOW_POLARION_URL`; remote access then flows through the authenticated, owner-scoped AuditFlow reverse route. Do not publish the VM's Polarion port to the internet.

## Local Jira REST channel

The local connector's Jira REST channel targets only loopback and the configured `AUDITFLOW_JIRA_PORT` (default `8080`). Set `AUDITFLOW_JIRA_PROJECT_KEYS` to the explicit comma-separated Jira projects that may receive findings, and configure either `AUDITFLOW_JIRA_PAT` or `AUDITFLOW_JIRA_USERNAME` plus `AUDITFLOW_JIRA_PASSWORD` in the protected `7.7.local.env` file. These credentials stay on the local service and are not a browser setting. They are independent of the JiraFlow service token. A hosted AuditFlow server uses the user's authenticated reverse connector rather than connecting directly to the Mac or changing Docker Jira.

## InnoDB

InnoDB is MySQL's transactional table storage engine. It stores rows and indexes and provides atomic transactions, row-level locks, crash recovery, and foreign-key enforcement. A transaction makes a JiraFlow state update all-or-nothing: a failed write rolls back rather than leaving half of the new state. Row locks serialize concurrent writers. Crash recovery replays committed work and discards incomplete work after an unexpected stop. Foreign keys can protect valid relationships when those constraints are defined.

InnoDB is not another database server or an extra data copy. JEAuditFlow 7.7's AuditFlow, FileAnalyst, and JiraFlow tables reside in the same local MySQL server and isolated `jeauditflow_770` database. JiraFlow keeps its application snapshot contract and stores the current snapshot, revision, SHA-256 checksum, and project/issue/user/event counts together in one InnoDB transaction. It does not yet expose separate normalized issue tables. The old `store.bin` is retained as an import source and is not automatically deleted.

## Stop and retain data

Stopping the app leaves the native MySQL instance running for fast restart. This preserves 7.7 data; it does not stop or remove earlier Docker databases. Do not delete the version-specific `local-deploy/runtime/native-mysql/7.7.0` or `local-deploy/runtime/data/7.7.0` directories without a separate backup and migration plan.
