import XCTest
@testable import AtlassianServiceLauncher

final class StartupFailureDiagnosticsTests: XCTestCase {
    func testBridgeConnectionDetailsAcceptsOneTimeLoopbackConnection() throws {
        let details = try BridgeConnectionDetails.parse("""
        {"remoteOrigin":"http://127.0.0.1:47583","sessionId":"SESSION_1","connectorToken":"\(String(repeating: "a", count: 32))"}
        """)

        XCTAssertEqual(details.remoteOrigin, "http://127.0.0.1:47583")
        XCTAssertEqual(details.jiraURL, "http://127.0.0.1:47583/bridge/sessions/SESSION_1/jira/secure/Dashboard.jspa")
    }

    func testBridgeConnectionDetailsPreservesAuthorizedServiceRoutes() throws {
        let details = try BridgeConnectionDetails.parse("""
        {"remoteOrigin":"http://127.0.0.1:47583","sessionId":"SESSION_1","connectorToken":"\(String(repeating: "a", count: 32))","routes":["jira","confluence","polarion"]}
        """)

        let encoded = try JSONEncoder().encode(details)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["routes"] as? [String], ["jira", "confluence", "polarion"])
        XCTAssertEqual(details.enabledRoutes, ["jira", "confluence", "polarion"])
        XCTAssertEqual(
            details.connectedStatus(lastActivity: "尚未收到服务请求"),
            "已授权远端 JEAuditFlow · 路由：Jira、Confluence、Polarion · 尚未收到服务请求"
        )
    }

    func testPolarionTargetKeepsItsFixedContextPathAndRejectsUntrustedPaths() throws {
        let target = try PolarionTarget.parse("http://192.168.1.20/polarion/")

        XCTAssertEqual(try target.url(for: "/").absoluteString, "http://192.168.1.20/polarion/")
        XCTAssertEqual(try target.url(for: "/rest/api?limit=10").absoluteString, "http://192.168.1.20/polarion/rest/api?limit=10")
        XCTAssertThrowsError(try PolarionTarget.parse("http://example.com/polarion/"))
        XCTAssertThrowsError(try target.url(for: "/../admin"))
        XCTAssertThrowsError(try target.url(for: "//attacker.invalid/"))
    }

    func testPolarionTargetRejectsHostnamesThatOnlyResemblePrivateAddresses() {
        for host in ["127.attacker.invalid", "fc-attacker.invalid", "fd-attacker.invalid", "fe80.attacker.invalid", "192.168.1.x.20"] {
            XCTAssertThrowsError(try PolarionTarget.parse("http://\(host)/polarion/"), host)
        }
        for host in ["127.0.0.1", "10.20.30.40", "[fd00::1234]", "[fe80::1234]", "[::1]"] {
            XCTAssertNoThrow(try PolarionTarget.parse("http://\(host)/polarion/"), host)
        }
    }

    func testPolarionConfigurationPreservesSavedTargetBeforeDiscoveringProject() throws {
        let target = PolarionTargetConfiguration.resolve(
            environmentValue: nil,
            savedValue: "http://192.168.1.20/polarion/",
            projectRoot: URL(fileURLWithPath: "/configured/project"),
            readText: { _ in XCTFail("Saved target must not read project configuration"); return nil }
        )
        XCTAssertEqual(try XCTUnwrap(target).baseURL.absoluteString, "http://192.168.1.20/polarion/")
    }

    func testPolarionConfigurationDiscoversOnlyCurrentRegisteredProjectVersion() throws {
        let root = URL(fileURLWithPath: "/configured/project")
        let contents = [
            "/configured/project/local-deploy/runtime/current-version": "7.7.0\n",
            "/configured/project/local-deploy/config/7.7.local.env": "IGNORED=value\nJEAUDITFLOW_POLARION_URL='http://192.168.1.20/polarion/'\n"
        ]
        let target = PolarionTargetConfiguration.resolve(
            environmentValue: "http://192.168.x.x/polarion/",
            savedValue: "",
            projectRoot: root,
            readText: { contents[$0.path] }
        )
        XCTAssertEqual(try XCTUnwrap(target).baseURL.absoluteString, "http://192.168.1.20/polarion/")
    }

    func testPolarionConfigurationFallsBackToCurrentRuntimeAndRejectsUnsafeVersion() throws {
        let root = URL(fileURLWithPath: "/configured/project")
        let contents = [
            "/configured/project/local-deploy/runtime/current-version": "7.7.0\n",
            "/configured/project/local-deploy/runtime/env/7.7.0.env": "JEAUDITFLOW_POLARION_URL=http://10.20.30.40/polarion/\n"
        ]
        let target = PolarionTargetConfiguration.resolve(
            environmentValue: nil, savedValue: nil, projectRoot: root,
            readText: { contents[$0.path] }
        )
        XCTAssertEqual(try XCTUnwrap(target).baseURL.absoluteString, "http://10.20.30.40/polarion/")
        XCTAssertNil(PolarionTargetConfiguration.resolve(
            environmentValue: nil, savedValue: nil, projectRoot: root,
            readText: { $0.lastPathComponent == "current-version" ? "../../unexpected" : "JEAUDITFLOW_POLARION_URL=http://10.20.30.40/polarion/" }
        ))
    }

    func testBridgeRouteMapsOnlyAuthorizedServicePaths() throws {
        let target = try PolarionTarget.parse("http://192.168.1.20/polarion/")

        XCTAssertEqual(
            try BridgeRouteURL.make(route: "polarion", path: "/rest/api", polarionTarget: target).absoluteString,
            "http://192.168.1.20/polarion/rest/api"
        )
        XCTAssertEqual(
            try BridgeRouteURL.make(route: "jira", path: "/secure/Dashboard.jspa", polarionTarget: target).absoluteString,
            "http://127.0.0.1:8080/secure/Dashboard.jspa"
        )
        XCTAssertThrowsError(try BridgeRouteURL.make(route: "jira-api", path: "/", polarionTarget: target))
    }

    func testBridgeConnectionDetailsRejectsCredentialBearingOriginAndShortToken() {
        XCTAssertThrowsError(try BridgeConnectionDetails.parse("""
        {"remoteOrigin":"https://user:password@example.com","sessionId":"SESSION_1","connectorToken":"short"}
        """))
    }

    func testFailureSummaryReportsProcessListenerAndFreshnessSignals() {
        let summary = StartupFailureDiagnostics.applicationFailureSummary(
            service: "Jira",
            port: 8080,
            httpStatus: "无响应",
            processSummary: "none",
            listenerSummary: "none",
            logPath: "/opt/jira/logs/catalina.out",
            logUpdatedSinceStart: false,
            logExcerpt: "Address already in use"
        )

        XCTAssertTrue(summary.contains("Jira HTTP 无响应"))
        XCTAssertTrue(summary.contains("Java PID: none"))
        XCTAssertTrue(summary.contains("8080 listener PID: none"))
        XCTAssertTrue(summary.contains("Catalina log unchanged"))
        XCTAssertTrue(summary.contains("Address already in use"))
        XCTAssertTrue(summary.contains("/opt/jira/logs/catalina.out"))
    }

    func testFailureSummaryReportsRunningProcessAndListener() {
        let summary = StartupFailureDiagnostics.applicationFailureSummary(
            service: "Jira",
            port: 8080,
            httpStatus: "503",
            processSummary: "142",
            listenerSummary: "142",
            logPath: "/opt/jira/logs/catalina.out",
            logUpdatedSinceStart: true,
            logExcerpt: ""
        )

        XCTAssertTrue(summary.contains("Java PID: 142"))
        XCTAssertTrue(summary.contains("8080 listener PID: 142"))
        XCTAssertTrue(summary.contains("Catalina log updated"))
        XCTAssertTrue(summary.contains("HTTP 503"))
    }

    func testOutputExcerptKeepsRecentTailWhenTruncated() {
        let excerpt = StartupFailureDiagnostics.outputExcerpt(
            "first line\nsecond line\nlast line",
            maxCharacters: 24
        )

        XCTAssertTrue(excerpt.contains("last line"))
        XCTAssertTrue(excerpt.contains("truncated"))
        XCTAssertLessThanOrEqual(excerpt.count, 24)
    }
}
