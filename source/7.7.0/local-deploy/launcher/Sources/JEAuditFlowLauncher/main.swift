import AppKit
import Foundation
import LocalAuthentication
import Security

struct RuntimePorts: Equatable, Sendable {
    var auditflow: Int
    var fileanalyst: Int
    var jiraflow: Int
    var mysql = 0
    var lanHost = ""
}

func isPrivatePolarionBaseURL(_ raw: String) -> Bool {
    guard let components = URLComponents(string: raw),
          ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
          components.user == nil, components.password == nil,
          components.path == "/polarion/", components.query == nil, components.fragment == nil,
          components.port == nil || (components.port.map { (1...65535).contains($0) } ?? false),
          let host = components.host else { return false }
    let parts = host.split(separator: ".").compactMap { UInt8($0) }
    guard parts.count == 4, parts.map(String.init).joined(separator: ".") == host else { return false }
    return parts[0] == 10 ||
        (parts[0] == 192 && parts[1] == 168) ||
        (parts[0] == 172 && (16...31).contains(parts[1]))
}

func defaultRuntimePorts(version: String) -> RuntimePorts {
    let auditflow: Int
    switch version.split(separator: ".").prefix(2).joined(separator: ".") {
    case "7.0", "7.1": auditflow = 47073
    case "7.2": auditflow = 47173
    case "7.3": auditflow = 47273
    case "7.4": auditflow = 47373
    case "7.5": auditflow = 47483
    case "7.6": auditflow = 47583
    case "7.7": auditflow = 47683
    default: auditflow = 46973
    }
    return RuntimePorts(
        auditflow: auditflow,
        fileanalyst: auditflow + 1,
        jiraflow: auditflow + 2,
        mysql: version.hasPrefix("7.7") ? 43324 : 0
    )
}

func defaultAuditFlowEntry(version: String) -> String {
    version.compare("7.6.0", options: .numeric) != .orderedAscending ? "index.html" : "landing.html"
}

struct RuntimeVersionSettings: Sendable {
    var ports: RuntimePorts
    var database: String?
    var volume: String?
    var nativeMySQL = false
    var polarionConfigured = false
    var polarionBaseURL: String?
    var errorMessage: String?
}

struct RuntimeCatalogSnapshot: Sendable {
    var versions: [String] = []
    var currentVersion: String?
    var settings: [String: RuntimeVersionSettings] = [:]
    var errorMessage: String?
}

func performProjectRead<Value: Sendable>(_ operation: @escaping @Sendable () -> Value) async -> Value {
    await Task.detached(priority: .userInitiated, operation: operation).value
}

func runtimeVersionSettings(projectRoot: URL, version: String) async -> RuntimeVersionSettings {
    await performProjectRead {
        readRuntimeVersionSettings(projectRoot: projectRoot, version: version)
    }
}

func runtimePorts(projectRoot: URL, version: String) async -> RuntimePorts {
    await runtimeVersionSettings(projectRoot: projectRoot, version: version).ports
}

private func readRuntimeVersionSettings(projectRoot: URL, version: String) -> RuntimeVersionSettings {
    let fallback = defaultRuntimePorts(version: version)
    let configDirectory = projectRoot.appendingPathComponent("local-deploy/config")
    let minorVersion = version.split(separator: ".").prefix(2).joined(separator: ".")
    var candidates = [
        configDirectory.appendingPathComponent("\(version).local.env"),
        configDirectory.appendingPathComponent("\(minorVersion).local.env")
    ]
    if version.hasPrefix("6.9.") {
        candidates.append(configDirectory.appendingPathComponent("local.env"))
    }
    var text: String?
    for candidate in candidates {
        do {
            text = try String(contentsOf: candidate, encoding: .utf8)
            break
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
            continue
        } catch {
            return RuntimeVersionSettings(ports: fallback, errorMessage: "无法读取 \(version) 配置：\(error.localizedDescription)")
        }
    }
    guard let text else {
        return RuntimeVersionSettings(ports: fallback)
    }
    func value(_ key: String) -> String {
        let prefix = "\(key)="
        return text.split(whereSeparator: \.isNewline)
            .first(where: { $0.hasPrefix(prefix) })
            .map { String($0.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    }
    func port(_ key: String, fallback: Int) -> Int {
        guard let number = Int(value(key)), (1...65535).contains(number) else { return fallback }
        return number
    }
    let polarionBaseURL = value("JEAUDITFLOW_POLARION_URL")
    let polarionConfigured = isPrivatePolarionBaseURL(polarionBaseURL)
    return RuntimeVersionSettings(
        ports: RuntimePorts(
            auditflow: port("AUDITFLOW_PORT", fallback: fallback.auditflow),
            fileanalyst: port("FILEANALYST_PORT", fallback: fallback.fileanalyst),
            jiraflow: port("JIRAFLOW_PORT", fallback: fallback.jiraflow),
            mysql: port("DB_PORT", fallback: fallback.mysql),
            lanHost: value("AUDITFLOW_LAN_HOST")
        ),
        database: value("MYSQL_DATABASE"),
        volume: value("MYSQL_VOLUME_NAME"),
        nativeMySQL: value("JEAUDITFLOW_DATABASE_MODE") == "native",
        polarionConfigured: polarionConfigured,
        polarionBaseURL: polarionConfigured ? polarionBaseURL : nil
    )
}

func installedRuntimeVersions(projectRoot: URL) -> [String] {
    (try? scanRuntimeVersions(projectRoot: projectRoot)) ?? []
}

func runtimeCatalogSnapshot(projectRoot: URL) async -> RuntimeCatalogSnapshot {
    await performProjectRead {
        do {
            let versions = try scanRuntimeVersions(projectRoot: projectRoot)
            let currentURL = projectRoot.appendingPathComponent("local-deploy/runtime/current-version")
            let current = try? String(contentsOf: currentURL, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let settings = Dictionary(uniqueKeysWithValues: versions.map { version in
                (version, readRuntimeVersionSettings(projectRoot: projectRoot, version: version))
            })
            return RuntimeCatalogSnapshot(versions: versions, currentVersion: current, settings: settings)
        } catch {
            return RuntimeCatalogSnapshot(errorMessage: "无法读取项目版本目录：\(error.localizedDescription)")
        }
    }
}

private func scanRuntimeVersions(projectRoot: URL) throws -> [String] {
    let fileManager = FileManager.default
    let runtimeRoot = projectRoot.appendingPathComponent("local-deploy/runtime", isDirectory: true)
    let versionsRoot = runtimeRoot.appendingPathComponent("versions", isDirectory: true)
    let databaseRoot = runtimeRoot.appendingPathComponent("database", isDirectory: true)
    let entries = try fileManager.contentsOfDirectory(
        at: versionsRoot,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
    )

    return entries.compactMap { runtimeURL -> String? in
        guard let directoryValues = try? runtimeURL.resourceValues(forKeys: [.isDirectoryKey]),
              directoryValues.isDirectory == true,
              isRegularFile(at: runtimeURL.appendingPathComponent("manifest.json"), fileManager: fileManager),
              let version = readManifestVersion(at: runtimeURL.appendingPathComponent("manifest.json")),
              runtimeURL.lastPathComponent == version,
              isCompleteRuntime(version: version, runtimeURL: runtimeURL, databaseRoot: databaseRoot, fileManager: fileManager)
        else {
            return nil
        }
        return version
    }.sorted(by: compareRuntimeVersions)
}

private func readManifestVersion(at manifestURL: URL) -> String? {
    guard let data = try? Data(contentsOf: manifestURL),
          let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let version = manifest["version"] as? String else {
        return nil
    }
    return version
}

private func isCompleteRuntime(
    version: String,
    runtimeURL: URL,
    databaseRoot: URL,
    fileManager: FileManager
) -> Bool {
    let requiredRuntimeFiles = [
        "server/server.mjs",
        "fileanalyst/server.mjs",
        "jiraflow/jiraflow.jar",
        "client/index.html",
        "client/manifest.json"
    ]
    guard requiredRuntimeFiles.allSatisfy({
        isRegularFile(at: runtimeURL.appendingPathComponent($0), fileManager: fileManager)
    }),
    readManifestVersion(at: runtimeURL.appendingPathComponent("client/manifest.json")) == version
    else {
        return false
    }

    let databaseURL = databaseRoot.appendingPathComponent(version, isDirectory: true)
    let databaseManifestURL = databaseURL.appendingPathComponent("manifest.json")
    guard isRegularFile(at: databaseManifestURL, fileManager: fileManager),
          let databaseManifestData = try? Data(contentsOf: databaseManifestURL),
          let databaseManifest = try? JSONSerialization.jsonObject(with: databaseManifestData) as? [String: Any],
          databaseManifest["version"] as? String == version,
          databaseManifest["defaultDatabase"] as? String == "jeauditflow_\(version.filter(\.isNumber))",
          databaseManifest["persistentVolume"] as? String == "jeauditflow_\(version.filter(\.isNumber))_mysql_data",
          isRegularFile(at: databaseURL.appendingPathComponent("schema/collaboration-schema.sql"), fileManager: fileManager)
    else {
        return false
    }
    return true
}

private func isRegularFile(at url: URL, fileManager: FileManager) -> Bool {
    guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
          let fileType = attributes[.type] as? FileAttributeType else {
        return false
    }
    return fileType == .typeRegular
}

private func compareRuntimeVersions(_ lhs: String, _ rhs: String) -> Bool {
    lhs.split(separator: ".").map { Int($0) ?? 0 }
        .lexicographicallyPrecedes(rhs.split(separator: ".").map { Int($0) ?? 0 })
}

#if !LAUNCHER_RUNTIME_CATALOG_TESTS
@main
struct JEAuditFlowLauncherMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
#endif

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    private let defaults = UserDefaults.standard
    private let defaultAdminEmail = "yumeng.li@johnsonelectric.com"
    private let keychainService = "local.maplemock.jeauditflowlauncher.admin"
    private let keychainAccount = "auditflow-session-token"
    private var window: NSWindow!
    private var projectRootField: NSTextField!
    private var versionPopup: NSPopUpButton!
    private var adminEmailField: NSTextField!
    private var adminPasswordField: NSSecureTextField!
    private var loginButton: NSButton!
    private var logoutButton: NSButton!
    private var adminStatusLabel: NSTextField!
    private var outputView: NSTextView!
    private var progress: NSProgressIndicator!
    private var lanAccessLabel: NSTextField!
    private var protectedActionButtons: [NSButton] = []
    private var healthButton: NSButton!
    private var polarionButton: NSButton!
    private var migrationButton: NSButton!
    private var statusLabels: [String: NSTextField] = [:]
    private var runningProcess: Process?
    private var sessionToken: String?
    private var isAdminAuthenticated = false
    private var restoreSessionTask: Task<Void, Never>?
    private var authenticationGeneration = UUID()
    private var catalogTask: Task<Void, Never>?
    private var catalogWatchdog: Task<Void, Never>?
    private var catalogGeneration = UUID()
    private var catalogProjectRoot = ""
    private var isReadingProject = true
    private var versionSettings: [String: RuntimeVersionSettings] = [:]
    private var lastKnownCurrentVersion: String?
    private var cachedProjectRoot = ""
    private var applicationLinkButtons: [NSButton] = []
    private let keychainQueue = DispatchQueue(label: "local.maplemock.jeauditflowlauncher.keychain")
    private var currentPorts = defaultRuntimePorts(version: "6.9.0")

    private var projectRoot: String {
        get {
            cachedProjectRoot
        }
        set {
            cachedProjectRoot = newValue
            defaults.set(newValue, forKey: "projectRoot")
        }
    }

    private var deployScript: String {
        URL(fileURLWithPath: projectRoot)
            .appendingPathComponent("local-deploy/scripts/jeauditflow-local.sh")
            .path
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        loadProjectRoot()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "JEAuditFlow 本地启动器"
        window.minSize = NSSize(width: 960, height: 720)
        window.center()

        let title = NSTextField(labelWithString: "JEAuditFlow 本地发布测试台")
        title.font = .systemFont(ofSize: 25, weight: .semibold)
        polarionButton = commandButton("point.3.connected.trianglepath.dotted", title: "打开 Polarion", action: #selector(openPolarion))
        let titleRow = NSStackView(views: [title, NSView(), polarionButton])
        titleRow.orientation = .horizontal
        titleRow.alignment = .centerY
        titleRow.spacing = 12
        titleRow.setContentHuggingPriority(.required, for: .vertical)
        polarionButton.setContentHuggingPriority(.required, for: .horizontal)
        polarionButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        let subtitle = NSTextField(wrappingLabelWithString: "按版本隔离运行与数据库；切换版本前请核实数据库兼容性，现有数据不会自动迁移。")
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor

        projectRootField = NSTextField()
        projectRootField.placeholderString = "AuditFlowDesktop71 项目目录"
        projectRootField.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        projectRootField.target = self
        projectRootField.action = #selector(projectRootChanged)
        let chooseRoot = NSButton(title: "选择…", target: self, action: #selector(chooseProjectRoot))
        chooseRoot.bezelStyle = .rounded
        let rootRow = labeledRow("项目目录", controls: [projectRootField, chooseRoot])
        rootRow.alignment = .centerY
        titleRow.widthAnchor.constraint(equalTo: rootRow.widthAnchor).isActive = true
        projectRootField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        chooseRoot.setContentHuggingPriority(.required, for: .horizontal)

        versionPopup = NSPopUpButton()
        versionPopup.target = self
        versionPopup.action = #selector(versionChanged)
        let refreshVersionsButton = iconButton("arrow.clockwise", title: "刷新版本", action: #selector(refreshVersions))
        let installButton = NSButton(title: "安装发行包…", target: self, action: #selector(installRelease))
        installButton.bezelStyle = .rounded
        let versionRow = labeledRow("运行版本", controls: [versionPopup, refreshVersionsButton, installButton])
        versionPopup.setContentHuggingPriority(.defaultLow, for: .horizontal)

        adminEmailField = NSTextField(string: defaultAdminEmail)
        adminEmailField.font = .systemFont(ofSize: 13)
        adminEmailField.placeholderString = defaultAdminEmail
        adminEmailField.delegate = self
        adminPasswordField = NSSecureTextField()
        adminPasswordField.font = .systemFont(ofSize: 13)
        adminPasswordField.placeholderString = "输入管理员密码（仅驻留本机内存）"
        adminPasswordField.delegate = self
        adminPasswordField.target = self
        adminPasswordField.action = #selector(loginAdmin)
        loginButton = commandButton("person.crop.circle.badge.checkmark", title: "登录管理员账号", action: #selector(loginAdmin))
        logoutButton = commandButton("rectangle.portrait.and.arrow.right", title: "退出会话", action: #selector(logoutAdmin))
        adminStatusLabel = NSTextField(labelWithString: "未登录；启动服务时会使用此账号进行本机认证")
        adminStatusLabel.textColor = .secondaryLabelColor
        adminStatusLabel.maximumNumberOfLines = 2
        adminStatusLabel.lineBreakMode = .byTruncatingTail
        let authActions = NSStackView(views: [loginButton, logoutButton])
        authActions.orientation = .horizontal
        authActions.spacing = 8
        authActions.setContentHuggingPriority(.required, for: .horizontal)
        let authBox = NSBox()
        authBox.titlePosition = .noTitle
        let authStack = NSStackView(views: [
            labeledRow("管理员邮箱", controls: [adminEmailField]),
            labeledRow("管理员密码", controls: [adminPasswordField]),
            NSStackView(views: [adminStatusLabel, authActions])
        ])
        authStack.orientation = .vertical
        authStack.spacing = 8
        authStack.alignment = .leading
        authBox.contentView = authStack
        authBox.contentViewMargins = NSSize(width: 14, height: 12)

        let statusRows = [
            [("backend", "AuditFlow"), ("fileanalyst", "FileAnalyst")],
            [("jiraflow", "JiraFlow"), ("mysql", "MySQL")]
        ]
        let statusStack = NSStackView()
        statusStack.orientation = .vertical
        statusStack.spacing = 10
        statusStack.alignment = .leading
        for row in statusRows {
            let rowStack = NSStackView()
            rowStack.orientation = .horizontal
            rowStack.distribution = .fillEqually
            rowStack.spacing = 10
            for (key, title) in row {
                let card = serviceCard(title: title, key: key)
                card.heightAnchor.constraint(equalToConstant: 68).isActive = true
                rowStack.addArrangedSubview(card)
            }
            statusStack.addArrangedSubview(rowStack)
            rowStack.widthAnchor.constraint(equalTo: statusStack.widthAnchor).isActive = true
        }

        let start = commandButton("play.fill", title: "启动", action: #selector(startStack))
        let restart = commandButton("arrow.clockwise", title: "重启", action: #selector(restartStack))
        let stop = commandButton("stop.fill", title: "停止应用服务", action: #selector(stopStack))
        healthButton = commandButton("checkmark.shield", title: "健康检查", action: #selector(refreshStatus))
        migrationButton = commandButton("arrow.triangle.2.circlepath", title: "迁移 7.6 数据到 7.7", action: #selector(migrateToNativeMySQL))
        protectedActionButtons = [start, restart, stop]
        let controlRows = [
            NSStackView(views: [start, restart]),
            NSStackView(views: [stop, healthButton]),
            NSStackView(views: [migrationButton])
        ]
        let controls = NSStackView(views: controlRows)
        controls.orientation = .vertical
        controls.spacing = 8
        controlRows.forEach {
            $0.orientation = .horizontal
            $0.distribution = .fillEqually
            $0.spacing = 8
            $0.heightAnchor.constraint(equalToConstant: 36).isActive = true
        }

        let openAuditFlow = commandButton("safari", title: "打开 AuditFlow", action: #selector(openAuditFlow))
        let openFileAnalyst = commandButton("doc.text.magnifyingglass", title: "打开 FileAnalyst", action: #selector(openFileAnalyst))
        let openJiraFlow = commandButton("list.bullet.rectangle", title: "打开 JiraFlow", action: #selector(openJiraFlow))
        let openMySQL = commandButton("cylinder.split.1x2", title: "打开数据库连接说明", action: #selector(openDatabaseGuide))
        applicationLinkButtons = [openAuditFlow, openFileAnalyst, openJiraFlow, openMySQL]
        let linkRows = [
            NSStackView(views: [openAuditFlow, openFileAnalyst]),
            NSStackView(views: [openJiraFlow, openMySQL])
        ]
        let links = NSStackView(views: linkRows)
        links.orientation = .vertical
        links.spacing = 8
        linkRows.forEach {
            $0.orientation = .horizontal
            $0.distribution = .fillEqually
            $0.spacing = 8
            $0.heightAnchor.constraint(equalToConstant: 36).isActive = true
        }

        lanAccessLabel = NSTextField(labelWithString: "未配置")
        lanAccessLabel.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        lanAccessLabel.textColor = .secondaryLabelColor
        lanAccessLabel.lineBreakMode = .byTruncatingMiddle
        lanAccessLabel.isSelectable = true
        let copyLanAddress = iconButton("doc.on.doc", title: "复制 Wi-Fi 地址", action: #selector(copyLanAddress))
        let lanAccessRow = labeledRow("Wi-Fi 地址", controls: [lanAccessLabel, copyLanAddress])

        /*
         Keep each service card and action row at a stable height. The old
         four-column layout compressed button titles into the status text when
         the window was resized, which made the rows appear to overlap.
         */
        for row in statusStack.arrangedSubviews.compactMap({ $0 as? NSStackView }) {
            row.heightAnchor.constraint(equalToConstant: 68).isActive = true
        }

        progress = NSProgressIndicator()
        progress.style = .spinning
        progress.controlSize = .small
        progress.isDisplayedWhenStopped = false
        let progressLabel = NSTextField(labelWithString: "就绪")
        progressLabel.textColor = .secondaryLabelColor
        let progressRow = NSStackView(views: [progress, progressLabel])
        progressRow.orientation = .horizontal
        progressRow.spacing = 8

        outputView = NSTextView()
        outputView.isEditable = false
        outputView.isSelectable = true
        outputView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        outputView.textColor = .labelColor
        outputView.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(calibratedWhite: 0.10, alpha: 1) : NSColor(calibratedWhite: 0.97, alpha: 1)
        }
        let outputScroll = NSScrollView()
        outputScroll.hasVerticalScroller = true
        outputScroll.borderType = .bezelBorder
        outputScroll.documentView = outputView
        outputScroll.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [titleRow, subtitle, rootRow, versionRow, authBox, statusStack, controls, links, lanAccessRow, progressRow, outputScroll])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22),
            rootRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            versionRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            authBox.widthAnchor.constraint(equalTo: stack.widthAnchor),
            authBox.heightAnchor.constraint(equalToConstant: 132),
            statusStack.widthAnchor.constraint(equalTo: stack.widthAnchor),
            controls.widthAnchor.constraint(equalTo: stack.widthAnchor),
            links.widthAnchor.constraint(equalTo: stack.widthAnchor),
            lanAccessRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            progressRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            outputScroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            outputScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 250),
            title.widthAnchor.constraint(equalTo: stack.widthAnchor),
            subtitle.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        window.contentView = content
        updateAuthenticationControls()
    }

    private func labeledRow(_ label: String, controls: [NSView]) -> NSStackView {
        let heading = NSTextField(labelWithString: label)
        heading.font = .systemFont(ofSize: 12, weight: .semibold)
        heading.alignment = .right
        heading.widthAnchor.constraint(equalToConstant: 78).isActive = true
        heading.setContentHuggingPriority(.required, for: .horizontal)
        let row = NSStackView(views: [heading] + controls)
        row.orientation = .horizontal
        row.distribution = .fill
        row.spacing = 8
        row.heightAnchor.constraint(equalToConstant: 32).isActive = true
        controls.forEach {
            $0.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            $0.setContentHuggingPriority(.defaultLow, for: .horizontal)
        }
        return row
    }

    private func serviceCard(title: String, key: String) -> NSView {
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 12, weight: .semibold)
        heading.lineBreakMode = .byTruncatingTail
        let status = NSTextField(labelWithString: "检查中…")
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        status.maximumNumberOfLines = 2
        status.lineBreakMode = .byTruncatingTail
        statusLabels[key] = status
        let stack = NSStackView(views: [heading, status])
        stack.orientation = .vertical
        stack.spacing = 5
        stack.alignment = .leading
        let box = NSBox()
        box.titlePosition = .noTitle
        box.contentView = stack
        box.contentViewMargins = NSSize(width: 12, height: 10)
        box.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return box
    }

    private func commandButton(_ symbol: String, title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: title) {
            button.image = image
            button.imagePosition = .imageLeading
        }
        button.bezelStyle = .rounded
        button.font = .systemFont(ofSize: 12, weight: .medium)
        button.cell?.lineBreakMode = .byTruncatingTail
        button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        button.toolTip = title
        return button
    }

    private func iconButton(_ symbol: String, title: String, action: Selector) -> NSButton {
        let button = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: title) ?? NSImage(), target: self, action: action)
        button.bezelStyle = .texturedRounded
        button.toolTip = title
        return button
    }

    private func loadProjectRoot() {
        if let stored = defaults.string(forKey: "projectRoot"), !stored.isEmpty {
            cachedProjectRoot = stored
            projectRootField.stringValue = stored
            refreshVersions()
            return
        }
        progressLabel("正在读取默认项目目录…")
        Task { [weak self] in
            let root = await performProjectRead {
                if let bundled = Bundle.main.url(forResource: "default-project-root", withExtension: "txt"),
                   let value = try? String(contentsOf: bundled, encoding: .utf8) {
                    return value.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                return FileManager.default.currentDirectoryPath
            }
            guard let self, self.cachedProjectRoot.isEmpty else { return }
            self.projectRoot = root
            self.projectRootField.stringValue = root
            self.refreshVersions()
        }
    }

    @objc private func projectRootChanged() {
        projectRoot = projectRootField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        refreshVersions()
    }

    @objc private func chooseProjectRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "选择项目目录"
        panel.message = "请选择包含 local-deploy 的项目目录。若 macOS 请求访问文件夹，请允许访问。"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            self.catalogTask?.cancel()
            self.catalogTask = nil
            self.projectRootField.stringValue = url.path
            self.projectRootChanged()
        }
    }

    @objc private func refreshVersions() {
        let root = projectRoot
        guard !root.isEmpty else {
            appendOutput("请使用“选择…”指定项目目录。")
            return
        }
        if isReadingProject, catalogTask != nil, catalogProjectRoot == root {
            appendOutput("目录仍在读取；可使用“选择…”重新确认文件夹访问。")
            return
        }
        catalogTask?.cancel()
        catalogWatchdog?.cancel()
        restoreSessionTask?.cancel()
        authenticationGeneration = UUID()
        isAdminAuthenticated = false
        sessionToken = nil
        isReadingProject = true
        versionSettings = [:]
        catalogProjectRoot = root
        let generation = UUID()
        catalogGeneration = generation
        let previousVersion = versionPopup.selectedItem?.title
        versionPopup.removeAllItems()
        versionPopup.addItem(withTitle: "正在读取版本…")
        updateAuthenticationControls()
        progress.startAnimation(nil)
        progressLabel("正在读取项目目录…")
        catalogWatchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, let self, self.catalogGeneration == generation, self.isReadingProject else { return }
            self.progress.stopAnimation(nil)
            self.progressLabel("等待文件夹访问；可点“选择…”重新确认目录")
            self.appendOutput("项目目录读取尚未完成。请处理 macOS 的文件夹访问请求，或点击“选择…”重新选择该项目目录。窗口可继续操作。")
        }
        catalogTask = Task { [weak self] in
            let snapshot = await runtimeCatalogSnapshot(projectRoot: URL(fileURLWithPath: root))
            guard !Task.isCancelled, let self, self.catalogGeneration == generation, self.projectRoot == root else { return }
            self.catalogWatchdog?.cancel()
            self.catalogTask = nil
            self.isReadingProject = false
            self.progress.stopAnimation(nil)
            self.versionPopup.removeAllItems()
            if let error = snapshot.errorMessage {
                self.versionPopup.addItem(withTitle: "目录访问未完成")
                self.progressLabel("请重新选择项目目录并允许访问")
                self.appendOutput("\(error)\n请使用“选择…”确认项目目录和文件夹访问权限。")
                self.updateAuthenticationControls()
                return
            }
            self.lastKnownCurrentVersion = snapshot.currentVersion
            self.versionSettings = snapshot.settings
            if snapshot.versions.isEmpty {
                self.versionPopup.addItem(withTitle: "未安装版本")
                self.progressLabel("请安装发行包或选择已有项目目录")
                self.updateAuthenticationControls()
                return
            }
            self.versionPopup.addItems(withTitles: snapshot.versions)
            let selected = [snapshot.currentVersion, previousVersion].compactMap { $0 }
                .first(where: { snapshot.versions.contains($0) }) ?? snapshot.versions.last!
            self.versionPopup.selectItem(withTitle: selected)
            self.refreshPorts()
            self.progressLabel("就绪")
            self.updateAuthenticationControls()
            self.refreshStatus()
            self.restoreAdminSession()
        }
    }

    @objc private func versionChanged() {
        guard let version = versionPopup.selectedItem?.title, version.contains(".") else { return }
        appendOutput("选择版本 \(version)")
        restoreSessionTask?.cancel()
        authenticationGeneration = UUID()
        isAdminAuthenticated = false
        sessionToken = nil
        refreshPorts()
        updateAuthenticationControls()
        refreshStatus()
        restoreAdminSession()
    }

    private func refreshPorts() {
        let version = versionPopup?.selectedItem?.title ?? lastKnownCurrentVersion ?? "6.9.0"
        let settings = versionSettings[version]
        currentPorts = settings?.ports ?? defaultRuntimePorts(version: version)
        if let error = settings?.errorMessage { appendOutput(error) }
        updateLanAccess()
    }

    private func reloadSelectedSettings() {
        guard let version = versionPopup.selectedItem?.title, versionSettings[version] != nil else { return }
        let root = projectRoot
        let generation = catalogGeneration
        Task { [weak self] in
            let settings = await runtimeVersionSettings(projectRoot: URL(fileURLWithPath: root), version: version)
            guard let self, self.catalogGeneration == generation, self.projectRoot == root,
                  self.versionPopup.selectedItem?.title == version else { return }
            if self.currentPorts.auditflow != settings.ports.auditflow {
                self.authenticationGeneration = UUID()
                self.restoreSessionTask?.cancel()
                self.isAdminAuthenticated = false
                self.sessionToken = nil
            }
            self.versionSettings[version] = settings
            self.refreshPorts()
            self.updateAuthenticationControls()
        }
    }

    private var lanAuditFlowURL: String? {
        guard !currentPorts.lanHost.isEmpty else { return nil }
        let version = versionPopup.selectedItem?.title ?? lastKnownCurrentVersion ?? "7.6.0"
        return "http://\(currentPorts.lanHost):\(currentPorts.auditflow)/\(defaultAuditFlowEntry(version: version))"
    }

    private func updateLanAccess() {
        lanAccessLabel?.stringValue = lanAuditFlowURL ?? "未配置"
        lanAccessLabel?.toolTip = lanAuditFlowURL ?? "所选版本未配置 Wi-Fi 网络访问"
    }

    @objc private func copyLanAddress() {
        guard let lanAuditFlowURL else {
            appendOutput("所选版本未配置 Wi-Fi 地址。")
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lanAuditFlowURL, forType: .string)
        appendOutput("已复制 Wi-Fi 地址：\(lanAuditFlowURL)")
    }

    @objc private func refreshStatus() {
        guard !isReadingProject, let version = versionPopup.selectedItem?.title, versionSettings[version] != nil else { return }
        let args = selectedVersionArgs(command: "health")
        runCommand(args, progressText: "正在检查所选版本服务…", updatesStatus: true)
    }

    @objc private func startStack() {
        let args = selectedVersionArgs(command: "start")
        guard let environment = databaseConfirmationEnvironment(forSelectedVersion: true) else { return }
        var startupEnvironment = environment
        guard applyStartupCredentials(to: &startupEnvironment) else { return }
        runCommand(args, progressText: "正在启动 MySQL、FileAnalyst、AuditFlow 与 JiraFlow…", updatesStatus: true, completion: { [weak self] in
            self?.performLogin(silent: true)
        }, environmentOverrides: startupEnvironment)
    }

    @objc private func restartStack() {
        let args = selectedVersionArgs(command: "restart")
        guard let environment = databaseConfirmationEnvironment(forSelectedVersion: true) else { return }
        var startupEnvironment = environment
        guard applyStartupCredentials(to: &startupEnvironment) else { return }
        runCommand(args, progressText: "正在重启选定版本…", updatesStatus: true, completion: { [weak self] in
            self?.performLogin(silent: true)
        }, environmentOverrides: startupEnvironment)
    }

    @objc private func stopStack() {
        guard requireAdmin("停止应用服务") else { return }
        runCommand(selectedVersionArgs(command: "stop"), progressText: "正在停止应用服务（MySQL 数据保留）…", updatesStatus: true)
    }

    private func selectedVersionArgs(command: String) -> [String] {
        guard let version = versionPopup.selectedItem?.title, version.contains(".") else { return [command] }
        return [command, "--version", version]
    }

    @objc private func installRelease() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "安装此发行目录"
        let defaultDirectory = URL(fileURLWithPath: projectRoot).appendingPathComponent("artifacts/releases")
        panel.directoryURL = defaultDirectory
        if panel.runModal() == .OK, let url = panel.url {
            runCommand(["install", "--release-dir", url.path], progressText: "正在安装发行包并准备依赖…", updatesStatus: false) { [weak self] in
                self?.refreshVersions()
            }
        }
    }

    private func databaseConfirmationEnvironment(forSelectedVersion requireConfirmation: Bool) -> [String: String]? {
        guard requireConfirmation,
              let version = versionPopup.selectedItem?.title,
              version.hasPrefix("7."),
              let minor = Int(version.split(separator: ".").dropFirst().first ?? "0"),
              minor >= 1 else { return [:] }
        guard !isReadingProject, let settings = versionSettings[version],
              settings.errorMessage == nil, let database = settings.database, let volume = settings.volume,
              !database.isEmpty, !volume.isEmpty else {
            appendOutput("找不到所选版本 \(version) 的数据库配置；已取消启动，未执行数据库操作。")
            return nil
        }
        let digits = version.filter(\.isNumber)
        guard database == "jeauditflow_\(digits)", volume == "\(database)_mysql_data" else {
            appendOutput("所选版本 \(version) 的数据库/卷名称与版本隔离约定不匹配；已取消启动，未执行数据库操作。")
            return nil
        }
        let alert = NSAlert()
        alert.messageText = "确认启动 JEAuditFlow \(version) 并应用数据库结构？"
        let native = settings.nativeMySQL
        let target = native ? "本地 MySQL（仅监听 127.0.0.1:\(settings.ports.mysql)）" : "Docker 卷 \(volume)"
        let confirmationTarget = native ? "native" : volume
        let exactConfirmation = "APPLY \(database) ON \(confirmationTarget)"
        alert.informativeText = "目标数据库：\(database)\n目标存储：\(target)\n将只对该版本数据库应用幂等 schema；不会自动导入或迁移其他版本数据。确认字符串：\(exactConfirmation)"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确认此目标")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else {
            appendOutput("已取消 \(version) 数据库操作。")
            return nil
        }
        return ["JEAUDITFLOW_CONFIRM_DATABASE": exactConfirmation]
    }

    private func runCommand(_ arguments: [String], progressText: String, updatesStatus: Bool, completion: (() -> Void)? = nil, environmentOverrides: [String: String] = [:]) {
        guard runningProcess == nil else {
            appendOutput("已有操作正在运行，请等待完成。")
            return
        }
        guard !projectRoot.isEmpty else {
            appendOutput("请先选择项目目录。")
            return
        }
        let commandRoot = projectRoot
        let script = deployScript
        let generation = catalogGeneration
        let selectedVersion = versionPopup.selectedItem?.title
        setBusy(true, text: progressText)
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script] + arguments
        process.currentDirectoryURL = URL(fileURLWithPath: commandRoot)
        var environment = ProcessInfo.processInfo.environment
        let runtimePaths = [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            environment["PATH"] ?? ""
        ]
        environment["PATH"] = runtimePaths.filter { !$0.isEmpty }.joined(separator: ":")
        process.environment = environment.merging(environmentOverrides) { _, value in value }
        process.standardOutput = pipe
        process.standardError = pipe
        runningProcess = process
        appendOutput("$ \(script) \(arguments.joined(separator: " "))")
        Task { [weak self, weak process] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, let process, self.runningProcess === process, !process.isRunning else { return }
            self.progressLabel("等待控制脚本访问；可重新选择项目目录")
            self.appendOutput("控制脚本尚未启动。请处理 macOS 的文件夹访问请求，或使用“选择…”重新确认项目目录。")
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self, weak process] in
            guard let process else { return }
            do {
                guard FileManager.default.fileExists(atPath: script) else {
                    throw NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoSuchFileError,
                                  userInfo: [NSLocalizedDescriptionKey: "找不到启动脚本，请重新选择项目目录并允许文件夹访问。"])
                }
                try process.run()
            } catch {
                DispatchQueue.main.async {
                    guard let self, self.runningProcess === process else { return }
                    self.runningProcess = nil
                    self.setBusy(false, text: "无法读取或启动控制脚本")
                    self.appendOutput("无法启动控制脚本：\(error.localizedDescription)")
                }
                return
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            process.waitUntilExit()
            DispatchQueue.main.async {
                guard let self, self.runningProcess === process else { return }
                self.appendOutput(output.trimmingCharacters(in: .whitespacesAndNewlines))
                let success = process.terminationStatus == 0
                self.runningProcess = nil
                self.setBusy(false, text: success ? "完成" : "失败（请查看输出）")
                guard self.catalogGeneration == generation, self.projectRoot == commandRoot,
                      self.versionPopup.selectedItem?.title == selectedVersion else { return }
                if arguments.first == "health" {
                    self.parseHealth(output, exitCode: process.terminationStatus)
                    self.reloadSelectedSettings()
                } else if updatesStatus && success {
                    self.refreshStatus()
                }
                completion?()
            }
        }
    }

    private func setBusy(_ busy: Bool, text: String) {
        progressLabel(text)
        if busy { progress.startAnimation(nil) } else { progress.stopAnimation(nil) }
        if busy {
            versionPopup?.isEnabled = false
            protectedActionButtons.forEach { $0.isEnabled = false }
            healthButton?.isEnabled = false
            loginButton?.isEnabled = false
            logoutButton?.isEnabled = false
        } else {
            updateAuthenticationControls()
        }
    }

    private func progressLabel(_ text: String) {
        guard let stack = progress.superview as? NSStackView,
              let label = stack.arrangedSubviews.compactMap({ $0 as? NSTextField }).first else { return }
        label.stringValue = text
    }

    private func appendOutput(_ text: String) {
        guard !text.isEmpty else { return }
        let separator = outputView.string.isEmpty ? "" : "\n"
        outputView.string += separator + text
        outputView.scrollToEndOfDocument(nil)
    }

    private func updateStatus(_ key: String, value: String, good: Bool? = nil) {
        guard let label = statusLabels[key] else { return }
        label.stringValue = value
        label.textColor = good == true ? .systemGreen : (good == false ? .systemRed : .secondaryLabelColor)
    }

    private func applyStartupCredentials(to environment: inout [String: String]) -> Bool {
        if isAdminAuthenticated {
            return true
        }
        let email = adminEmailField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = adminPasswordField.stringValue
        guard email.contains("@"), !password.isEmpty else {
            showAlert(
                title: "需要管理员凭据",
                message: "请输入管理员邮箱和密码。密码只用于本次本机启动，不会写入配置文件或日志。"
            )
            return false
        }
        environment["JEAUDITFLOW_ADMIN_EMAIL_OVERRIDE"] = email
        environment["JEAUDITFLOW_ADMIN_PASSWORD_OVERRIDE"] = password
        return true
    }

    private func requireAdmin(_ action: String) -> Bool {
        guard isAdminAuthenticated else {
            showAlert(title: "需要管理员登录", message: "请先登录管理员账号后再执行“\(action)”。")
            return false
        }
        return true
    }

    @objc private func loginAdmin() {
        performLogin(silent: false)
    }

    private func performLogin(silent: Bool) {
        let email = adminEmailField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = adminPasswordField.stringValue
        guard email.contains("@"), !password.isEmpty else {
            if !silent {
                showAlert(title: "登录信息不完整", message: "请输入管理员邮箱和密码。")
            }
            return
        }

        restoreSessionTask?.cancel()
        let authenticationGeneration = UUID()
        self.authenticationGeneration = authenticationGeneration
        let root = projectRoot
        let port = currentPorts.auditflow
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/auth/login") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("http://127.0.0.1:\(port)", forHTTPHeaderField: "Origin")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password])

        setAuthenticationStatus("正在验证管理员会话…", good: nil)
        loginButton.isEnabled = false
        Task { [weak self] in
            guard let self else { return }
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard self.authenticationGeneration == authenticationGeneration, self.projectRoot == root,
                      self.currentPorts.auditflow == port else { return }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                guard (200..<300).contains(statusCode),
                      payload["authenticated"] as? Bool == true,
                      let token = payload["sessionToken"] as? String,
                      let user = payload["user"] as? [String: Any],
                      user["isAdmin"] as? Bool == true else {
                    let message = payload["error"] as? String ?? "管理员认证失败（HTTP \(statusCode)）"
                    await MainActor.run {
                        guard self.authenticationGeneration == authenticationGeneration, self.projectRoot == root,
                              self.currentPorts.auditflow == port else { return }
                        self.isAdminAuthenticated = false
                        self.sessionToken = nil
                        self.setAuthenticationStatus(message, good: false)
                        self.updateAuthenticationControls()
                        if !silent { self.showAlert(title: "管理员登录失败", message: message) }
                    }
                    return
                }
                self.storeSessionToken(token)
                await MainActor.run {
                    guard self.authenticationGeneration == authenticationGeneration, self.projectRoot == root,
                          self.currentPorts.auditflow == port else { return }
                    self.sessionToken = token
                    self.isAdminAuthenticated = true
                    self.adminPasswordField.stringValue = ""
                    self.setAuthenticationStatus("已登录管理员：\(email)", good: true)
                    self.updateAuthenticationControls()
                    self.appendOutput("管理员会话已建立（本机 loopback）。")
                }
            } catch {
                guard self.authenticationGeneration == authenticationGeneration, self.projectRoot == root,
                      self.currentPorts.auditflow == port else { return }
                await MainActor.run {
                    guard self.authenticationGeneration == authenticationGeneration, self.projectRoot == root,
                          self.currentPorts.auditflow == port else { return }
                    self.isAdminAuthenticated = false
                    self.sessionToken = nil
                    self.setAuthenticationStatus("无法连接 AuditFlow 认证接口", good: false)
                    self.updateAuthenticationControls()
                    if !silent {
                        self.showAlert(title: "管理员登录失败", message: "无法连接本机 AuditFlow：\(error.localizedDescription)")
                    }
                }
            }
        }
    }

    private func restoreAdminSession() {
        restoreSessionTask?.cancel()
        let service = keychainService
        let account = keychainAccount
        let port = currentPorts.auditflow
        let root = projectRoot
        let authenticationGeneration = authenticationGeneration
        restoreSessionTask = Task { [weak self] in
            // Legacy Keychain ACL checks can wait even when LAContext forbids UI.
            let token = await Task.detached(priority: .utility) {
                Self.readSessionToken(service: service, account: account)
            }.value
            guard !Task.isCancelled, let self, self.authenticationGeneration == authenticationGeneration,
                  self.projectRoot == root else { return }
            guard self.currentPorts.auditflow == port, let token, !token.isEmpty else {
                self.updateAuthenticationControls()
                return
            }
            guard let url = URL(string: "http://127.0.0.1:\(port)/api/auth/me") else { return }
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 5
            request.setValue(token, forHTTPHeaderField: "X-AuditFlow-Session")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard !Task.isCancelled, self.authenticationGeneration == authenticationGeneration,
                      self.projectRoot == root, self.currentPorts.auditflow == port else { return }
                let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      payload["authenticated"] as? Bool == true,
                      let user = payload["user"] as? [String: Any],
                      user["isAdmin"] as? Bool == true else {
                    self.deleteSessionToken()
                    await MainActor.run {
                        guard !Task.isCancelled, self.authenticationGeneration == authenticationGeneration,
                              self.projectRoot == root, self.currentPorts.auditflow == port else { return }
                        self.sessionToken = nil
                        self.isAdminAuthenticated = false
                        self.setAuthenticationStatus("未登录管理员会话", good: nil)
                        self.updateAuthenticationControls()
                    }
                    return
                }
                await MainActor.run {
                    guard !Task.isCancelled, self.authenticationGeneration == authenticationGeneration,
                          self.projectRoot == root, self.currentPorts.auditflow == port else { return }
                    self.sessionToken = token
                    self.isAdminAuthenticated = true
                    self.adminEmailField.stringValue = (user["email"] as? String) ?? self.defaultAdminEmail
                    self.setAuthenticationStatus("已恢复管理员会话：\(self.adminEmailField.stringValue)", good: true)
                    self.updateAuthenticationControls()
                }
            } catch {
                if !Task.isCancelled { self.updateAuthenticationControls() }
            }
        }
    }

    @objc private func logoutAdmin() {
        authenticationGeneration = UUID()
        restoreSessionTask?.cancel()
        sessionToken = nil
        isAdminAuthenticated = false
        deleteSessionToken()
        adminPasswordField.stringValue = ""
        setAuthenticationStatus("已退出管理员会话", good: nil)
        updateAuthenticationControls()
    }

    private func updateAuthenticationControls() {
        let version = versionPopup?.selectedItem?.title ?? ""
        let projectReady = !isReadingProject && versionSettings[version] != nil
        let hasCredentials = adminEmailField?.stringValue.contains("@") == true
            && adminPasswordField?.stringValue.isEmpty == false
        protectedActionButtons.forEach { $0.isEnabled = projectReady && runningProcess == nil && (isAdminAuthenticated || hasCredentials) }
        migrationButton?.isEnabled = version == "7.7.0" && projectReady && runningProcess == nil && (isAdminAuthenticated || hasCredentials)
        applicationLinkButtons.forEach { $0.isEnabled = projectReady }
        polarionButton?.isEnabled = projectReady && versionSettings[version]?.polarionConfigured == true
        versionPopup?.isEnabled = projectReady && runningProcess == nil
        healthButton?.isEnabled = projectReady && runningProcess == nil
        loginButton?.isEnabled = projectReady && runningProcess == nil
        logoutButton?.isEnabled = runningProcess == nil && isAdminAuthenticated
    }

    private func setAuthenticationStatus(_ text: String, good: Bool?) {
        adminStatusLabel?.stringValue = text
        adminStatusLabel?.textColor = good == true ? .systemGreen : (good == false ? .systemRed : .secondaryLabelColor)
    }

    func controlTextDidChange(_ notification: Notification) {
        updateAuthenticationControls()
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确定")
        alert.runModal()
    }

    private func storeSessionToken(_ token: String) {
        let service = keychainService
        let account = keychainAccount
        keychainQueue.async { Self.writeSessionToken(token, service: service, account: account) }
    }

    private nonisolated static func writeSessionToken(_ token: String, service: String, account: String) {
        guard let data = token.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
    }

    private nonisolated static func readSessionToken(service: String, account: String) -> String? {
        // Automatic restoration must not wait for Keychain UI after a launcher update.
        let authenticationContext = LAContext()
        authenticationContext.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: authenticationContext
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteSessionToken() {
        let service = keychainService
        let account = keychainAccount
        keychainQueue.async { Self.removeSessionToken(service: service, account: account) }
    }

    private nonisolated static func removeSessionToken(service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func parseHealth(_ output: String, exitCode: Int32) {
        let healthRecords: [[String: Any]] = output
            .split(whereSeparator: \.isNewline)
            .compactMap { line in
                guard let data = String(line).data(using: .utf8),
                      let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    return nil
                }
                return record
            }
        let audit = healthRecords.first { $0["app"] as? String == "JEAuditFlow" }
        let file = healthRecords.first { $0["product"] as? String == "FileAnalyst" }
        let jira = healthRecords.first { $0["service"] as? String == "JiraFlow" }
        let auditHealthy = audit?["status"] as? String == "ok"
        let fileHealthy = file?["status"] as? String == "ok"
        let jiraHealthy = jira?["status"] as? String == "ok"
        let mysqlProbePassed = output.contains("MYSQL_PROBE_STATUS=ok")
        let mysqlHealth = output
            .split(whereSeparator: \.isNewline)
            .first(where: { $0.hasPrefix("MYSQL_HEALTH=") })
            .map { String($0.dropFirst("MYSQL_HEALTH=".count)) } ?? "unknown"
        let database = output
            .split(whereSeparator: \.isNewline)
            .first(where: { $0.hasPrefix("MYSQL_DATABASE=") })
            .map { String($0.dropFirst("MYSQL_DATABASE=".count)) } ?? ""
        let version = audit?["version"] as? String
        updateStatus("backend", value: auditHealthy ? "\(version ?? "AuditFlow") · healthy" : "stopped", good: auditHealthy)
        if let version, version.contains("."), let index = versionPopup.itemArray.firstIndex(where: { $0.title == version }) {
            versionPopup.selectItem(at: index)
        }
        updateStatus("fileanalyst", value: fileHealthy ? "healthy" : "stopped", good: fileHealthy)
        updateStatus("jiraflow", value: jiraHealthy ? "healthy" : "stopped", good: jiraHealthy)
        let mysqlVerified = mysqlProbePassed && mysqlHealth == "healthy"
        updateStatus("mysql", value: mysqlVerified ? "healthy" : "not verified", good: mysqlVerified)
        statusLabels["mysql"]?.toolTip = mysqlVerified
            ? "MySQL \(mysqlHealth); database: \(database)"
            : "MySQL check failed; service health: \(mysqlHealth)"
    }

    private func openURL(_ url: URL) {
        NSWorkspace.shared.open(url)
    }

    @objc private func openAuditFlow() {
        let version = versionPopup.selectedItem?.title ?? lastKnownCurrentVersion ?? "7.6.0"
        let address = lanAuditFlowURL
            ?? "http://127.0.0.1:\(currentPorts.auditflow)/\(defaultAuditFlowEntry(version: version))"
        openURL(URL(string: address)!)
    }

    @objc private func openFileAnalyst() {
        openURL(URL(string: "http://127.0.0.1:\(currentPorts.auditflow)/fileanalyst/")!)
    }

    @objc private func openJiraFlow() {
        openURL(URL(string: "http://127.0.0.1:\(currentPorts.auditflow)/jiraflow/")!)
    }

    @objc private func openPolarion() {
        let version = versionPopup.selectedItem?.title ?? ""
        guard let rawURL = versionSettings[version]?.polarionBaseURL,
              isPrivatePolarionBaseURL(rawURL),
              let url = URL(string: rawURL) else {
            appendOutput("所选版本未配置 Polarion 路由地址。")
            return
        }
        openURL(url)
    }

    @objc private func migrateToNativeMySQL() {
        guard versionPopup.selectedItem?.title == "7.7.0", runningProcess == nil else {
            appendOutput("请先选择 7.7.0，并等待其他操作完成。")
            return
        }
        let alert = NSAlert()
        alert.messageText = "将 7.6 数据复制到 7.7 本地 MySQL？"
        alert.informativeText = "来源：jeauditflow_760（现有 Docker MySQL，不会修改）\n目标：jeauditflow_770（新的本地 MySQL 数据目录）\n本地文件与数据库表会分别备份并逐表核对。源数据和旧 Docker 卷保留。若 7.7 已创建运行数据目录，请先停止并检查目标状态。"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "开始复制")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        runCommand(
            ["migrate-native", "--version", "7.7.0"],
            progressText: "正在将 7.6 数据复制并校验到 7.7 本地 MySQL…",
            updatesStatus: false,
            environmentOverrides: ["JEAUDITFLOW_CONFIRM_MIGRATION": "COPY jeauditflow_760 TO jeauditflow_770"]
        )
    }

    @objc private func openDatabaseGuide() {
        let version = versionPopup.selectedItem?.title ?? lastKnownCurrentVersion ?? "7.5.0"
        let guide = URL(fileURLWithPath: projectRoot).appendingPathComponent("local-deploy/runtime/database/\(version)/README.md")
        Task { [weak self] in
            let exists = await performProjectRead {
                FileManager.default.fileExists(atPath: guide.path)
            }
            guard let self else { return }
            if exists {
                NSWorkspace.shared.open(guide)
            } else {
                self.appendOutput("数据库说明不存在或无法读取：\(guide.path)")
            }
        }
    }
}
