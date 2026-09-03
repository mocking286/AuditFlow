# AuditFlow v7.6.0

AuditFlow v7.6 ports the browser-applicable controls from JEAuditFlow 2.1 while retaining the v7.5 Microsoft/Vercel collaboration boundary and local-first evidence model.

## Assessor workbench

- The breadcrumb shows the project identifier and remains visible below the fixed browser header.
- The ten-stage assessment flow stays immediately below the breadcrumb while scrolling. It remains in document flow and does not overlap phase content.
- Scope now owns the small Audit Master control. The former duplicate project-header and assessment-bar entry points were removed.

## Embedded ASPICE Audit Master

- Select uploaded files or individual Helix atomic items and assign Direct, Corroborating or Index-only roles before analysis.
- Run qualified-flow, agree-summarize, divide-control and trace-consistency checks against an immutable formal scope.
- Optionally send only selected excerpts, locators and project scope to the configured AuditFlow backend. Original file blobs are never sent by this action.
- Return the result as provisional AI candidates and an Index-only `AI Review Opinion` evidence record. No human rating, approval, trace decision or closure state is overwritten.

## Controlled baselines and roles

- Create a Draft baseline only after document item classifications have been assessor-confirmed.
- Submit the baseline to an Independent Reviewer, preserve the objective response, then allow Lead Assessor or Configuration Manager approval.
- Export a baseline manifest containing formal scope, evidence IDs, atomic item IDs, history and an FNV-1a manifest hash.

## Upgrade boundary

Database version 32 adds Audit Master reviews, baselines, role-review assignments and research placeholders without rebuilding prior projects. Windows-only updater, service restart and log-folder commands from JEAuditFlow remain desktop-shell concerns and are not presented as browser-extension features.
