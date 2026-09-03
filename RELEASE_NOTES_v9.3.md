# AuditFlow v9.3.0 Release Notes

## Fixed

- DOCX/DOCM drawing-only paragraphs are retained as image references instead of being dropped during atomic item creation.
- Image relationships are resolved with namespace-aware Office relationship attributes and normalized media paths.
- Orphaned embedded images become explicit image-only evidence items, so every image remains reviewable and traceable.
- Scope & Evidence and List View show an image action on each item that has embedded images. The action opens the item text, source locator and all attached images from local IndexedDB.

## Assessment logic

- Evidence matching now ranks atomic items by target process, evidence role, objective text, locators, structured rows and image context.
- Automatic BP mapping uses an atomic item key, preventing one large source file from being reused as broad evidence for every BP.
- Candidate PA ratings use the weakest assessed indicator as the bound; arithmetic means remain display-only and cannot hide a critical N/P result.
- Capability candidates follow explicit CL1-CL5 gates: current-level PAs must be at least L and all lower PAs must be F. No positive objective evidence remains N.
- Codex instructions now state the ISO/IEC 33020 percentage bands and the direct/corroborating/index-only evidence guardrail.

## UI and branding

- Extension manifest and all toolbar/popup/help/Codex assistant icon references use the new orange/black AuditFlow logo.
- Added a Trace-inspired neutral gray shell with a pale-blue top menu and a lower-left utility rail: Latest change, Model browser and Chat.

## Versioning

- Extension runtime: `9.3.0`.
- Local workspace migration: `55`.
- Image evidence migration: `2`.
- Rating model: `2`.
