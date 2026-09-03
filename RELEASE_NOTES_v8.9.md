# AuditFlow v8.9.0 Release Notes

## Local English translation layer

- English mode now uses a deterministic local translation pipeline: exact UI phrases, semantic audit vocabulary, structured `*En` fields, and a memoized per-string cache.
- Grid View, List View, Scope document items, assessment records, reports, imported issue observations, and the ASPICE standards library use isolated English display data. The Chinese source remains unchanged for editing and audit traceability.
- Dynamic content inserted after navigation or modal actions is observed and translated with the same pipeline. The implementation does not require a paid service or an external translation API.
- HTML tags, code-like identifiers, URLs, file locators, ratings, process IDs, and evidence codes remain structurally intact. Unsupported free-text is represented as `Details` rather than the old source-language placeholder.

## Release metadata

- Extension manifest version: `8.9.0`
- Workspace migration version: `48`
- Translation layer version: `3`
- Formal ratings, assessor review, evidence confirmation, baseline approval, and closure state remain human-controlled.
