const profiles = {
  "7.3.0": { databaseSourceVersion: "7.2.0", sourceDatabasePort: 43319, databasePort: 43320, auditflowPort: 47273, fileanalystPort: 47274, jiraFlowPort: 47275, aiBridgePort: 47276 },
  "7.4.0": { databaseSourceVersion: "7.3.0", sourceDatabasePort: 43320, databasePort: 43321, auditflowPort: 47373, fileanalystPort: 47374, jiraFlowPort: 47375, aiBridgePort: 47376 },
  "7.5.0": { databaseSourceVersion: "7.4.0", sourceDatabasePort: 43321, databasePort: 43322, auditflowPort: 47483, fileanalystPort: 47484, jiraFlowPort: 47485, aiBridgePort: 47486 },
  "7.6.0": { databaseSourceVersion: "7.5.0", sourceDatabasePort: 43322, databasePort: 43323, auditflowPort: 47583, fileanalystPort: 47584, jiraFlowPort: 47585, aiBridgePort: 47586 },
  "7.7.0": { databaseSourceVersion: "7.6.0", sourceDatabasePort: 43323, databasePort: 43324, auditflowPort: 47683, fileanalystPort: 47684, jiraFlowPort: 47685, aiBridgePort: 47686 }
};

export function releaseProfile(version) {
  const profile = profiles[version];
  if (!profile) throw new Error(`Unsupported release profile: ${version}`);
  const digits = version.replaceAll(".", "");
  return Object.freeze({
    ...profile,
    version,
    digits,
    databaseName: `jeauditflow_${digits}`,
    databaseVolume: `jeauditflow_${digits}_mysql_data`,
    composeProject: `jeauditflow${digits}-local`
  });
}

export function rewriteDatabaseReleaseText(source, profile, relativePath) {
  if (relativePath.endsWith(".sql")) return source;
  const sourceDigits = profile.databaseSourceVersion.replaceAll(".", "");
  let rewritten = source
    .replaceAll(profile.databaseSourceVersion, profile.version)
    .replaceAll(`jeauditflow_${sourceDigits}`, profile.databaseName)
    .replaceAll(`jeauditflow${sourceDigits}-local`, profile.composeProject)
    .replaceAll(String(profile.sourceDatabasePort), String(profile.databasePort))
    .replace(/\bJEAuditFlow 7\.\d+(?:\.\d+)?\b/g, `JEAuditFlow ${profile.version}`);
  if (relativePath === "compose.yaml") {
    rewritten = rewritten.replace(/^name: jeauditflow-\d+-database$/m, `name: jeauditflow-${profile.digits}-database`);
  }
  return rewritten;
}

export function stampExtensionBackendOrigin(source, profile) {
  const declaration = /(\bconst defaultBackendOrigin = )["']http:\/\/127\.0\.0\.1:\d+["'];/;
  if (!declaration.test(source)) throw new Error("Extension backend default declaration was not found");
  return source.replace(declaration, `$1"http://127.0.0.1:${profile.auditflowPort}";`);
}
