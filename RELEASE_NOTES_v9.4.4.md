# AuditFlow v9.4.4 Release Notes

## User-facing changes

- Replaced the AuditFlow brand logo surfaces with the supplied orange code-document and blue-violet cloud-terminal PNG, including the extension icon sizes, popup, workspace favicon, help page, landing page and Audit Master mark. The package retains the supplied source image byte-for-byte; the SVG refers only to that original PNG and the required PNG sizes are full-frame resizes with no crop, redraw, overlay or filter.
- Preserved the independent Codex Assessment Assistant icon and its existing references.
- Kept the Trace relations center-column scrollbar from v9.4.2 and the local Codex bridge timeout improvements from v9.4.3.

## Compatibility

- The extension version is `9.4.4`.
- The workspace database schema remains at version 57; existing evidence, trace links, findings, ratings and audit records remain intact.

## Verification

- Manifest JSON, JavaScript syntax, logo dimensions and ZIP root layout are checked before packaging.
