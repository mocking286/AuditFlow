# AuditFlow v7.7.0

AuditFlow v7.7 upgrades the formal report to match the visual and analytical structure of professional ASPICE assessment reports (SWA 502089 style), and adds data-driven per-process General Strengths, Weaknesses, and Recommendations with a traceable analysis process.

## Professional report styling

- Teal brand palette `#008C82` for the cover label, section titles, running head/foot, table header bars and capability chart, matching the professional assessment report template.
- Rating chip scale follows the professional report legend: N `#DD0028` (red) · P `#FF9203` (orange) · L `#FCE514` (yellow) · F `#2A9C2A` (green), applied across the BP/PA/GP matrix, risk dashboard, legends and detailed results.
- Grey finding boxes (`#EDEDED`) with tone-coded left borders (green strength / red weakness / orange recommendation) and striped evidence tables (`#F2F2F2`), mirroring the reference report layout.
- Detailed results now open with `Scope limitations`, `Level 1 Results → BPs - Base Practices` (rating-led BP list), `PA1.1`, `Level 2 Results → PA2.1 / PA2.2` — the same section rhythm as the professional report.
- The same palette and blocks are emitted by the backend Word export (`WORD_CSS`), so Word/PDF outputs match the on-screen report.

## General Strengths, Weaknesses, and Recommendations (GSWR)

- New report section `2.4 General Strengths, Weaknesses, and Recommendations` aggregates findings across the formal scope.
- Every process chapter (`3.x`) now ends with its own GSWR block: Strength / Weakness / Recommendation, derived from the actual workspace data — assessor records, BP/GP ratings, evidence sufficiency and closure-evidence suggestions — never from static template text.
- Each process GSWR is followed by an `分析过程 / Analysis process` box that records the real derivation trail: evidence parsed → per-indicator BP/GP rating distribution → PA hard-gate aggregation (PA 1.1 / PA 2.1 / PA 2.2) → record consolidation (S/W/R counts, drafts, open weaknesses) → capability level and coverage. All numbers reference the live assessment results.

## Upgrades

- Extension version 7.7.0; workspace database migration to version 33 preserves all existing projects, ratings, evidence, collaboration revisions and settings.
- Release smoke checks now assert the v7.7 assets and the new GSWR report functions.
- Codex assessment assistant and all v7.6 assessment guardrails remain available.

## Notes

- GSWR content is only as good as the underlying data: processes without assessor records or with unparsed evidence will show the derivation trail with empty/gap entries, which is intentional and assessor-verifiable.
- All report conclusions remain AI-supported candidates; formal ratings and closure still require assessor confirmation.
