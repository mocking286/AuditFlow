# JEAuditFlow 7.7 finding channel for locally hosted Jira

## Service boundary

Jira and JiraFlow are separate integrations. This channel targets the
locally hosted Atlassian Jira REST v2 service on `127.0.0.1`, using
`AUDITFLOW_JIRA_PORT` (default `8080`). JiraFlow uses its own API and service
token. Creating a Jira issue does not create a JiraFlow issue or modify either
service's runtime, Docker image, database or volume.

A separately hosted AuditFlow server uses its signed-in user's connected
`jira-api` reverse route. The Mac connector injects its Jira credentials locally.
The browser cannot call the backend-only REST route or obtain those
credentials. The normal `jira` route remains the interactive Jira website.

## Configuration

In the Mac's protected version configuration, set either
`AUDITFLOW_JIRA_PAT`, or both `AUDITFLOW_JIRA_USERNAME` and
`AUDITFLOW_JIRA_PASSWORD`. An explicitly configured PAT takes precedence.
Set `AUDITFLOW_JIRA_PROJECT_KEYS` to the intended comma-separated project
keys. The local REST client enforces this allowlist even when the hosted server
has a different configuration; it filters project listing and rejects issue,
search, assignable-user and create requests outside that list.

On 2026-11-14, a presence-only check found none of those Jira credentials or
project allowlist keys in the installed `7.6.local.env`; `7.7.local.env` had not
yet been generated at the time of that check. No live Jira issue was created
by the integration tests. A browser Jira session does not configure the REST
client's credentials.

The REST client permits only the bounded API operations needed by this flow:
project/type/priority metadata, project details, scoped issue search, issue
readback, project-specific assignable-user lookup and issue creation. It uses
loopback HTTP, follows no redirects, limits request and response JSON to 4 MiB,
and uses a 15-second request deadline.

## Finding workflow

1. A Lead Assessor selects an existing, assessor-reviewed weakness or NC linked
   to an existing BP/GP in the assessment's formal scope.
2. AuditFlow previews the finding and reads the selected Jira project's
   available standard issue types. Preview performs no issue creation.
3. The Lead explicitly confirms the current assessment revision, target project,
   issue type and optional mapped Jira login.
4. AuditFlow searches for the finding's stable source label before creating an
   issue. A short cache retains a returned issue key for five minutes to handle
   Jira search indexing delay; a retry still reads and validates that issue.
   Simultaneous confirmations by two Leads share the same in-process creation
   guard.
5. The created or existing issue is read back. Its key, project, source label,
   exact source-marker line and updated timestamp must match before evidence
   can be attached.
6. AuditFlow stores the issue's actual description, status, version timestamp
   and authorized detail link as `jira-assessment-finding` evidence with the
   `corroborating` role.
7. Synchronization rereads linked Jira issues and updates only their evidence
   and Jira association metadata. Finding closure, formal rating and assessor
   confirmation remain unchanged.

The API rejects stale confirmations and preserves verified Jira evidence when
an older browser snapshot is saved. Issue detail pages enforce both project and
process scope for Assessors and Viewers. Text from Jira is escaped before
rendering.

## Field Mapping

| AuditFlow value | Jira representation |
| --- | --- |
| Process and finding title | `summary`, limited to 255 characters |
| Selected project | `project.key` |
| Selected standard issue type | `issuetype.id` |
| Finding number | Description and stable source marker |
| ASPICE process and BP/GP | Description |
| Severity | Description; no guessed Jira priority ID |
| Finding description | Plain text description |
| Evidence | Retained evidence text and source locators in the description |
| Owner | Readable owner metadata in the description |
| Optional mapped Jira login | `assignee.name`, after exact active/assignable-user validation |
| Due date | `duedate` in `YYYY-MM-DD`, after calendar validation |
| Assessment | Description |
| Original Trace record | Description link |
| Stable finding identity | SHA-256-derived source label and exact source-marker line |

Human-readable Owner text is never guessed into a Jira username. Additional
required Jira custom fields are not invented; a Jira rejection is returned as
an unsuccessful create/readback rather than a completed Trace link.

## AuditFlow API

| Method and path | Purpose |
| --- | --- |
| `GET /api/integrations/jira/projects/{projectId}/options` | Allowed Jira project choices |
| `GET /api/integrations/jira/projects/{projectId}/assessment-findings/{findingId}/preview?projectKey={key}` | Read-only finding and issue-type preview |
| `POST /api/integrations/jira/projects/{projectId}/assessment-findings/{findingId}/issue` | Explicit confirmed create or recover existing issue |
| `POST /api/integrations/jira/projects/{projectId}/sync` | Refresh persisted linked Jira evidence |
| `GET /api/jira-findings/{projectId}/{issueKey}` | Authorized, escaped issue detail page |

Create requests contain only `expectedRevision`, `confirmed: true`,
`projectKey`, `issueTypeId`, and an optional `assigneeName`. Sync accepts an
empty JSON object and reads persisted links. Neither endpoint accepts an
arbitrary recipient, target host, token or issue description from the browser.
