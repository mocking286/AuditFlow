# AuditFlow v8.4.0 Release Notes

AuditFlow v8.4.0 focuses on auditable evidence semantics and controlled CL2 closure.

## Assessment controls

- Linkage rate, direct-evidence coverage, and assessor-review rate are independent metrics.
- Finding mappings use one primary BP/GP plus affected BP/GP entries, rationale, impact scope, and closure criteria.
- Uncalibrated mappings remain candidates and are excluded from formal consolidation and reports.
- PA 1.1, PA 2.1, and PA 2.2 each retain a checklist, evidence index, sampling record, rationale, and assessor gate.
- Weakness closure follows SUP.9 problem -> SUP.10 CR/no-CR -> updated work products -> verification/regression -> SUP.8 baseline -> closure approval.
- The close-assessment page exposes the minimum blocking set by process, PA, and BP/GP.

## Language and reporting

- English mode uses explicit bilingual data fields and no longer substitutes unknown content with `Original-language content`.
- English Word/HTML reports use the same structured fields as the review workbench.
- Reports state that related evidence cannot replace direct target-process evidence and AI conclusions require assessor review.

## Data consistency and security

- Evidence and assessment inputs receive stable fingerprints; similar evidence and matching snapshots require a user decision before reuse or re-assessment.
- Each assessment snapshot records data version, calculation basis/time, input fingerprint, change history, and assessor sign-off.
- Remote model review is disabled unless an AuditFlow-specific session is explicitly enabled.
- The local service does not inherit generic `OPENAI_API_KEY`, `OPENAI_BASE_URL`, or `OPENAI_MODEL` variables.
- Loopback POST requests enforce same-origin or configured extension-origin checks.

AI output remains advisory. It never overwrites human ratings, evidence confirmations, mapping calibration, PA review, baselines, or closure decisions.
