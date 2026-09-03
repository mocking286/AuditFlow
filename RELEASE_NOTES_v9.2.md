# AuditFlow v9.2.0 Release Notes

## Delivered

- Account-scoped standard project visibility: ordinary users see only the Project Management Process Diagnostic workspace; administrators retain the complete seeded/imported list.
- Asynchronous English enforcement for `aspice-audit-master` parser output, including assessor challenge questions, evidence structure scan text, and dynamically rendered result cards.
- Traceability confirmations now carry `itemId` / `evidenceItemId` and use an atomic-item composite key. Confirming one CUS/JE or document row therefore affects only that row.
- Embedded DOCX/DOCM images are extracted into the local attachment store and linked to the owning atomic item. A compact image button opens a detail modal with item content and image previews.
- Evidence file rows keep expand and delete controls adjacent on the right-hand side.
- Workspace persistence now stores the complete local snapshot in IndexedDB and keeps only a bounded startup index in localStorage. A quota fallback compacts cache fields deterministically, so large DOCM/TR workspaces no longer raise `QuotaExceededError`.
- Database/runtime version is 52 / 9.2.0; previous assessor ratings, evidence roles, approvals, baselines, closure state, and immutable logs are preserved.

## Deployment boundary

The client package contains the collaboration client and the read-only monitor integration. Server replacement at `http://120.25.197.24` requires the operator's explicit deployment action; backend authentication and MySQL data remain server-owned.
