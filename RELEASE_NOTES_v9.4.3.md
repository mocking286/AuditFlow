# AuditFlow v9.4.3 Release Notes

## User-facing changes

- Replaced AuditFlow brand icon assets with the supplied `dataflow.png` visual across the extension, popup, workspace, help page, landing page and Audit Master.
- Preserved every Codex Assessment Assistant asset (`codex-assistant-flow-*`) and its existing in-app references.
- Included a loopback-only `start-auditflow-codex-bridge.cmd` launcher and dependency-free local Codex bridge.
- Increased the Codex opinion budget from 60 seconds to 300 seconds and passed the same budget to the bundled bridge.
- A model timeout is now reported as a model timeout, rather than incorrectly as a connection-script readiness error.

## Compatibility

- The extension version is `9.4.3`.
- The workspace database schema remains at version 57; existing evidence, trace links, findings, ratings and audit records remain intact.
- The independent `Trace relations` middle-column scrollbar from v9.4.2 remains in place.

## Local bridge

After extracting the package, run `start-auditflow-codex-bridge.cmd` and keep its window open. The bridge binds to `127.0.0.1:4173` and uses an already authenticated local Codex CLI (`codex login`) or an explicitly entered in-memory Virtual Key.
