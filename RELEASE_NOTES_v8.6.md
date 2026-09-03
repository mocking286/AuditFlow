# AuditFlow v8.6.0 Release Notes

## CEP Workspace Boundary

- The v8.6 migration retains only `ASP-CEP-XP-2026` and removes non-CEP projects and non-CEP inputs.
- The package includes the ten files from the supplied CEP folder. They are parsed locally only after the configured administrator opens the workspace.
- The bundled TR file is treated as one corroborating traceability report. It produces auditable SYS/SWE observations from explicit traceability gaps and never becomes a set of independent document entries.

## Assessment Controls

- `Automotive_SPICE_PAM_4.0_Guidelines_2.0_YellowDraft 1.pdf` is represented under Audit Models as a scoring reference for PA 1.1, PA 2.1, PA 2.2, N/P/L/F, and CL2 hard gates.
- AI output remains advisory. Related traceability evidence does not replace direct target-process implementation evidence.
- Assessment review opens in a full browser workspace with a stable evidence and edit layout.

## Accounts And Collaboration

- Only `yumeng.li@johnsonelectric.com` receives the Administrator role.
- The extension page itself provides an email/password login gate, logout, and account switching. Passwords are submitted only to the configured AuditFlow collaboration endpoint and are never stored in the package or workspace.
- Other authenticated accounts are viewers with no project shown on the main screen. The account control supports logout and switching accounts.
- Public cloud projects use an exclusive project-session lease in addition to BP/GP locks. While one user holds the project session, other users cannot obtain edit locks or submit changes.

## Local Codex Connection

- The local Codex status probe now allows a 15-second cold-start window while retaining the loopback-only endpoint rule.
