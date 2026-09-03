# AuditFlow v9.5.0

## Collaboration login repair

- The extension now declares both official HTTP collaboration origins in its MV3 host permissions:
  - `http://www.aspice-auditflow.cloud/*` (default)
  - `http://120.25.197.24/*` (same-service fallback)
- A persisted official domain is no longer rejected by Edge before the login request is sent.
- When a network-level connection fails, AuditFlow automatically tries the alternate official origin. Authentication failures returned by the server are not retried or hidden.
- The login error names the endpoint(s) actually tried and no longer incorrectly requires a particular server release label.

## Compatibility

- Extension version: 9.5.0.
- Workspace database version remains 57; no local projects, evidence, ratings, trace links, or account settings are migrated or reset.
- This ZIP updates the extension client only. It does not alter the remote collaboration server.
