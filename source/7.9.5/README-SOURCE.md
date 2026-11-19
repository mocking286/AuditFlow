# JEAuditFlow 7.9.5 Source (server install)

- `backend/server`, `backend/fileanalyst`: 7.9.5 API and FileAnalyst sources from the uploaded 7.9.5 candidate, with server-install fixes (see `releases/7.9.5/FIXES-7.9.5-ZH.md`). The first commit on this path is the upload as received.
- `database/`: native MySQL schema package for `jeauditflow_795`.
- `deploy/`: Linux installer, systemd units, env template, nginx site, `jeauditflowctl`, `verify.sh`, optional MySQL compose file.
- `scripts/build-7.9.5-release.mjs`: builds all release artifacts.

The web client is built from `source/7.7.0/src/AuditFlowDesktop/WebApp` because no 7.9.5 client source was published. The JiraFlow and MySQL Connector/J jars are not stored in git; the build reads them from the uploaded `JEAuditFlow-7.9.5-Backend.zip` and verifies the JiraFlow jar against `backend/manifest.json` (its source hash matches `source/7.7.0/src/JiraFlow`).

```sh
# Node.js 26.13.1, zip/unzip, GNU tar
node source/7.9.5/scripts/build-7.9.5-release.mjs \
  --backend-zip /path/to/JEAuditFlow-7.9.5-Backend.zip --out /tmp/jeauditflow-7.9.5
```
