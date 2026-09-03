# AuditFlow v6.1 release notes

- Fixed the local bridge path used by **AI Check Full Project**. A logged-in local Codex CLI session is now used when no explicit Virtual Key is configured.
- Added a project overview with development progress, traceability, evidence relationships, direct-evidence coverage, human review, open weaknesses, a donut chart, and progress bars.
- Merged the former Plan and Schedule phases into **Plan & schedule** without removing existing project data.
- Updated the workspace schema to v21 and the extension version to 6.1.0.

Security: credentials are not included in this release. The bridge keeps the assessment prompt off the command line, does not read configuration content, and never returns account details, tokens, or CLI stderr to the UI.
