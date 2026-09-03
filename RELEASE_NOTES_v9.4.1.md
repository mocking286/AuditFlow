# AuditFlow v9.4.1 Release Notes

## User-facing changes

- Replaced all branded extension icon assets with the supplied orange AI logo; generated 16/32/48/128 PNG variants and an SVG source.
- Updated the extension version to `9.4.1`.
- Shortened the manifest description to remain below Microsoft Edge Add-ons' 132-character limit.

## Verification

- Manifest JSON and description length are checked before packaging.
- PNG dimensions, SVG references, JavaScript syntax, archive integrity and SHA-256 are checked during packaging.
