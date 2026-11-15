import Foundation

@main
struct LauncherResponsivenessTests {
    @MainActor
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("jeauditflow-slow-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("local-deploy/config", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let config = directory.appendingPathComponent("7.5.0.local.env")
        try "AUDITFLOW_PORT=47583\nFILEANALYST_PORT=47584\nJIRAFLOW_PORT=47585\n"
            .write(to: config, atomically: true, encoding: .utf8)
        let heartbeat = Heartbeat()
        Task { @MainActor in heartbeat.didRun = true }
        let value = await performProjectRead {
            Thread.sleep(forTimeInterval: 0.25)
            return "loaded"
        }
        guard heartbeat.didRun, value == "loaded" else {
            fputs("FAIL: slow project I/O blocked MainActor scheduling\n", stderr)
            exit(1)
        }
        heartbeat.didRun = false
        Task { @MainActor in heartbeat.didRun = true }
        let ports = await runtimePorts(projectRoot: root, version: "7.5.0")
        guard heartbeat.didRun else {
            fputs("FAIL: project configuration I/O blocked MainActor scheduling\n", stderr)
            exit(1)
        }
        guard ports.auditflow == 47583 else { throw ResponsivenessFailure.configWasNotRead }
        print("PASS: slow project configuration I/O leaves MainActor responsive")
    }
}

@MainActor
private final class Heartbeat {
    var didRun = false
}

private enum ResponsivenessFailure: Error {
    case configWasNotRead
}
