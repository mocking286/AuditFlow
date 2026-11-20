# JEAuditFlow v7.9.6 Release Anchor

This commit anchors the `JEAuditFlow-v7.9.6` GitHub release. The complete
7.9.6 source snapshot is distributed as the release asset
`JEAuditFlow-7.9.6-Source.zip`; it was generated from the local
`AuditFlowDesktop71` candidate and is not the historical browser-extension
checkout represented by this repository.

## Candidate provenance

- Candidate directory:
  `AuditFlowDesktop71/artifacts/candidates/7.9.6-candidate-20261120-mysql974`
- Database profile: MySQL 9.7.4, `jeauditflow_796`, loopback port `43328`
- Local runtime verification: AuditFlow `48083`, FileAnalyst `48084`,
  JiraFlow `48085`, and AI bridge `48086` returned HTTP 200
- Package integrity: all eight archives passed the candidate
  `SHA256SUMS.txt` check before publication
- Publication boundary: local candidate/pre-release only; this release does
  not claim production deployment, clean-machine portability, notarization, or
  external model readiness

The release assets contain the source snapshot, web client, backend, browser
extension, database schema/import package, deployment support, macOS launcher,
manifests, release notes, and SHA-256 checksums. Runtime databases, logs,
credentials, and local deployment state are excluded.
