# AuditFlow v7.5.0

## What changed

AuditFlow v7.5 keeps the local extension as the working surface and adds a deployable cloud boundary for later Vercel use. The assessment command bar is fixed in the project flow and uses compact Trace-inspired controls for Scope, Grid, List, Report, Close, Microsoft identity and cloud revision actions. The bar is in normal layout flow with a sticky position, so it remains visible without covering the workbench.

The new `api/` and `cloud/` files are a Vercel-ready backend contract:

- Vercel Functions handle health, Microsoft Entra OIDC validation, project snapshots, members, revision events and server-side AI issue analysis.
- Marketplace Postgres stores tenant-scoped JSONB snapshots, project members and revision events. `cloud/db/schema.sql` is the initial schema.
- Extension sign-in uses a public client and Authorization Code + PKCE. No client secret is bundled.
- Database roles are authoritative. A browser-submitted role is never trusted for writes.
- Concurrent edits use expected revisions. A conflict stops overwriting and requires pull plus assessor review.
- A 15-second event poll marks a remote update without replacing unsaved local work.
- Original evidence binaries stay local. Metadata-only cloud snapshots are limited to 3.5 MB and local parsed evidence is restored after a pull.

## Workbook and AI workflow

Importing a WBS/OPL workbook keeps source sheet and row locators, recognizes process candidates such as `SYS.1`, `SYS.2/SWE.1`, `MAN.3`, `SUP.8` and `SWE.1-SWE.6`, and classifies `Open`, `On Going/In Progress` and `Closed` rows. Scope shows candidate processes and counts before formal assessment. Adding a candidate to formal scope is an assessor action.

After a process mapping is confirmed, its issue/opinion/solution becomes one of up to 30 project-scoped assessor examples. Online AI receives only the visible issue batch and these examples as style guidance. AI output remains a candidate: it cannot create a formal rating, change scope, or close a finding. The assessor creates the record, links evidence and performs the final rating.

## Deployment boundary

This package does not create or purchase Vercel, Postgres, Microsoft Entra, AI or other cloud resources. Configure those resources later using `cloud/README.md` and `.env.example`. Until then, local rule assessment, local parsing, local records and the local protocol preview remain available.
