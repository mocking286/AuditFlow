# JEAuditFlow v8.0.0 Release Anchor

This commit anchors the `JEAuditFlow-v8.0.0` GitHub release. The complete
8.0.0 source snapshot is distributed as the release asset
`JEAuditFlow-8.0.0-Source.zip`; this repository checkout is the release index
and does not contain the local candidate workspace or customer audit data.

## Candidate provenance

- Candidate directory:
  `AuditFlowDesktop71/artifacts/candidates/8.0.0-candidate-20261123-final`
- Release directory:
  `AuditFlowDesktop71/artifacts/candidates/8.0.0-candidate-20261123/release`
- Database profile: native MySQL 9.7.4, `jeauditflow_800`, isolated volume
  `jeauditflow_800_mysql_data`, loopback port `43329`
- Local runtime ports: AuditFlow `48183`, FileAnalyst `48184`, JiraFlow
  `48185`, and AI bridge `48186`
- Package integrity: all eight component archives, the Complete Install ZIP,
  manuals, manifests, and release notes passed the candidate checksum checks;
  all release ZIPs passed `unzip -tqq`
- Source snapshot: 66 synthetic regression test files, including the 8.0
  empty-formal-scope regression coverage

## 8.0.0 correction

- A standard AI pre-assessment stops before creating a job or mutating the
  project when the assessor-confirmed formal process scope is empty.
- `empty-indicators` backend responses do not fall back to a local
  zero-indicator assessment or report a false completion.
- Tree View and AI Review explain that imported process candidates are
  advisory only. Empty states and project navigation open the existing formal
  scope editor so the assessor can confirm the scope explicitly.
- Formal scope, evidence roles, ratings, evidence confirmation, and closure
  decisions remain assessor-controlled.

## Verification

- WebApp checks: `npm run check` passed.
- WebApp tests: `450` passed, `0` failed, `1` skipped because PowerShell is not
  available on this macOS host.
- Focused 8.0 workbench regression: `11` passed.
- 8.0 packaging contract tests: `6` passed.
- macOS launcher signature verification passed before and after extraction.

## Published artifact hashes

The release asset `SHA256SUMS.txt` is authoritative. The primary delivery
hashes are recorded here for release-anchor review:

| Asset | SHA-256 |
| --- | --- |
| `JEAuditFlow-8.0.0-Backend.zip` | `4e69ceb8454361e0f7667328803d01f640f5260e40143b25e995ad0843018dc1` |
| `JEAuditFlow-8.0.0-Browser-Extension.zip` | `ff720ed7e4a77476f69e2897411d40fd1aa12c19077e007c1cba9c84750cdf7f` |
| `JEAuditFlow-8.0.0-Database.tar.gz` | `bc08972f00b566c243657a8150c8c0929706b075e18bdcfcc45ffb6011ce49e3` |
| `JEAuditFlow-8.0.0-Database.zip` | `831478e949ce83fea43ad956312182402a038f2b7944aa60bb356067a5d28459` |
| `JEAuditFlow-8.0.0-Deployment-Support.zip` | `7cf3fc727abe44409e425fea91255c3112cbdfc5683e9dd005d7649b7bd71966` |
| `JEAuditFlow-8.0.0-macOS-Launcher.app.zip` | `db3fc00942f7dbae862758c536d051f7196b48d124886ad4d5c2d8ae391fd5e5` |
| `JEAuditFlow-8.0.0-Source.zip` | `4dcd3027d677a6e0b8510776d35df36352944193954e8fb93a8de3bb8e2f8517` |
| `JEAuditFlow-8.0.0-Web-Client.zip` | `f3e52ba46dbef2750e633bebb889ffa765cd423931bea2dc2a12bd52d5eed8ac` |
| `JEAuditFlow-8.0.0-Complete-Install.zip` | `9689309fd4a045db88c12a321496058f469e349186baae73cc1d132c1794ae5e` |

## Publication boundary

This anchor and its release assets describe a local candidate/pre-release.
They do not claim production deployment, clean-machine portability, Apple
notarization, live MySQL operation, external provider/account readiness,
browser-store publication, or multi-device Wi-Fi acceptance. The database
package contains fresh-install schema and tooling only; no user database,
credentials, sessions, uploads, logs, or customer evidence are included.
