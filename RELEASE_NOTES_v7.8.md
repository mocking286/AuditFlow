# AuditFlow v7.8.0

AuditFlow v7.8 brings Jira Cloud-style navigation and workbench modules to the workspace, and upgrades the five professional modules (project tracking, technical review, defect report, practice report, change request) into Jira-like views backed by the real assessment data.

## Jira-style navigation

- Left sidebar now follows the Jira sectioned layout: 审核总览 / ASPICE 评估 / 自定义审核, then 导航 (最近 / 应用 / 计划 / 空间), 专业工作台 (项目追踪 / 技术审查 / 缺陷报告 / 实践报告 / 变更请求), and 更多. Active entries get the Jira blue active state.
- 最近 (`#/recent`): workspace activity feed plus recently updated projects for one-click return.
- 应用 (`#/apps`): Jira Apps-style grid of tools — Codex assistant, ASPICE Audit Master, formal reports, WBS/OPL intelligence, Helix import, controlled baselines, record forms, method library, Codex connection settings and Assessor MCP.
- 计划 (`#/plans`): cross-project plan board with progress track, plan/session/milestone counts, WBS milestone chips and closure-gate status.
- 空间 (`#/spaces`): project spaces, custom-audit spaces and knowledge spaces as cards.

## Project navigation (摘要 / 面板 / 列表 / 表单)

- Every standard project now has a Jira-style project nav below the assessment flow: project key chip plus 摘要 (Overview) / 面板 (Board) / 列表 (List) / 表单 (Forms) / 报告 (Reports) tabs with the blue active underline.
- New 表单 (`forms`) phase: Jira Forms-style intake with eight record forms (优势 / 弱项 / 建议 / 观察 / 访谈问题 / 缺陷报告 / 变更请求 / 通用备注). Selecting a form shows a live preview; 「填写并创建记录」 opens the full record form with a tailored template. Created records enter consolidation and closure — they never change BP/GP ratings automatically.

## Workbench modules

- 项目追踪 (`#/tracking`): Jira Timeline-style per-project rows — progress bar, plan/session/milestone counts, indicator linkage, unreviewed/draft/open-weakness counts and closure-gate pass state.
- 技术审查 (`#/review`): Jira Board with To do / In progress / Done columns aggregating independent-review assignments, controlled baselines, AI review runs and unreviewed BP/GP counts across all projects, each card deep-linked to its project tab.
- 缺陷报告 (`#/defects`): Jira Board with 待处理 / 措施实施中 / 验证中 / 已关闭 columns built from weakness records and CEP action-plan issues; 「新建缺陷」 opens a defect form, cards open the original record.
- 实践报告 (`#/practices`): cross-project per-process practice summary — PA ratings, capability level, evidence coverage, S/W/R counts and a deep link to the formal v7.7-style GSWR report.
- 变更请求 (`#/changes`): SUP.10 change-request list (records + CEP issues) with status, source and open actions; 「新建变更请求」 pre-fills the SUP.10 indicator and the change-analysis template.

## Upgrades

- Extension version 7.8.0; workspace database migration to version 34 (preserves all projects, ratings, evidence, records and settings; writes an upgrade log entry).
- New `trace-v78.css` theme layer; release smoke checks now assert the v7.8 assets and the new module functions.
- All v7.7 report styling (professional palette + GSWR), Codex assistant and collaboration features remain available.

## Notes

- The workbench modules are read/aggregation views over existing project data; record creation still flows through the assessor record form and consolidation so the audit trail stays intact.
- Jira UI patterns (sidebar sections, project nav, board columns, card styling) were reproduced from Jira Cloud's standard light-theme conventions; the referenced cloud instance requires login and was not accessed.
