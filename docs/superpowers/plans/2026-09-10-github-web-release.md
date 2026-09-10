# AuditFlow GitHub Web Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AuditFlow repository's local and GitHub workflows reliably validate, package, commit, and push the static web/Edge extension application with one repeatable command.

**Architecture:** Replace the invalid Node/Webpack workflow with a static-asset CI workflow. Add a repository-owned release script that runs manifest/JavaScript/HTML/archive checks, creates a clean versioned ZIP, and optionally commits and pushes through the configured `origin` remote. Keep credentials outside the repository and require explicit command flags for mutating Git operations.

**Tech Stack:** Bash, Node.js built-in `fs`/`assert`, ZIP utilities, GitHub Actions, Manifest V3 browser extension assets.

**Spec:** User request to associate Codex with `https://github.com/mocking286/AuditFlow` and enable one-click commit/push of the latest web client.

## Global Constraints

- The canonical source is `/Users/maplemock/Documents/GitHub/AuditFlow`, not the unrelated `/Users/maplemock/Downloads/codex/codex` checkout.
- The only Git remote is `origin=https://github.com/mocking286/AuditFlow.git`; do not commit credentials, tokens, Virtual Keys, or local browser data.
- The current app is a static web/Manifest V3 extension; do not add a Node/Webpack build requirement that the repository does not contain.
- Preserve formal-scope, evidence-role, human-review, versioning, closure-gate, privacy, and report-integrity behavior while touching release configuration.
- Payment is not required for any step.

---

### Task 1: Add deterministic local release validation and packaging

**Files:**
- Create: `scripts/release-web.sh`
- Create: `scripts/verify-web-release.mjs`
- Create: `scripts/README.md`
- Create: `.release-manifest`

**Interfaces:**
- `scripts/verify-web-release.mjs` accepts the repository root as `argv[2]` and exits nonzero on an invalid manifest, missing referenced assets, JavaScript syntax errors, or forbidden local data.
- `scripts/release-web.sh` accepts `check`, `package`, `commit`, and `push`; `commit` requires `RELEASE_MESSAGE`, while `push` performs the same checks before `git push origin HEAD:main`.
- `.release-manifest` lists clean package paths, one per line, with comments beginning with `#`.

- [ ] **Step 1: Write the failing verification contract**

Create the verifier so it checks the current repository's actual `manifest.json`, its referenced files, all tracked JavaScript/MJS files, and the absence of browser data directories in the package manifest.

- [ ] **Step 2: Run the verifier before implementation is complete**

Run `node scripts/verify-web-release.mjs .` and confirm it fails because the package manifest and release script do not exist yet.

- [ ] **Step 3: Implement the verifier and package manifest**

Use Node's standard library only. Resolve every `manifest.action.default_popup`, `manifest.background.service_worker`, `manifest.icons`, and content-script path relative to the repository root; run `node --check` on each `.js`/`.mjs` source file; reject `localStorage` export files, IndexedDB dumps, `.env*`, credentials, and `node_modules` from the package list.

- [ ] **Step 4: Implement the release script**

Make the script use `set -euo pipefail`, derive its root from the script location, call the verifier, build `dist/AuditFlow-v<manifest.version>-extension.zip` with root-level files, run `unzip -tqq`, and print SHA-256. `commit` and `push` must show the exact staged files and use the configured Git identity.

- [ ] **Step 5: Run local checks**

Run `bash scripts/release-web.sh check` and `bash scripts/release-web.sh package`; expect success, a clean ZIP, and a checksum.

- [ ] **Step 6: Document one-click usage**

Document `check`, `package`, `commit`, and `push`, the `RELEASE_MESSAGE` requirement, the GitHub CLI/auth prerequisite, and the fact that push targets `origin/main`.

---

### Task 2: Replace the broken GitHub Actions workflow

**Files:**
- Delete: `.github/workflows/webpack.yml`
- Create: `.github/workflows/web-release.yml`

**Interfaces:**
- `web-release.yml` runs on pushes and pull requests to `main`, plus `workflow_dispatch` with a `publish` boolean input.
- The workflow runs the repository verifier on Node 20, packages the extension, uploads the ZIP and checksum as an artifact, and only pushes a GitHub release when manually dispatched with `publish=true` and `GITHUB_TOKEN` permissions are available.

- [ ] **Step 1: Define CI checks**

Use `actions/checkout@v4`, `actions/setup-node@v4` with Node 20, then invoke `node scripts/verify-web-release.mjs .` and `bash scripts/release-web.sh package`.

- [ ] **Step 2: Define artifact upload**

Upload `dist/AuditFlow-v*-extension.zip` and its `.sha256` file with `actions/upload-artifact@v4`.

- [ ] **Step 3: Define guarded manual publication**

Add a `publish` input and a separate `release` job gated by `github.event_name == 'workflow_dispatch' && inputs.publish == true`; create a GitHub release with `gh release create` using the generated ZIP and checksum. Do not publish on ordinary pushes or pull requests.

- [ ] **Step 4: Validate workflow structure**

Parse the YAML with Ruby/Python if available, scan for the old `npm install`/`webpack` commands, and confirm the workflow references only existing scripts and artifact paths.

---

### Task 3: Align repository metadata and verify the complete flow

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `.gitignore`
- Create: `scripts/commit-and-push-web.command`

**Interfaces:**
- `scripts/commit-and-push-web.command` calls `scripts/release-web.sh push` after collecting a commit message from the first argument or an interactive prompt.
- Documentation states the canonical checkout path, remote, branch, local command, GitHub Actions manual publish path, and that credentials remain in Git Credential Manager/GitHub CLI.

- [ ] **Step 1: Add macOS one-click launcher**

Create an executable `.command` wrapper that changes to the repository root, requires a nonempty commit message, runs the guarded push command, and leaves the terminal open on failure.

- [ ] **Step 2: Update documentation and ignore rules**

Add release instructions and ignore `dist/`, `.DS_Store`, `.env*`, and browser/workspace data artifacts without ignoring source templates or reference material.

- [ ] **Step 3: Run end-to-end verification**

Run the verifier, package builder, `git diff --check`, `git status --short`, inspect the staged diff, and run `git ls-remote origin main` to verify the authenticated remote is reachable.

- [ ] **Step 4: Commit the configuration**

Commit only the release integration files with `git commit -m "ci: configure one-click web release workflow"`; do not commit existing `.idea` files unless they are already tracked by the user.

---

## Self-Review Checklist

- The invalid webpack job is removed and no package manager is required for this static repository.
- Local package validation covers manifest references, syntax, archive layout, and secret/data exclusions.
- Automatic CI validates every change; publication remains an explicit manual action.
- Local one-click push and GitHub Actions publication use the same package/check gates.
- No credentials or customer evidence are read, copied, or stored by the new scripts.
