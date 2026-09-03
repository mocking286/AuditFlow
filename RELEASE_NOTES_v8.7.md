# AuditFlow v8.7.0 Release Notes

## Versioned upgrade

- The browser extension manifest, local report identity, help/manual labels,
  landing download link, and collaboration error guidance now identify
  AuditFlow 8.7.0.
- The workspace database advances from version 44 to 45. The migration keeps
  existing projects, human ratings, evidence links, baselines, collaboration
  state, and local attachment references; it only records the 8.7 release
  marker and migration event.
- Existing migration blocks for older releases remain intact so an upgrade
  from earlier workspaces is still supported.

## Login and collaboration

- The manifest now grants the extension permission for the configured ECS
  endpoint `http://120.25.197.24/*`; the permission is host-specific and does
  not enable arbitrary HTTP destinations.
- The extension-page email/password gate continues to use the configured
  collaboration endpoint and the installed extension origin
  `chrome-extension://dfnedpaiabanoeeffoonbnjhnipckkma`.
- Session tokens remain in session storage only. Passwords are not written to
  the package, local workspace, or logs.
- AI output remains advisory and cannot replace human ratings, evidence
  confirmation, baseline approval, trace decisions, or closure state.

## Packaging boundary

- Restored the bundled JSZip and PDF.js parser assets, including their
  licenses, so local DOCX/XLSX/PPTX/ZIP and PDF parsing does not depend on a
  missing runtime path after extension installation.
- Client files are for Edge and optional static website hosting.
- Server files are the collaboration-only Node service and its lock file.
- CEP evidence, reference models, MySQL credentials, `node_modules`, and
  runtime `output/` data stay outside the server deployment archive.
