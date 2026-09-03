# AuditFlow v6.3

## Included changes

- Renamed the project trace action to **AL Project Traceability Check**.
- When the authenticated local Codex CLI is available, AL checks request `gpt-5.6-luna`; a missing supplement no longer produces a misleading backend-unavailable message.
- Added an AI review stage between Consolidate and Versions. It reviews final records only, stores an `aspice-audit-master` source version, and presents only ASPICE BP/GP Codex reference-score candidates.
- Final records can move back to Waiting for consolidation.
- Version comparison now includes the user-operation snapshot captured in each version.
- Column configuration uses an accessible funnel icon; dashboard deletion uses a trash icon beside the open-project action.
- Overview progress bars are colour-coded. Parsing and trace progress now reports user uploads, selected Helix items, and BP/GP link coverage without claiming a generic 100% state.

## Safety boundary

Codex outputs are reference candidates. They do not replace the assessor's evidence review, formal rating, or certification decision.
