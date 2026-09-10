# AuditFlow release commands

Run these commands from the repository root (`/Users/maplemock/Documents/GitHub/AuditFlow`):

```bash
bash scripts/release-web.sh check
bash scripts/release-web.sh package
RELEASE_MESSAGE="fix: update AuditFlow web client" bash scripts/release-web.sh push
```

`check` validates the Manifest V3 JSON, every referenced asset, JavaScript/MJS syntax, the release manifest, Git remote, and whitespace. `package` creates a clean `dist/AuditFlow-v<manifest.version>-extension.zip` and a SHA-256 sidecar. `commit` packages and commits the selected release files. `push` performs the same checks, commits, and pushes `HEAD` to `origin/main`.

The repository is configured for `https://github.com/mocking286/AuditFlow.git`. Authenticate Git operations with GitHub CLI or the operating system credential manager; never put a token, Virtual Key, browser profile, customer evidence, or local workspace data in this repository.

GitHub Actions runs the same checks for every push and pull request. To create a GitHub release, use the `Web release` workflow's `workflow_dispatch` action and set `publish` to `true`; normal pushes only publish a downloadable CI artifact.
