import AppKit
import Darwin
import Foundation

struct BridgeConnectionDetails: Codable, Sendable {
    let remoteOrigin: String
    let sessionId: String
    let connectorToken: String
    let routes: [String]?

    private static let acceptedRoutes: Set<String> = ["jira", "confluence", "jiraflow", "jira-api", "polarion"]
    private static let relayedRoutes: Set<String> = ["jira", "confluence", "polarion"]

    var enabledRoutes: [String] {
        let requested = routes ?? ["jira", "confluence"]
        return requested.filter { Self.relayedRoutes.contains($0) }
    }

    static func parse(_ text: String) throws -> BridgeConnectionDetails {
        guard let data = text.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8) else {
            throw RemoteBridgeError.message("连接信息不是有效的 UTF-8 文本。")
        }
        let details: BridgeConnectionDetails
        do {
            details = try JSONDecoder().decode(BridgeConnectionDetails.self, from: data)
        } catch {
            throw RemoteBridgeError.message("请粘贴 JEAuditFlow 桥接窗口生成的一次性连接信息 JSON。")
        }
        if let routes = details.routes {
            guard !routes.isEmpty,
                  routes.count <= 5,
                  Set(routes).count == routes.count,
                  routes.allSatisfy(Self.acceptedRoutes.contains),
                  !details.enabledRoutes.isEmpty
            else {
                throw RemoteBridgeError.message("桥接连接信息中的服务路由无效。")
            }
        }
        guard let url = URL(string: details.remoteOrigin),
              let scheme = url.scheme?.lowercased(),
              (scheme == "https" || (scheme == "http" && ["127.0.0.1", "localhost", "::1"].contains(url.host ?? ""))),
              url.user == nil, url.password == nil,
              (url.path.isEmpty || url.path == "/"),
              url.query == nil, url.fragment == nil
        else {
            throw RemoteBridgeError.message("远端 JEAuditFlow 地址必须是 HTTPS 源地址；本机测试可使用回环 HTTP。")
        }
        guard details.sessionId.range(of: "^[A-Za-z0-9_-]{1,96}$", options: .regularExpression) != nil else {
            throw RemoteBridgeError.message("桥接会话编号无效。")
        }
        guard details.connectorToken.range(of: "^[A-Za-z0-9_-]{32,256}$", options: .regularExpression) != nil else {
            throw RemoteBridgeError.message("桥接令牌无效或长度不足。")
        }
        return details
    }

    var jiraURL: String {
        "\(remoteOrigin.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/bridge/sessions/\(sessionId)/jira/secure/Dashboard.jspa"
    }

    func label(for route: String) -> String {
        switch route {
        case "jira": return "Jira"
        case "confluence": return "Confluence"
        case "polarion": return "Polarion"
        default: return "未支持的服务"
        }
    }

    func connectedStatus(lastActivity: String) -> String {
        let routeSummary = enabledRoutes.map { label(for: $0) }.joined(separator: "、")
        return "已授权远端 JEAuditFlow · 路由：\(routeSummary) · \(lastActivity)"
    }
}

struct PolarionTarget: Sendable {
    let baseURL: URL

    static func parse(_ value: String) throws -> PolarionTarget {
        guard var components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host?.lowercased(),
              isTrustedHost(host),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path == "/polarion" || components.path == "/polarion/"
        else {
            throw RemoteBridgeError.message("Polarion 地址必须是可信的私网 HTTP(S) 地址，并以 /polarion/ 为路径。")
        }
        if let port = components.port, !(1...65535).contains(port) {
            throw RemoteBridgeError.message("Polarion 端口无效。")
        }
        components.path = "/polarion/"
        guard let baseURL = components.url else {
            throw RemoteBridgeError.message("Polarion 地址无效。")
        }
        return PolarionTarget(baseURL: baseURL)
    }

    func url(for requestPath: String) throws -> URL {
        guard Self.isSafeRequestPath(requestPath),
              let request = URLComponents(string: "http://bridge.invalid\(requestPath)"),
              request.host == "bridge.invalid",
              request.fragment == nil,
              var target = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        else {
            throw RemoteBridgeError.message("Polarion 桥接请求路径无效。")
        }
        let suffix = request.percentEncodedPath == "/" ? "" : String(request.percentEncodedPath.dropFirst())
        target.percentEncodedPath = target.percentEncodedPath + suffix
        target.percentEncodedQuery = request.percentEncodedQuery
        target.fragment = nil
        guard let url = target.url else {
            throw RemoteBridgeError.message("Polarion 本机请求地址无效。")
        }
        return url
    }

    static func isSafeRequestPath(_ value: String) -> Bool {
        guard value.count <= 8192,
              value.hasPrefix("/"),
              !value.hasPrefix("//"),
              !value.contains("\\"),
              !value.contains("#"),
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let components = URLComponents(string: "http://bridge.invalid\(value)"),
              components.host == "bridge.invalid",
              components.fragment == nil,
              let decodedPath = components.path.removingPercentEncoding
        else {
            return false
        }
        return !decodedPath.contains("\\") &&
            !decodedPath.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
            !decodedPath.split(separator: "/").contains(where: { $0 == "." || $0 == ".." })
    }

    private static func isTrustedHost(_ host: String) -> Bool {
        if host == "localhost" { return true }
        let address = host.hasPrefix("[") && host.hasSuffix("]") ? String(host.dropFirst().dropLast()) : host
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, address, &ipv6) == 1 {
            return withUnsafeBytes(of: ipv6) { bytes in
                bytes.dropLast().allSatisfy({ $0 == 0 }) && bytes.last == 1 ||
                    bytes[0] & 0xfe == 0xfc || bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80
            }
        }
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, address, &ipv4) == 1 else { return false }
        let octets = address.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        return octets[0] == 127 || octets[0] == 10 ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 172 && (16...31).contains(octets[1]))
    }
}

enum PolarionTargetConfiguration {
    static func resolve(environmentValue: String?, savedValue: String?, projectRoot: URL?,
                        readText: (URL) -> String? = readConfigurationText) -> PolarionTarget? {
        for value in [environmentValue, savedValue].compactMap({ $0 }) {
            if let target = try? PolarionTarget.parse(value) { return target }
        }
        guard let projectRoot,
              let version = readText(projectRoot.appendingPathComponent("local-deploy/runtime/current-version"))?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil
        else { return nil }
        let minorVersion = version.split(separator: ".").prefix(2).joined(separator: ".")
        for relativePath in ["local-deploy/config/\(version).local.env",
                             "local-deploy/config/\(minorVersion).local.env",
                             "local-deploy/runtime/env/\(version).env"] {
            guard let contents = readText(projectRoot.appendingPathComponent(relativePath)) else { continue }
            for line in contents.split(whereSeparator: \.isNewline) {
                let prefix = "JEAUDITFLOW_POLARION_URL="
                let text = line.trimmingCharacters(in: .whitespaces)
                guard text.hasPrefix(prefix) else { continue }
                var value = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
                if value.count >= 2, let first = value.first,
                   (first == "\"" || first == "'"), value.last == first {
                    value = String(value.dropFirst().dropLast())
                }
                if let target = try? PolarionTarget.parse(value) { return target }
            }
        }
        return nil
    }

    private static func readConfigurationText(_ url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: 262_145), data.count <= 262_144 else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

enum BridgeRouteURL {
    static func make(route: String, path: String, polarionTarget: PolarionTarget?) throws -> URL {
        guard PolarionTarget.isSafeRequestPath(path) else {
            throw RemoteBridgeError.message("桥接请求路径无效。")
        }
        switch route {
        case "jira":
            guard let url = URL(string: "http://127.0.0.1:8080\(path)") else {
                throw RemoteBridgeError.message("本机 Jira 请求地址无效。")
            }
            return url
        case "confluence":
            guard let url = URL(string: "http://127.0.0.1:8090\(path)") else {
                throw RemoteBridgeError.message("本机 Confluence 请求地址无效。")
            }
            return url
        case "polarion":
            guard let polarionTarget else {
                throw RemoteBridgeError.message("尚未配置本机 Polarion 地址。")
            }
            return try polarionTarget.url(for: path)
        default:
            throw RemoteBridgeError.message("桥接会话未授权此服务路由。")
        }
    }
}

private enum BridgeHeaderValue: Codable, Sendable {
    case string(String)
    case array([String])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let values = try? container.decode([String].self) {
            self = .array(values)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .array(let values):
            try container.encode(values)
        }
    }
}

private struct BridgeRequest: Codable, Sendable {
    let id: String
    let route: String
    let path: String
    let method: String
    let headers: [String: String]
    let body: String?
}

private struct BridgePollResponse: Codable, Sendable {
    let requests: [BridgeRequest]
}

private struct BridgePollRequest: Encodable, Sendable {
    let waitMs: Int
}

private struct BridgeRelayResponse: Codable, Sendable {
    let status: Int
    let headers: [String: BridgeHeaderValue]
    let body: String
}

private struct BridgeResultRequest: Encodable, Sendable {
    let requestId: String
    let response: BridgeRelayResponse
}

private struct EmptyBridgeRequest: Encodable, Sendable {}

enum RemoteBridgeError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

final class BridgeRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class RemoteBridgeConnector {
    private var worker: Task<Void, Never>?
    private let relaySession = URLSession(configuration: .ephemeral, delegate: BridgeRedirectPolicy(), delegateQueue: nil)

    func start(_ details: BridgeConnectionDetails, polarionTarget: PolarionTarget?, status: @escaping (String) -> Void) {
        stop()
        worker = Task { [weak self] in
            await self?.run(details, polarionTarget: polarionTarget, status: status)
        }
    }

    func stop() {
        worker?.cancel()
        worker = nil
    }

    private func run(_ details: BridgeConnectionDetails, polarionTarget: PolarionTarget?, status: @escaping (String) -> Void) async {
        status("正在连接远端 JEAuditFlow…")
        var failures = 0
        var lastActivity = "尚未收到服务请求"
        while !Task.isCancelled {
            do {
                _ = try await post(path: "heartbeat", body: EmptyBridgeRequest(), details: details)
                failures = 0
                status(details.connectedStatus(lastActivity: lastActivity))
                let poll = try await post(path: "poll", body: BridgePollRequest(waitMs: 15_000), details: details, timeout: 45)
                let payload = try JSONDecoder().decode(BridgePollResponse.self, from: poll)
                for request in payload.requests.prefix(8) {
                    try Task.checkCancellation()
                    let label = details.label(for: request.route)
                    status("正在转发 \(label) 请求…")
                    let response: BridgeRelayResponse
                    if !details.enabledRoutes.contains(request.route) {
                        response = BridgeRelayResponse(
                            status: 403,
                            headers: ["content-type": .string("text/plain; charset=utf-8")],
                            body: Data("桥接会话未授权此服务路由，请新建包含该服务的访问会话。".utf8).base64EncodedString()
                        )
                        lastActivity = "\(label) 路由未授权"
                    } else {
                        do {
                            response = try await relay(request, polarionTarget: polarionTarget, publicOrigin: details.remoteOrigin)
                            lastActivity = "\(label) 响应 HTTP \(response.status)"
                        } catch {
                            let errorMessage = request.route == "polarion"
                                ? "本机 Polarion 服务连接失败，请检查启动器地址和 VM 服务状态。"
                                : "本机 \(label) 服务连接失败，请确认服务已启动。"
                            response = BridgeRelayResponse(
                                status: 502,
                                headers: ["content-type": .string("text/plain; charset=utf-8")],
                                body: Data(errorMessage.utf8).base64EncodedString()
                            )
                            lastActivity = "\(label) 本机连接失败"
                        }
                    }
                    _ = try await post(path: "result", body: BridgeResultRequest(requestId: request.id, response: response), details: details)
                    status(details.connectedStatus(lastActivity: lastActivity))
                }
            } catch is CancellationError {
                break
            } catch {
                failures += 1
                status("远端桥接重试中：\(error.localizedDescription)")
                let delay = UInt64(min(10, max(1, failures))) * 1_000_000_000
                try? await Task.sleep(nanoseconds: delay)
            }
        }
        status("远端桥接已停止")
    }

    private func post<Body: Encodable>(path: String, body: Body, details: BridgeConnectionDetails, timeout: TimeInterval = 25) async throws -> Data {
        let origin = details.remoteOrigin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(origin)/api/bridge/sessions/\(details.sessionId)/connector/\(path)") else {
            throw RemoteBridgeError.message("远端桥接地址无效。")
        }
        let json = try JSONEncoder().encode(body)
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(details.connectorToken, forHTTPHeaderField: "x-auditflow-bridge-token")
        request.httpBody = json
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw RemoteBridgeError.message("远端桥接服务返回 HTTP \(code)。")
        }
        return data
    }

    private func relay(_ request: BridgeRequest, polarionTarget: PolarionTarget?, publicOrigin: String) async throws -> BridgeRelayResponse {
        let url = try BridgeRouteURL.make(route: request.route, path: request.path, polarionTarget: polarionTarget)
        var outbound = URLRequest(url: url, timeoutInterval: 25)
        outbound.httpMethod = request.method
        outbound.httpShouldHandleCookies = false
        for (name, value) in request.headers where !["host", "origin", "referer", "forwarded"].contains(name.lowercased()) && !name.lowercased().hasPrefix("x-forwarded-") {
            outbound.setValue(value, forHTTPHeaderField: name)
        }
        if let publicURL = URL(string: publicOrigin), let host = publicURL.host {
            let authority = host + (publicURL.port.map { ":\($0)" } ?? "")
            outbound.setValue(authority, forHTTPHeaderField: "Host")
            if !["GET", "HEAD", "OPTIONS"].contains(request.method.uppercased()) {
                outbound.setValue(publicOrigin, forHTTPHeaderField: "Origin")
            }
            outbound.setValue(publicOrigin + request.path, forHTTPHeaderField: "Referer")
        }
        // URLSession transparently decodes compressed responses. Keep the
        // bridge payload plain so the public relay does not forward a stale
        // Content-Encoding header alongside already-decoded bytes.
        outbound.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let body = request.body, let data = Data(base64Encoded: body) {
            outbound.httpBody = data
        }
        let (data, response) = try await relaySession.data(for: outbound)
        guard let http = response as? HTTPURLResponse else {
            throw RemoteBridgeError.message("本机服务没有返回 HTTP 响应。")
        }
        var headers: [String: BridgeHeaderValue] = [:]
        for (key, value) in http.allHeaderFields {
            let name = String(describing: key).lowercased()
            if ["content-encoding", "content-length", "transfer-encoding"].contains(name) {
                continue
            }
            if let values = value as? [String] {
                headers[name] = .array(values)
            } else {
                headers[name] = .string(String(describing: value))
            }
        }
        return BridgeRelayResponse(status: http.statusCode, headers: headers, body: data.base64EncodedString())
    }
}

@main
struct AtlassianServiceLauncherMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var databaseStatus = NSTextField(labelWithString: "检查中…")
    private var jiraStatus = NSTextField(labelWithString: "检查中…")
    private var confluenceStatus = NSTextField(labelWithString: "检查中…")
    private var messageLabel = NSTextField(wrappingLabelWithString: "")
    private let spinner = NSProgressIndicator()
    private var startButton: NSButton!
    private var statusItem: NSStatusItem?
    private var statusMenuItems: [NSMenuItem] = []
    private var statusTimer: Timer?
    private var isStarting = false
    private var isCheckingStatus = false
    private var appLogo: NSImage?
    private var currentStatus = ServiceStatus(
        database: "检查中…",
        jira: "检查中…",
        confluence: "检查中…"
    )
    private let remoteBridgeConnector = RemoteBridgeConnector()
    private var remoteBridgeStatus = NSTextField(labelWithString: "未授权远端 JEAuditFlow")
    private weak var remoteBridgeInput: NSTextView?
    private var polarionURLField: NSTextField!
    private let polarionURLPreferenceKey = "PolarionBaseURL"

    func applicationDidFinishLaunching(_ notification: Notification) {
        appLogo = Bundle.main.url(forResource: "AtlassianLogo", withExtension: "jpg")
            .flatMap(NSImage.init(contentsOf:))
        NSApp.applicationIconImage = Bundle.main.url(forResource: "AtlassianServiceLauncher", withExtension: "icns")
            .flatMap(NSImage.init(contentsOf:))
        buildStatusItem()
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.refreshStatus(silently: true)
            }
        }

        if ProcessInfo.processInfo.arguments.contains("--start-services") {
            startAllServices()
        } else {
            refreshStatus()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { showMainWindow() }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusTimer?.invalidate()
        remoteBridgeConnector.stop()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 470),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Atlassian 本机服务启动器"
        window.center()
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 540, height: 440)

        let title = NSTextField(labelWithString: "Jira + Confluence")
        title.font = .systemFont(ofSize: 24, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "启动本机 PostgreSQL、Jira 和 Confluence，并在浏览器中检查服务是否可访问。")
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor
        let heading = NSStackView()
        heading.orientation = .horizontal
        heading.alignment = .centerY
        heading.spacing = 16
        if let appLogo {
            let logoView = NSImageView(image: appLogo)
            logoView.imageScaling = .scaleProportionallyUpOrDown
            logoView.setContentHuggingPriority(.required, for: .horizontal)
            logoView.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                logoView.widthAnchor.constraint(equalToConstant: 68),
                logoView.heightAnchor.constraint(equalToConstant: 64)
            ])
            heading.addArrangedSubview(logoView)
        }
        let headingText = NSStackView(views: [title, subtitle])
        headingText.orientation = .vertical
        headingText.alignment = .leading
        headingText.spacing = 5
        heading.addArrangedSubview(headingText)

        databaseStatus = statusLabel()
        jiraStatus = statusLabel()
        confluenceStatus = statusLabel()

        let rows = NSStackView(views: [
            statusRow(name: "PostgreSQL", label: databaseStatus),
            statusRow(name: "Jira", label: jiraStatus),
            statusRow(name: "Confluence", label: confluenceStatus)
        ])
        rows.orientation = .vertical
        rows.alignment = .leading
        rows.spacing = 10

        startButton = NSButton(title: "一键启动全部服务", target: self, action: #selector(startAllServices))
        startButton.bezelStyle = .rounded
        startButton.keyEquivalent = "\r"
        startButton.controlSize = .large

        let jiraButton = NSButton(title: "打开 Jira", target: self, action: #selector(openJira))
        jiraButton.bezelStyle = .rounded
        let confluenceButton = NSButton(title: "打开 Confluence", target: self, action: #selector(openConfluence))
        confluenceButton.bezelStyle = .rounded
        let polarionButton = NSButton(title: "打开 Polarion", target: self, action: #selector(openPolarion))
        polarionButton.bezelStyle = .rounded
        let refreshButton = NSButton(title: "刷新状态", target: self, action: #selector(refreshStatusFromWindow))
        refreshButton.bezelStyle = .rounded

        let linkButtons = NSStackView(views: [jiraButton, confluenceButton, polarionButton, refreshButton])
        linkButtons.orientation = .horizontal
        linkButtons.alignment = .centerY
        linkButtons.distribution = .fillProportionally
        linkButtons.spacing = 10

        let projectRoot = UserDefaults(suiteName: "local.maplemock.jeauditflowlauncher")?.string(forKey: "projectRoot")
        let configuredPolarionURL = PolarionTargetConfiguration.resolve(
            environmentValue: ProcessInfo.processInfo.environment["JEAUDITFLOW_POLARION_URL"],
            savedValue: UserDefaults.standard.string(forKey: polarionURLPreferenceKey),
            projectRoot: projectRoot.flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil }
        )?.baseURL.absoluteString ?? ""
        polarionURLField = NSTextField(string: configuredPolarionURL)
        if !configuredPolarionURL.isEmpty {
            UserDefaults.standard.set(configuredPolarionURL, forKey: polarionURLPreferenceKey)
        }
        polarionURLField.placeholderString = "http://192.168.x.x/polarion/"
        polarionURLField.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let polarionURLLabel = NSTextField(labelWithString: "Polarion 地址")
        polarionURLLabel.font = .systemFont(ofSize: 12, weight: .medium)
        polarionURLLabel.widthAnchor.constraint(equalToConstant: 105).isActive = true
        let polarionURLRow = NSStackView(views: [polarionURLLabel, polarionURLField])
        polarionURLRow.orientation = .horizontal
        polarionURLRow.alignment = .centerY
        polarionURLRow.spacing = 12
        polarionURLField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let remoteBridgeButton = NSButton(
            title: "授权远端 JEAuditFlow…",
            target: self,
            action: #selector(authorizeRemoteBridge)
        )
        remoteBridgeButton.bezelStyle = .rounded
        remoteBridgeStatus = NSTextField(wrappingLabelWithString: "未授权远端 JEAuditFlow；远端需先生成一次性桥接连接信息。")
        remoteBridgeStatus.font = .systemFont(ofSize: 11)
        remoteBridgeStatus.textColor = .secondaryLabelColor
        remoteBridgeStatus.maximumNumberOfLines = 3
        let remoteBridgeRow = NSStackView(views: [remoteBridgeButton, remoteBridgeStatus])
        remoteBridgeRow.orientation = .horizontal
        remoteBridgeRow.alignment = .centerY
        remoteBridgeRow.spacing = 10
        remoteBridgeButton.setContentHuggingPriority(.required, for: .horizontal)
        remoteBridgeStatus.setContentHuggingPriority(.defaultLow, for: .horizontal)

        spinner.style = .spinning
        spinner.isDisplayedWhenStopped = false
        spinner.controlSize = .small
        let progressRow = NSStackView(views: [spinner, messageLabel])
        progressRow.orientation = .horizontal
        progressRow.alignment = .centerY
        progressRow.spacing = 8
        messageLabel.font = .systemFont(ofSize: 12)
        messageLabel.textColor = .secondaryLabelColor

        let footer = NSTextField(wrappingLabelWithString: "关闭此窗口不会停止 Jira、Confluence 或数据库。Polarion 地址保存在本机。")
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = .tertiaryLabelColor

        let stack = NSStackView(views: [heading, rows, startButton, polarionURLRow, linkButtons, remoteBridgeRow, progressRow, footer])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 26),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -20),
            startButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            polarionURLRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            linkButtons.widthAnchor.constraint(equalTo: stack.widthAnchor),
            progressRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            footer.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        window.contentView = content
    }

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        if let button = item.button {
            button.image = appLogo
            button.image?.size = NSSize(width: 18, height: 18)
            button.image?.isTemplate = false
            button.title = "  检查中"
            // Keep the status item passive. A multi-line tooltip can become a
            // floating help bubble that follows the pointer and obscures other
            // applications. The menu itself is the deliberate status surface.
            button.toolTip = nil
        }

        let menu = NSMenu()
        let heading = NSMenuItem(title: "本机服务状态", action: nil, keyEquivalent: "")
        heading.isEnabled = false
        menu.addItem(heading)
        for title in ["PostgreSQL：检查中…", "Jira：检查中…", "Confluence：检查中…"] {
            let status = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            status.isEnabled = false
            menu.addItem(status)
            statusMenuItems.append(status)
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "一键启动全部服务", action: #selector(startAllServices), keyEquivalent: "s"))
        menu.addItem(NSMenuItem(title: "刷新状态", action: #selector(refreshStatusFromMenu), keyEquivalent: "r"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "打开 Jira", action: #selector(openJira), keyEquivalent: "j"))
        menu.addItem(NSMenuItem(title: "打开 Confluence", action: #selector(openConfluence), keyEquivalent: "c"))
        menu.addItem(NSMenuItem(title: "打开 Polarion", action: #selector(openPolarion), keyEquivalent: "p"))
        menu.addItem(NSMenuItem(title: "授权远端 JEAuditFlow…", action: #selector(authorizeRemoteBridge), keyEquivalent: "a"))
        menu.addItem(NSMenuItem(title: "显示启动器窗口", action: #selector(showMainWindow), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出启动器（服务继续运行）", action: #selector(terminateLauncher), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        item.menu = menu
    }

    private func statusLabel() -> NSTextField {
        let label = NSTextField(labelWithString: "检查中…")
        label.font = .systemFont(ofSize: 13)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func statusRow(name: String, label: NSTextField) -> NSStackView {
        let nameLabel = NSTextField(labelWithString: name)
        nameLabel.font = .systemFont(ofSize: 13, weight: .medium)
        nameLabel.widthAnchor.constraint(equalToConstant: 105).isActive = true
        let row = NSStackView(views: [nameLabel, label])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        return row
    }

    @objc private func startAllServices() {
        guard !isStarting else { return }
        isStarting = true
        startButton.isEnabled = false
        spinner.startAnimation(nil)
        messageLabel.stringValue = "正在启动…"
        databaseStatus.stringValue = "等待数据库…"
        jiraStatus.stringValue = "等待启动…"
        confluenceStatus.stringValue = "等待启动…"
        setStatusColor(databaseStatus, color: .secondaryLabelColor)
        setStatusColor(jiraStatus, color: .secondaryLabelColor)
        setStatusColor(confluenceStatus, color: .secondaryLabelColor)
        currentStatus = ServiceStatus(database: "等待数据库…", jira: "等待启动…", confluence: "等待启动…")
        updateStatusItem()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let summary = try ServiceController.startAll { stage in
                    DispatchQueue.main.async { [weak self] in
                        self?.messageLabel.stringValue = stage
                        if stage.localizedCaseInsensitiveContains("PostgreSQL") {
                            self?.databaseStatus.stringValue = stage
                            self?.currentStatus.database = stage
                        } else if stage.localizedCaseInsensitiveContains("Jira") {
                            self?.jiraStatus.stringValue = stage
                            self?.currentStatus.jira = stage
                        } else if stage.localizedCaseInsensitiveContains("Confluence") {
                            self?.confluenceStatus.stringValue = stage
                            self?.currentStatus.confluence = stage
                        }
                        self?.updateStatusItem()
                    }
                }
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.isStarting = false
                    self.databaseStatus.stringValue = "运行中 · PostgreSQL 已就绪"
                    self.jiraStatus.stringValue = "可访问 · \(ServiceController.displayURL(port: 8080))"
                    self.confluenceStatus.stringValue = "可访问 · \(ServiceController.displayURL(port: 8090))"
                    self.currentStatus = ServiceStatus(
                        database: self.databaseStatus.stringValue,
                        jira: self.jiraStatus.stringValue,
                        confluence: self.confluenceStatus.stringValue
                    )
                    self.setStatusColor(self.databaseStatus, color: .systemGreen)
                    self.setStatusColor(self.jiraStatus, color: .systemGreen)
                    self.setStatusColor(self.confluenceStatus, color: .systemGreen)
                    self.messageLabel.stringValue = summary
                    self.spinner.stopAnimation(nil)
                    self.startButton.isEnabled = true
                    self.updateStatusItem()
                    LauncherLog.write("启动完成：" + summary)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.isStarting = false
                    self.messageLabel.stringValue = error.localizedDescription
                    self.spinner.stopAnimation(nil)
                    self.startButton.isEnabled = true
                    self.updateStatusItem()
                    LauncherLog.write("启动失败：" + error.localizedDescription)
                    self.showMainWindow()
                    let alert = NSAlert()
                    alert.alertStyle = .warning
                    alert.messageText = "服务启动未完成"
                    alert.informativeText = error.localizedDescription
                    alert.addButton(withTitle: "知道了")
                    alert.beginSheetModal(for: self.window)
                }
            }
        }
    }

    @objc private func refreshStatus() {
        refreshStatus(silently: false)
    }

    @objc private func refreshStatusFromWindow() {
        refreshStatus(silently: false)
    }

    @objc private func refreshStatusFromMenu() {
        refreshStatus(silently: false)
    }

    private func refreshStatus(silently: Bool) {
        guard !isStarting, !isCheckingStatus else { return }
        isCheckingStatus = true
        if !silently { messageLabel.stringValue = "正在检查本机服务…" }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let status = ServiceController.status()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.isCheckingStatus = false
                self.currentStatus = status
                self.databaseStatus.stringValue = status.database
                self.jiraStatus.stringValue = status.jira
                self.confluenceStatus.stringValue = status.confluence
                self.setStatusColor(self.databaseStatus, color: status.database.contains("已就绪") ? .systemGreen : .secondaryLabelColor)
                self.setStatusColor(self.jiraStatus, color: status.jira.contains("可访问") ? .systemGreen : .systemOrange)
                self.setStatusColor(self.confluenceStatus, color: status.confluence.contains("可访问") ? .systemGreen : .systemOrange)
                if !silently { self.messageLabel.stringValue = "状态已刷新" }
                self.updateStatusItem()
            }
        }
    }

    @objc private func openJira() {
        NSWorkspace.shared.open(URL(string: ServiceController.displayURL(port: 8080) + "/secure/MyJiraHome.jspa")!)
    }

    @objc private func openConfluence() {
        NSWorkspace.shared.open(URL(string: ServiceController.displayURL(port: 8090) + "/")!)
    }

    @objc private func openPolarion() {
        do {
            let target = try PolarionTarget.parse(polarionURLField.stringValue)
            UserDefaults.standard.set(target.baseURL.absoluteString, forKey: polarionURLPreferenceKey)
            NSWorkspace.shared.open(target.baseURL)
            messageLabel.stringValue = "已打开 Polarion：\(target.baseURL.absoluteString)"
        } catch {
            messageLabel.stringValue = error.localizedDescription
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Polarion 地址无效"
            alert.informativeText = error.localizedDescription
            alert.addButton(withTitle: "知道了")
            alert.beginSheetModal(for: window)
        }
    }

    @objc private func authorizeRemoteBridge() {
        let alert = NSAlert()
        alert.messageText = "授权远端 JEAuditFlow 使用本机服务"
        alert.informativeText = "在远端 JEAuditFlow 的“本机服务桥接”中创建会话，复制一次性连接信息 JSON，粘贴到下面后批准。Polarion 路由使用上方配置的本机地址。令牌只保留在本启动器内存中，停止启动器或撤销会话后失效。"
        let input = NSTextView(frame: NSRect(x: 0, y: 0, width: 520, height: 110))
        input.isRichText = false
        input.isEditable = true
        input.isSelectable = true
        input.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        input.drawsBackground = true
        input.backgroundColor = .textBackgroundColor
        input.textContainerInset = NSSize(width: 8, height: 8)
        input.string = ""
        remoteBridgeInput = input
        let pasteButton = NSButton(title: "从剪贴板粘贴 JSON", target: self, action: #selector(pasteRemoteBridgeJSON))
        pasteButton.bezelStyle = .rounded
        pasteButton.setContentHuggingPriority(.required, for: .horizontal)
        let accessory = NSStackView(views: [input, pasteButton])
        accessory.orientation = .vertical
        accessory.alignment = .leading
        accessory.spacing = 8
        accessory.setFrameSize(NSSize(width: 520, height: 145))
        alert.accessoryView = accessory
        alert.addButton(withTitle: "批准并连接")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = input
        guard alert.runModal() == .alertFirstButtonReturn else {
            remoteBridgeInput = nil
            return
        }

        do {
            let connection = try BridgeConnectionDetails.parse(input.string)
            let polarionTarget: PolarionTarget?
            if connection.enabledRoutes.contains("polarion") {
                polarionTarget = try PolarionTarget.parse(polarionURLField.stringValue)
                UserDefaults.standard.set(polarionTarget?.baseURL.absoluteString, forKey: polarionURLPreferenceKey)
            } else {
                polarionTarget = nil
            }
            remoteBridgeStatus.stringValue = "正在连接远端 JEAuditFlow…"
            remoteBridgeStatus.textColor = .systemOrange
            remoteBridgeConnector.start(connection, polarionTarget: polarionTarget) { [weak self] status in
                guard let self else { return }
                self.remoteBridgeStatus.stringValue = status
                self.remoteBridgeStatus.textColor = status.contains("已授权") ? .systemGreen : .systemOrange
                self.messageLabel.stringValue = status
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(connection.jiraURL, forType: .string)
            messageLabel.stringValue = "已启动远端连接器；远端 Jira 地址已复制到剪贴板。"
            LauncherLog.write("已授权远端桥接：\(connection.remoteOrigin)，会话 \(connection.sessionId)")
        } catch {
            let message = error.localizedDescription
            remoteBridgeStatus.stringValue = message
            remoteBridgeStatus.textColor = .systemRed
            messageLabel.stringValue = message
            let failure = NSAlert()
            failure.alertStyle = .warning
            failure.messageText = "远端桥接未启动"
            failure.informativeText = message
            failure.addButton(withTitle: "知道了")
            failure.beginSheetModal(for: window)
        }
        remoteBridgeInput = nil
    }

    @objc private func pasteRemoteBridgeJSON() {
        guard let input = remoteBridgeInput else { return }
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else {
            NSSound.beep()
            return
        }
        input.string = text
        input.window?.makeFirstResponder(input)
    }

    @objc private func showMainWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func terminateLauncher() {
        NSApp.terminate(nil)
    }

    private func updateStatusItem() {
        let databaseReady = currentStatus.database.contains("已就绪")
        let jiraReady = currentStatus.jira.contains("可访问")
        let confluenceReady = currentStatus.confluence.contains("可访问")
        if let button = statusItem?.button {
            let allReady = databaseReady && jiraReady && confluenceReady
            button.title = allReady ? " ✓" : " !"
            button.toolTip = nil
        }
        let titles = [
            "PostgreSQL：\(currentStatus.database)",
            "Jira：\(currentStatus.jira)",
            "Confluence：\(currentStatus.confluence)"
        ]
        for (item, title) in zip(statusMenuItems, titles) { item.title = title }
    }

    private func setStatusColor(_ label: NSTextField, color: NSColor) {
        label.textColor = color
    }
}

private struct ServiceStatus {
    var database: String
    var jira: String
    var confluence: String
}

private enum ServiceController {
    static let loopbackJiraURL = "http://127.0.0.1:8080/secure/MyJiraHome.jspa"
    static let loopbackConfluenceURL = "http://127.0.0.1:8090/"
    private static var jiraHome: String {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Atlassian/atlassian-jira-software-11.3.12-standalone").path
    }
    private static var confluenceHome: String {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Atlassian/atlassian-confluence-10.2.19").path
    }
    private static var confluenceJavaHome: String {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Java/JavaVirtualMachines/jdk-21.0.13+9/Contents/Home").path
    }
    private static let postgresContainer = "postgres"

    static func displayURL(port: Int) -> String {
        "http://\(preferredLANAddress() ?? "127.0.0.1"):\(port)"
    }

    private static func preferredLANAddress() -> String? {
        let result = try? run("/sbin/ifconfig", [], timeout: 5)
        let addresses = result?.output
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let parts = line.split(whereSeparator: \.isWhitespace)
                guard parts.count >= 2, parts[0] == "inet" else { return nil }
                let address = String(parts[1])
                guard address != "127.0.0.1",
                      address.hasPrefix("192.168."),
                      !address.hasPrefix("192.168.64.") else { return nil }
                return address
            } ?? []
        return addresses.first
    }

    private static var jiraURL: String { loopbackJiraURL }
    private static var confluenceURL: String { loopbackConfluenceURL }

    static func startAll(progress: (String) -> Void) throws -> String {
        progress("启动或检查 Docker Desktop…")
        let docker = try resolveDocker()
        if !commandSucceeded(docker, ["info"], timeout: 8) {
            _ = try run("/usr/bin/open", ["-a", "Docker"], timeout: 15)
        }
        try waitForDocker(docker, timeout: 180, progress: progress)

        progress("检查现有 PostgreSQL 容器…")
        let containerState = try run(docker, ["inspect", "--format={{.State.Running}}", postgresContainer], timeout: 15)
        guard containerState.exitCode == 0 else {
            throw LauncherError.message("Docker 中没有名为 postgres 的现有容器。为保护原数据库，本启动器不会新建容器或初始化数据。")
        }
        if containerState.output.trimmingCharacters(in: .whitespacesAndNewlines) != "true" {
            progress("启动现有 PostgreSQL 容器…")
            let start = try run(docker, ["start", postgresContainer], timeout: 60)
            guard start.exitCode == 0 else {
                throw LauncherError.message("无法启动现有 postgres 容器：\(start.output.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }
        try waitForPostgres(docker, timeout: 120, progress: progress)

        let jiraLogPath = "\(jiraHome)/logs/catalina.out"
        let jiraLogBaseline = fileModificationDate(jiraLogPath)
        progress("启动 Jira…")
        if !isHealthy(jiraURL) {
            let script = "\(jiraHome)/bin/start-jira.sh"
            guard FileManager.default.isExecutableFile(atPath: script) else {
                throw LauncherError.message("找不到 Jira 启动脚本：\(script)")
            }
            let result = try run(script, [], timeout: 60, workingDirectory: jiraHome,
                                 environment: ["JAVA_HOME": confluenceJavaHome, "JRE_HOME": confluenceJavaHome])
            LauncherLog.writeCommandOutput("Jira 启动脚本", result)
            if result.exitCode != 0 {
                progress("Jira 启动脚本返回 \(result.exitCode)，继续等待实际 HTTP 服务…")
            }
        }

        let confluenceLogPath = "\(confluenceHome)/logs/catalina.out"
        let confluenceLogBaseline = fileModificationDate(confluenceLogPath)
        progress("启动 Confluence…")
        if !isHealthy(confluenceURL) {
            let script = "\(confluenceHome)/bin/start-confluence.sh"
            guard FileManager.default.isExecutableFile(atPath: script) else {
                throw LauncherError.message("找不到 Confluence 启动脚本：\(script)")
            }
            let result = try run(script, [], timeout: 60, workingDirectory: confluenceHome,
                                 environment: ["JAVA_HOME": confluenceJavaHome, "JRE_HOME": confluenceJavaHome])
            LauncherLog.writeCommandOutput("Confluence 启动脚本", result)
            if result.exitCode != 0 {
                progress("Confluence 启动脚本返回 \(result.exitCode)，继续等待实际 HTTP 服务…")
            }
        }

        try waitForApplications(
            timeout: 600,
            progress: progress,
            jiraLogPath: jiraLogPath,
            jiraLogBaseline: jiraLogBaseline,
            confluenceLogPath: confluenceLogPath,
            confluenceLogBaseline: confluenceLogBaseline
        )
        return "Jira 与 Confluence 均已通过本机 HTTP 检查。"
    }

    static func status() -> ServiceStatus {
        let docker = (try? resolveDocker()) ?? "/usr/local/bin/docker"
        let engineReady = commandSucceeded(docker, ["info"], timeout: 8)
        var database = engineReady ? "Docker 正在运行" : "Docker Desktop 未就绪"
        if engineReady {
            let state = try? run(docker, ["inspect", "--format={{.State.Running}}", postgresContainer], timeout: 8)
            if state?.output.trimmingCharacters(in: .whitespacesAndNewlines) == "true",
               commandSucceeded(docker, ["exec", postgresContainer, "pg_isready", "-h", "127.0.0.1", "-p", "5432"], timeout: 8) {
                database = "运行中 · PostgreSQL 已就绪"
            } else if state?.output.trimmingCharacters(in: .whitespacesAndNewlines) == "true" {
                database = "运行中 · PostgreSQL 启动中"
            } else if state != nil {
                database = "Docker 中 postgres 未运行"
            } else {
                database = "Docker 中找不到 postgres"
            }
        }
        return ServiceStatus(
            database: database,
            jira: isHealthy(jiraURL) ? "可访问 · \(displayURL(port: 8080))" : "未就绪 · 8080",
            confluence: isHealthy(confluenceURL) ? "可访问 · \(displayURL(port: 8090))" : "未就绪 · 8090"
        )
    }

    private static func resolveDocker() throws -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "\(home)/.docker/bin/docker",
            "/Applications/Docker.app/Contents/Resources/bin/docker"
        ]
        if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return path
        }
        throw LauncherError.message("找不到 Docker 命令。请先安装 Docker Desktop。")
    }

    private static func waitForDocker(_ docker: String, timeout: TimeInterval, progress: (String) -> Void) throws {
        let deadline = Date().addingTimeInterval(timeout)
        var lastUpdate = Date.distantPast
        while Date() < deadline {
            if commandSucceeded(docker, ["info"], timeout: 8) { return }
            if Date().timeIntervalSince(lastUpdate) > 10 {
                progress("等待 Docker Desktop 引擎就绪…")
                lastUpdate = Date()
            }
            Thread.sleep(forTimeInterval: 2)
        }
        throw LauncherError.message("Docker Desktop 尚未就绪。请确认 Docker Desktop 已启动后重试。")
    }

    private static func waitForPostgres(_ docker: String, timeout: TimeInterval, progress: (String) -> Void) throws {
        let deadline = Date().addingTimeInterval(timeout)
        var lastUpdate = Date.distantPast
        while Date() < deadline {
            if commandSucceeded(docker, ["exec", postgresContainer, "pg_isready", "-h", "127.0.0.1", "-p", "5432"], timeout: 8) {
                return
            }
            if Date().timeIntervalSince(lastUpdate) > 10 {
                progress("等待 PostgreSQL 接受连接…")
                lastUpdate = Date()
            }
            Thread.sleep(forTimeInterval: 2)
        }
        throw LauncherError.message("PostgreSQL 在 120 秒内没有通过就绪检查。请查看 Docker 中 postgres 容器的日志。")
    }

    private static func waitForApplications(
        timeout: TimeInterval,
        progress: (String) -> Void,
        jiraLogPath: String,
        jiraLogBaseline: Date?,
        confluenceLogPath: String,
        confluenceLogBaseline: Date?
    ) throws {
        let deadline = Date().addingTimeInterval(timeout)
        var jiraReady = isHealthy(jiraURL)
        var confluenceReady = isHealthy(confluenceURL)
        var lastUpdate = Date.distantPast
        while Date() < deadline {
            if !jiraReady { jiraReady = isHealthy(jiraURL) }
            if !confluenceReady { confluenceReady = isHealthy(confluenceURL) }
            if jiraReady && confluenceReady { return }
            if Date().timeIntervalSince(lastUpdate) > 10 {
                let current = "等待服务响应… Jira \(jiraReady ? "已就绪" : "启动中")，Confluence \(confluenceReady ? "已就绪" : "启动中")"
                progress(current)
                lastUpdate = Date()
            }
            Thread.sleep(forTimeInterval: 3)
        }
        let jiraCode = httpStatus(jiraURL) ?? "无响应"
        let confluenceCode = httpStatus(confluenceURL) ?? "无响应"
        var details: [String] = []
        if !jiraReady {
            details.append(applicationFailureDetails(
                service: "Jira",
                port: 8080,
                httpStatus: jiraCode,
                home: jiraHome,
                logPath: jiraLogPath,
                logBaseline: jiraLogBaseline
            ))
        }
        if !confluenceReady {
            details.append(applicationFailureDetails(
                service: "Confluence",
                port: 8090,
                httpStatus: confluenceCode,
                home: confluenceHome,
                logPath: confluenceLogPath,
                logBaseline: confluenceLogBaseline
            ))
        }
        let logPath = LauncherLog.fileURL.path
        throw LauncherError.message(
            "服务未全部就绪（Jira HTTP \(jiraCode)，Confluence HTTP \(confluenceCode)）。\n\n" +
            details.joined(separator: "\n\n") +
            "\n\n启动脚本输出已记录到：\(logPath)"
        )
    }

    private static func applicationFailureDetails(
        service: String,
        port: Int,
        httpStatus: String,
        home: String,
        logPath: String,
        logBaseline: Date?
    ) -> String {
        let processSummary = javaProcessSummary(home: home)
        let listenerSummary = listenerSummary(port: port)
        let currentLogDate = fileModificationDate(logPath)
        let logUpdated: Bool
        if let currentLogDate {
            logUpdated = logBaseline.map { currentLogDate.timeIntervalSince($0) > 0.5 } ?? true
        } else {
            logUpdated = false
        }
        let logExcerpt = tailLog(logPath)
        let summary = StartupFailureDiagnostics.applicationFailureSummary(
            service: service,
            port: port,
            httpStatus: httpStatus,
            processSummary: processSummary,
            listenerSummary: listenerSummary,
            logPath: logPath,
            logUpdatedSinceStart: logUpdated,
            logExcerpt: logExcerpt
        )
        LauncherLog.write("启动诊断：\n" + summary)
        return summary
    }

    private static func javaProcessSummary(home: String) -> String {
        guard let result = try? run("/bin/ps", ["-axo", "pid=,command="], timeout: 8),
              result.exitCode == 0 else {
            return "查询 Java 进程失败"
        }
        let pids = result.output
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
                guard parts.count == 2, parts[1].contains("-Dcatalina.home=\(home)") else { return nil }
                return String(parts[0])
            }
        return pids.isEmpty ? "none" : pids.joined(separator: ", ")
    }

    private static func listenerSummary(port: Int) -> String {
        guard let result = try? run(
            "/usr/sbin/lsof",
            ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"],
            timeout: 8
        ) else {
            return "check unavailable"
        }
        if result.exitCode == 1 && result.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "none"
        }
        guard result.exitCode == 0 else { return "check failed" }
        let pids = result.output
            .split(whereSeparator: \.isNewline)
            .map(String.init)
        return pids.isEmpty ? "none" : pids.joined(separator: ", ")
    }

    private static func tailLog(_ path: String) -> String {
        guard let result = try? run("/usr/bin/tail", ["-n", "24", path], timeout: 5),
              result.exitCode == 0 else {
            return ""
        }
        return result.output
    }

    private static func fileModificationDate(_ path: String) -> Date? {
        let url = URL(fileURLWithPath: path)
        return try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
    }

    private static func isHealthy(_ url: String) -> Bool {
        guard let code = Int(httpStatus(url) ?? "") else { return false }
        return (200..<400).contains(code)
    }

    private static func httpStatus(_ url: String) -> String? {
        guard let result = try? run("/usr/bin/curl", [
            "--silent", "--show-error", "--location", "--max-time", "5",
            "--output", "/dev/null", "--write-out", "%{http_code}", url
        ], timeout: 8) else { return nil }
        let output = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.exitCode == 0 && output.count == 3 ? output : nil
    }

    private static func commandSucceeded(_ executable: String, _ arguments: [String], timeout: TimeInterval) -> Bool {
        guard let result = try? run(executable, arguments, timeout: timeout) else { return false }
        return result.exitCode == 0
    }

    private static func run(
        _ executable: String,
        _ arguments: [String],
        timeout: TimeInterval,
        workingDirectory: String? = nil,
        environment: [String: String] = [:]
    ) throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = workingDirectory.map(URL.init(fileURLWithPath:))
        process.environment = ProcessInfo.processInfo.environment.merging([
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        ].merging(environment) { _, preferred in preferred }) { _, preferred in preferred }

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
        } catch {
            throw LauncherError.message("无法运行 \(URL(fileURLWithPath: executable).lastPathComponent)：\(error.localizedDescription)")
        }

        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
            let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            LauncherLog.writeCommandOutput(
                "\(URL(fileURLWithPath: executable).lastPathComponent) 超时",
                CommandResult(exitCode: process.terminationStatus, output: output)
            )
            let excerpt = StartupFailureDiagnostics.outputExcerpt(output, maxCharacters: 1_200)
            let details = excerpt.isEmpty ? "" : "\n\(excerpt)"
            throw LauncherError.message("命令超时：\(URL(fileURLWithPath: executable).lastPathComponent)\(details)")
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return CommandResult(exitCode: process.terminationStatus, output: String(decoding: data, as: UTF8.self))
    }
}

private struct CommandResult {
    let exitCode: Int32
    let output: String
}

struct StartupFailureDiagnostics {
    static func outputExcerpt(_ output: String, maxCharacters: Int = 8_000) -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard maxCharacters > 0, trimmed.count > maxCharacters else { return trimmed }

        let marker = "[truncated]\n"
        guard maxCharacters > marker.count else {
            return String(trimmed.suffix(maxCharacters))
        }
        return marker + String(trimmed.suffix(maxCharacters - marker.count))
    }

    static func applicationFailureSummary(
        service: String,
        port: Int,
        httpStatus: String,
        processSummary: String,
        listenerSummary: String,
        logPath: String,
        logUpdatedSinceStart: Bool,
        logExcerpt: String
    ) -> String {
        var lines = [
            "\(service) HTTP \(httpStatus)",
            "Java PID: \(processSummary)",
            "\(port) listener PID: \(listenerSummary)",
            "Catalina log \(logUpdatedSinceStart ? "updated" : "unchanged since start"): \(logPath)"
        ]
        let excerpt = outputExcerpt(logExcerpt, maxCharacters: 1_800)
        if !excerpt.isEmpty {
            lines.append("Recent Catalina output:\n\(excerpt)")
        }
        return lines.joined(separator: "\n")
    }
}

private enum LauncherError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

private enum LauncherLog {
    static let fileURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/AtlassianServiceLauncher/launcher.log")

    static func writeCommandOutput(_ label: String, _ result: CommandResult) {
        var entry = "\(label) exit code \(result.exitCode)"
        let excerpt = StartupFailureDiagnostics.outputExcerpt(result.output)
        if !excerpt.isEmpty { entry += "\n" + excerpt }
        write(entry)
    }

    static func write(_ message: String) {
        let manager = FileManager.default
        let directory = fileURL.deletingLastPathComponent()
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            let line = "\(ISO8601DateFormatter().string(from: Date()))  \(message)\n"
            let data = Data(line.utf8)
            if manager.fileExists(atPath: fileURL.path) {
                let handle = try FileHandle(forWritingTo: fileURL)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
            } else {
                try data.write(to: fileURL, options: .atomic)
            }
            try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
        } catch {
            NSLog("AtlassianServiceLauncher could not write its log: %@", error.localizedDescription)
        }
    }
}
