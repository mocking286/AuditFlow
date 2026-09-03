# AuditFlow v7.1.0 Release Notes

## New audit workflows

- Added built-in ISO 26262:2018 functional-safety and ISO/SAE 21434:2021 cybersecurity audit schemes.
- Added a six-stage safety-audit workbench: scope, planning, evidence, AI analysis, assessor review, and closure.
- Added lifecycle-specific questions and expected work products for governance, safety/security management, concept analysis, development, verification, support, release, and safety/security cases.
- Custom-audit evidence analysis now distinguishes direct, corroborating, and index-only evidence and preserves related ASPICE support processes as non-rated observations.

## Evidence and assessor controls

- Added local legacy DOC extraction with an explicit warning that tables, page numbers, and formatting may be incomplete.
- Added assessor-review drawers with candidate rating, evidence sufficiency, cross-process checks, O/W/R findings, interview questions, and minimum closure evidence.
- Safety-audit closure requires complete assessor review, sufficient evidence, and no open weaknesses. Only the Lead Assessor can close or reopen.

## Collaboration and Azure readiness

- Added a local three-assessor collaboration preview with project membership, current-user simulation, project roles, revision counters, and event history.
- Added Lead Assessor, Assessor, Data Logger, and Viewer guards for evidence, AI analysis, manual rating, and closure operations.
- Added non-secret Microsoft Azure deployment settings and a local `/api/collaboration/status` probe.
- Target production architecture is Microsoft Entra ID, Azure API hosting, Azure SQL, Blob Storage, SignalR, and Key Vault.

## Deployment boundary

This package does not include a company Azure tenant deployment, server-side authentication, shared database, object storage, or real-time cross-device synchronization. The local collaboration model validates workflows and permissions; production enforcement must occur in the Azure API and database transaction layer.

## Data migration

- Extension and local backend version: `7.1.0`.
- Workspace database version: `27`.
- Existing ASPICE projects, evidence, assessor amendments, records, and historical runs are migrated in place.
