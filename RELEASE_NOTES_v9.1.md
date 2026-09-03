# AuditFlow v9.1.0 Release Notes

## Scope

AuditFlow v9.1.0 is a client-only Edge extension update. Backend deployment and account provisioning remain the operator's responsibility.

## Delivered

- Server-bound Backend Monitor defaults to `http://120.25.197.24` and starts in English. The settings page keeps monitor configuration administrator-only.
- English-first authentication with an explicit Log in / Sign up split, language toggle, account sign-out and account switching. Non-administrator accounts can see the workspace dashboard, project list, and New assessment entry points; role checks still protect project mutations.
- Trace-style review layout places Process scope and Active indicator side by side and moves the wide process/indicator/BP description table below the main review area.
- Coverage metrics are computed from actual links and assessor confirmations. AI direct-evidence inference is capped at one candidate per BP; further links require manual confirmation.
- Leadership PPT export uses the supplied Intacs Agile-SPICE template as a six-slide editable brief, with selected BP/GP explanations and `ppt/auditflow-report.json` trace payload.
- Upload allowlist removed. Evidence groups expose a confirmed one-click file delete with audit-log cleanup. DOCM uses the Office Open XML parser; the new CEP seed includes the supplied System Architecture and Software Specification DOCM files.
- TR PDF parsing creates customer-requirement atoms (`CUS` / `JE`) whose descriptions include downstream SYS/SYSA/SW/HW trace IDs. These atoms remain corroborating evidence and are available for granular scope selection.
- Metrics view shows finding-type distribution bars, created/modified summary cards, and a nonconformance panel.

## Verification boundaries

- The public health endpoint at `http://120.25.197.24/api/health` was reachable during packaging. The monitor-specific endpoint still requires a valid server session; this package does not modify backend authentication or data.
- AI output remains advisory. Human ratings, evidence roles, approvals, baselines, closure state, and immutable logs are not overwritten by automatic parsing or export.
