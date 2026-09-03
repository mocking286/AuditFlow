# AuditFlow v6.2 release notes

## AI bridge

The local bridge now prefers the authenticated Codex CLI session for AI opinion requests when no explicit in-session Virtual Key is configured. This prevents an inherited shell credential or an unavailable external provider from taking over the “AI Check Full Project” action. Codex response parsing now accepts the current nested JSON event shapes.

## Project overview

The overview now includes:

- an evidence-source fan chart for local uploads, Helix imports, assessment imports, and manual notes;
- a parsing histogram for parsed, metadata-only, and failed files;
- a BP/GP relationship chart comparing indicator totals, linked evidence, and assessor-confirmed relationships.

The charts use the extension's semantic theme variables and remain compatible with the light and GitHub Dark themes.

## Release

Extension version: 6.2.0. No credentials or runtime output files are included in the package.
