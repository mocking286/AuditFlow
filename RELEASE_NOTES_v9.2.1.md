# AuditFlow v9.2.1 Release Notes

## Fixed

- Restores atomic parsing for the nine bundled CEP initial sources. The package now contains the previously omitted Project Plan, Quality Plan, and System Specification files.
- Replaces the all-or-nothing CEP import with per-file recovery. A missing or unreadable source is reported without preventing the remaining bundled files from being parsed.
- Adds a one-time parser migration that reprocesses prior one-item CEP placeholders while retaining unrelated user uploads, evidence IDs, trace links, assessor classifications, ratings, records, baselines, and audit logs.
- Namespaces embedded Office image attachment IDs by evidence file so images from separate DOCX/DOCM sources cannot overwrite one another.
- Retains the v9.2 IndexedDB workspace persistence fix for large evidence packages.

## Versioning

- Extension runtime: `9.2.1`.
- Local workspace migration: `53`.
- CEP bundled parser revision: `2`.
