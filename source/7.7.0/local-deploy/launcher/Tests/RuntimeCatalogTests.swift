import Foundation

@main
struct RuntimeCatalogTests {
    static func main() async throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("jeauditflow-runtime-catalog-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: root) }

        let versionsRoot = root.appendingPathComponent("local-deploy/runtime/versions", isDirectory: true)
        let databaseRoot = root.appendingPathComponent("local-deploy/runtime/database", isDirectory: true)
        try createRuntime(
            version: "7.2.0",
            versionsRoot: versionsRoot,
            databaseRoot: databaseRoot,
            complete: true
        )
        try createRuntime(
            version: "7.3.0",
            versionsRoot: versionsRoot,
            databaseRoot: databaseRoot,
            complete: false
        )
        try createRuntime(
            version: "7.5.0",
            versionsRoot: versionsRoot,
            databaseRoot: databaseRoot,
            complete: true
        )
        try createRuntime(
            version: "7.7.0",
            versionsRoot: versionsRoot,
            databaseRoot: databaseRoot,
            complete: true
        )

        let versions = installedRuntimeVersions(projectRoot: root)
        guard versions == ["7.2.0", "7.5.0", "7.7.0"] else {
            throw RuntimeCatalogTestFailure.unexpectedVersions(versions)
        }
        let configRoot = root.appendingPathComponent("local-deploy/config", isDirectory: true)
        try fileManager.createDirectory(at: configRoot, withIntermediateDirectories: true)
        try "AUDITFLOW_PORT=46973\nAUDITFLOW_LAN_HOST=192.0.2.99\n"
            .write(to: configRoot.appendingPathComponent("local.env"), atomically: true, encoding: .utf8)
        let default75 = RuntimePorts(auditflow: 47483, fileanalyst: 47484, jiraflow: 47485)
        guard await runtimePorts(projectRoot: root, version: "7.5.0") == default75 else {
            throw RuntimeCatalogTestFailure.staleLegacyPortsUsed
        }
        try "AUDITFLOW_PORT=47583\nFILEANALYST_PORT=invalid\nJIRAFLOW_PORT=99999\n"
            .write(to: configRoot.appendingPathComponent("7.5.local.env"), atomically: true, encoding: .utf8)
        guard await runtimePorts(projectRoot: root, version: "7.5.0") ==
                RuntimePorts(auditflow: 47583, fileanalyst: 47484, jiraflow: 47485) else {
            throw RuntimeCatalogTestFailure.versionConfigWasNotUsed
        }
        try "AUDITFLOW_PORT=47683\nFILEANALYST_PORT=47684\nJIRAFLOW_PORT=47685\n"
            .write(to: configRoot.appendingPathComponent("7.5.0.local.env"), atomically: true, encoding: .utf8)
        guard await runtimePorts(projectRoot: root, version: "7.5.0") ==
                RuntimePorts(auditflow: 47683, fileanalyst: 47684, jiraflow: 47685) else {
            throw RuntimeCatalogTestFailure.exactConfigWasNotPreferred
        }
        try "AUDITFLOW_PORT=47683\nFILEANALYST_PORT=47684\nJIRAFLOW_PORT=47685\nDB_PORT=43324\nJEAUDITFLOW_DATABASE_MODE=native\nJEAUDITFLOW_POLARION_URL=http://192.168.8.50:8080/polarion/\n"
            .write(to: configRoot.appendingPathComponent("7.7.0.local.env"), atomically: true, encoding: .utf8)
        let settings77 = await runtimeVersionSettings(projectRoot: root, version: "7.7.0")
        guard settings77.ports == RuntimePorts(
            auditflow: 47683,
            fileanalyst: 47684,
            jiraflow: 47685,
            mysql: 43324
        ), settings77.nativeMySQL else {
            throw RuntimeCatalogTestFailure.version77SettingsWereNotLoaded
        }
        guard settings77.polarionConfigured,
              settings77.polarionBaseURL == "http://192.168.8.50:8080/polarion/",
              isPrivatePolarionBaseURL("http://10.20.30.40:8080/polarion/"),
              isPrivatePolarionBaseURL("https://10.20.30.40/polarion/"),
              !isPrivatePolarionBaseURL("http://203.0.113.10/polarion/"),
              !isPrivatePolarionBaseURL("http://10.20.30.40/other/"),
              !isPrivatePolarionBaseURL("http://user@10.20.30.40/polarion/") else {
            throw RuntimeCatalogTestFailure.polarionTargetValidationFailed
        }
        let settings75 = await runtimeVersionSettings(projectRoot: root, version: "7.5.0")
        guard !settings75.polarionConfigured, settings75.polarionBaseURL == nil else {
            throw RuntimeCatalogTestFailure.polarionTargetValidationFailed
        }
        let legacyPorts = await runtimePorts(projectRoot: root, version: "6.9.0")
        guard defaultRuntimePorts(version: "7.4.0").auditflow == 47373,
              defaultRuntimePorts(version: "7.3.0").auditflow == 47273,
              legacyPorts.lanHost == "192.0.2.99" else {
            throw RuntimeCatalogTestFailure.legacyPortsChanged
        }
        let snapshot = await runtimeCatalogSnapshot(projectRoot: root)
        guard snapshot.versions == ["7.2.0", "7.5.0", "7.7.0"],
              snapshot.settings["7.5.0"]?.ports.auditflow == 47683,
              snapshot.settings["7.7.0"]?.polarionBaseURL == "http://192.168.8.50:8080/polarion/",
              snapshot.errorMessage == nil else {
            throw RuntimeCatalogTestFailure.snapshotMismatch
        }
        let missing = await runtimeCatalogSnapshot(projectRoot: root.appendingPathComponent("missing"))
        guard missing.versions.isEmpty, missing.errorMessage != nil else {
            throw RuntimeCatalogTestFailure.accessErrorWasHidden
        }

        if let projectRootPath = ProcessInfo.processInfo.environment["JEAUDITFLOW_PROJECT_ROOT"] {
            let actualVersions = installedRuntimeVersions(projectRoot: URL(fileURLWithPath: projectRootPath))
            guard actualVersions.contains("7.2.0") else {
                throw RuntimeCatalogTestFailure.actual72RuntimeMissing(actualVersions)
            }
            guard !actualVersions.contains("7.3.0") else {
                throw RuntimeCatalogTestFailure.incomplete73RuntimeWasListed(actualVersions)
            }
            print("Actual runtime catalog passed: \(actualVersions.joined(separator: ", "))")
        } else {
            print("Runtime catalog selection passed: \(versions.joined(separator: ", "))")
        }
    }

    private static func createRuntime(
        version: String,
        versionsRoot: URL,
        databaseRoot: URL,
        complete: Bool
    ) throws {
        let fileManager = FileManager.default
        let runtime = versionsRoot.appendingPathComponent(version, isDirectory: true)
        let database = databaseRoot.appendingPathComponent(version, isDirectory: true)
        try fileManager.createDirectory(at: runtime, withIntermediateDirectories: true)
        let manifest = """
        {
          "version": "\(version)",
          "directories": ["server", "fileanalyst", "jiraflow", "client"]
        }
        """
        try manifest.write(to: runtime.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)

        guard complete else { return }
        for relativePath in [
            "server/server.mjs",
            "fileanalyst/server.mjs",
            "jiraflow/jiraflow.jar",
            "client/index.html"
        ] {
            let file = runtime.appendingPathComponent(relativePath)
            try fileManager.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data().write(to: file)
        }
        let clientManifest = """
        {
          "version": "\(version)",
          "packageType": "web-client",
          "compatibleBackendRange": "\(version.split(separator: ".").prefix(2).joined(separator: ".")).x"
        }
        """
        try clientManifest.write(to: runtime.appendingPathComponent("client/manifest.json"), atomically: true, encoding: .utf8)

        let databaseManifest = """
        {
          "version": "\(version)",
          "defaultDatabase": "jeauditflow_\(version.filter(\.isNumber))",
          "persistentVolume": "jeauditflow_\(version.filter(\.isNumber))_mysql_data"
        }
        """
        try fileManager.createDirectory(at: database.appendingPathComponent("schema", isDirectory: true), withIntermediateDirectories: true)
        try databaseManifest.write(to: database.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
        try Data().write(to: database.appendingPathComponent("schema/collaboration-schema.sql"))
    }
}

enum RuntimeCatalogTestFailure: Error {
    case unexpectedVersions([String])
    case actual72RuntimeMissing([String])
    case incomplete73RuntimeWasListed([String])
    case staleLegacyPortsUsed
    case versionConfigWasNotUsed
    case exactConfigWasNotPreferred
    case version77SettingsWereNotLoaded
    case polarionTargetValidationFailed
    case legacyPortsChanged
    case snapshotMismatch
    case accessErrorWasHidden
}
