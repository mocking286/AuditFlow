# JEAuditFlow 7.5.0 standalone database package

This package provisions a separate MySQL database for JEAuditFlow 7.5.0. It contains repeatable schema files and an optional CEP issue importer. It does not contain the user's workbook, existing database rows, passwords, API keys, or cloud credentials.

## Start locally

```bash
cp .env.example .env
# edit .env and set local-only passwords
./install-schema.sh --confirm "APPLY jeauditflow_750"
./healthcheck.sh
```

The default host port is `43322`, the database is `jeauditflow_750`, and the persistent Docker volume is `jeauditflow_750_mysql_data`. Change `DB_PORT`, `MYSQL_DATABASE`, or `MYSQL_VOLUME_NAME` in `.env` when another local instance already uses those values.

TablePlus connection values are: host `127.0.0.1`, port `43322`, database `jeauditflow_750`, user from `MYSQL_USER`, and the password from `.env`. The database remains reachable while the JEAuditFlow application is stopped because MySQL is a separate Docker service.

`install-schema.sh`, `migrate.sh`, and the CEP importer perform real database
writes. Each requires an action-time confirmation that names the target
database; no script starts Docker or applies SQL without that confirmation.
When `MYSQL_DATABASE` is changed, replace `jeauditflow_750` in the confirmation
phrase with the actual target database. The package is independent from Jira's
native database and does not modify Jira tables.

## Import the TUV CEP workbook

The import is explicit and idempotent by `(project_key, issue_key)`:

```bash
./import/import-cep-issues.sh \
  --confirm "IMPORT CEP INTO jeauditflow_750" \
  "/path/to/TUV Audit Issue Record Form_Tracking_Table.xlsx"
```

The importer records source sheet, row, and cells. Imported records are marked `source_kind=jira-issue-import` and `owned_by=jiraflow`; JEAuditFlow ASPICE evidence analysis must not consume these records. The workbook is not copied into this package.

## Schema contents

- `collaboration-schema.sql`: accounts, projects, members, locks, presence, event history, evidence items, assessor records, and feedback.
- `fileanalyst-schema.sql`: binary attachment storage used by FileAnalyst.
- `shared-service-schema.sql`: glossary, translations, shared findings, and finding links.
- `content-sync-schema.sql`: release content, revisions, offline sync outbox, and conflict records.
- `cep-issues-schema.sql`: JiraFlow-owned CEP issue records.

The schema files are mounted into MySQL's initialization directory and can also be reapplied with `./install-schema.sh`; all statements are `create table if not exists`.

To apply the same schema to an already-running MySQL instance, pass its connection URL at action time:

```bash
./migrate.sh \
  --confirm "APPLY jeauditflow_750" \
  'mysql://user:password@127.0.0.1:43322/jeauditflow_750'
```

The URL is read only by the process and is never written to the package. Shell history and CI logs should be handled according to the operator's secret-management policy.
