# AuditFlow v8.5.0 Release Notes

## Edge Add-ons package

- The manifest description is 130 characters, below the Microsoft Edge 132-character limit.
- The store ZIP places `manifest.json` at the archive root.
- macOS metadata, runtime output, tests, deployment files, backend source, nested archives and downloadable binaries are excluded from the store package.

## Global Codex assistant

- The AuditFlow extension icon is now a floating button on the right side of every screen.
- The assistant opens in a right-side drawer and retains the existing overall assessment, project-scoped conversation, follow-up and clear-chat workflows.
- A project selector changes the active ASPICE context without navigating away from the current screen.
- Codex requests are restricted to a loopback script on `127.0.0.1`, `localhost` or `::1`.

## Execution boundary

- Cloud: accounts, members, roles, process permissions, project revisions, presence, edit leases, events and locked incremental changes.
- User computer: file parsing, evidence content, WBS analysis, BP/GP/PA calculation, Codex context, reports, workspace exports and feedback.
- Cloud project snapshots are always metadata-only and exclude evidence text, excerpts, tables, atomic items, AI review history, research sessions and notes.
- A collaboration-only server returns 404 for AI, Codex, engine, report, export and feedback routes.

AI output remains advisory and never overwrites human ratings, evidence confirmation, mapping calibration, PA review, baselines or closure decisions.
