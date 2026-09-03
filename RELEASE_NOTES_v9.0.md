# AuditFlow v9.0.0 Release Notes

## Report and evidence review

- English report preview now uses the same complete report structure as Chinese mode, including scope, PA hard gates, BP/GP matrix, cross-process analysis, traceability, detailed results, work products, findings and final remark. AI conclusions remain advisory and assessor-owned fields are preserved.
- Added editable PowerPoint export based on `templates/Intacs-Agile-SPICE-2021-04.pptx`. The deck keeps the supplied visual template and embeds a machine-readable AuditFlow report payload at `ppt/auditflow-report.json`.
- Grid View now includes a Trace-style 15-button toolbar, process/indicator/BP description/workspace/#/T/GP/evidence description/NC/modified-by columns, Finding editing for indicators/type/instance/workspace/comment, and assessor note registration with a new finding number.
- List View finding cards expose the same Finding editor for evidence-linked review.

## Administration and control

- Metrics are shown in Review progress with a process/indicator table covering direct, corroborating and index-only evidence, review state, rating, NC and modifier.
- Closure blocker tree and immutable assessment log are integrated into Version history; the separate Close Assessment phase is no longer shown in the phase navigation.
- Account settings support explicit sign-out and account switching. Administrators can open project access management and assign project roles/process scopes.
- Added administrator-only Backend administration settings and bundled the read-only `monitor/` bridge/workbench from `monitor.zip`.

## Version

- Extension manifest and runtime version: `9.0.0`.
- This is a client-side release. Backend schema and deployment changes are intentionally out of scope for this package.
