# AuditFlow Codex local bridge

Run start-auditflow-codex-bridge.cmd to start the optional local AI service included in this package.

The bridge serves AuditFlow on http://127.0.0.1:4173 and invokes an already
authenticated local Codex CLI without reading, displaying or transmitting credentials. An explicitly entered Virtual Key is also supported and remains only in the bridge process memory.

Complete `codex login` before starting the bridge, or use the in-app Virtual Key configuration after it is running. The CLI path checks only the exit status and passes the assessment prompt over stdin; it does not expose account details, configuration contents, tokens or CLI stderr to the browser. Opinion requests can run for up to five minutes so a cold local model session is not mistaken for an unavailable connection script.

If the bridge is not available, AuditFlow remains usable with local parsing,
manual assessment, evidence management, version comparison, and the local
ASPICE rule fallback.
