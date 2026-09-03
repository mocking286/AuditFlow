# AuditFlow v7.9.0

AuditFlow v7.9 restructures the standard project page into the Jira project layout: a left project sidebar holds the project navigation and the assessment-flow buttons (colored icons), and the workspace content sits on the right. The text-heavy top row is gone.

## Project left sidebar (Jira style)

- Every standard project now renders a sticky left sidebar: project avatar + name + key + status, a `项目` group (摘要 / 列表 / 面板 / 时间线 / 开发 / 表单 / 文档) and an `评估流程` group with the ten assessment phases as colored icon buttons plus small count badges and hover tooltips.
- The previous horizontal assessment command bar and project nav row were removed, so the first row of the project page is now just the page header — no more cluttered text strip.
- A collapse toggle shrinks the sidebar to an icon-only rail (colored icons only; the function name appears on hover). The choice persists across sessions.
- Active state uses the Jira blue highlight (#0C66E4 on #E9F2FF) in light theme and the Atlassian dark palette (#669DF1 accent, rgba(206,206,217,.10) highlight) in dark theme.
- On narrow screens the sidebar stacks above the content.

## Other changes

- Extension version 7.9.0; workspace database migration to version 35 (preserves all data; writes an upgrade log entry).
- New `trace-v79.css` theme layer; release smoke checks now assert the v7.9 assets and the project sidebar.
- All v7.7 report styling (professional palette + GSWR), Codex assistant, v7.8 Jira navigation and workbench modules remain available.

## Notes

- The project sidebar navigation (摘要/列表/面板/时间线/开发/表单/文档) maps to the same deep links as before; the `评估流程` group exposes the full ten-phase lifecycle.
- Jira UI conventions (left project nav, colored phase icons, collapse rail, dark palette) were reproduced from Jira Cloud's project/development pages observed in the user's workspace.
