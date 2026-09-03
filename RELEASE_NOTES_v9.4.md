# AuditFlow v9.4.0 Release Notes

## User-facing changes

- Replaced the extension, popup, Audit Master and Codex assistant branding with the supplied clipboard/report logo (`icons/icon-*.png` and `icons/aspice-mascot.png`).
- Added bilingual hover descriptions to rendered buttons, links and icon controls in English mode while retaining accessible `aria-label` names.
- Increased active top navigation contrast and corrected icon hover colors so Summary, List and Board controls remain visible.
- Moved Latest change, Project browser and Chat below Back to project list. The utilities stack vertically in the collapsed project sidebar.
- Renamed Model browser to Project browser; selecting a project card opens its standard assessment route.
- Moved file jump tabs below Evidence Inventory with horizontal scrolling, and constrained the center Trace relation column to one finding per row.
- Added expandable Process → PA → BP/GP Assessment Scope hierarchy with explicit chevrons and node icons.

## Data and compatibility

- Workspace database version: `57`.
- Existing projects, assessor ratings, evidence confirmations, baselines and collaboration metadata are retained. Migrations only add UI/version markers and audit-log entries.
- Item-level image evidence remains local and reviewable from the evidence inventory; AI suggestions remain advisory and cannot overwrite assessor-owned ratings or approvals.

## Verification

- Manifest, JavaScript syntax, JSON syntax, archive integrity and SHA-256 are checked during packaging.
- The package is a browser-extension client bundle; server availability and authenticated project data remain deployment/environment prerequisites.
