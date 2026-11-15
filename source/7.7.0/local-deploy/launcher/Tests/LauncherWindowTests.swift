import AppKit

@main
struct LauncherWindowTests {
    @MainActor
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let delegate = AppDelegate()
        delegate.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        guard let window = app.windows.first(where: { $0.title == "JEAuditFlow 本地启动器" }),
              let content = window.contentView else {
            throw WindowFailure.missingWindow
        }
        defer { window.orderOut(nil) }

        for size in [NSSize(width: 1080, height: 820), NSSize(width: 960, height: 720)] {
            window.setContentSize(size)
            content.layoutSubtreeIfNeeded()
            guard content.bounds.height <= size.height + 1 else {
                throw WindowFailure.exceedsRequestedHeight
            }
            let views = descendants(of: content)
            guard let title = views.compactMap({ $0 as? NSTextField })
                .first(where: { $0.stringValue == "JEAuditFlow 本地发布测试台" }),
                  let polarion = views.compactMap({ $0 as? NSButton })
                .first(where: { $0.title == "打开 Polarion" }) else {
                throw WindowFailure.missingControls
            }
            let titleFrame = title.convert(title.bounds, to: content)
            let polarionFrame = polarion.convert(polarion.bounds, to: content)
            guard titleFrame.width > 0, polarionFrame.width > 0,
                  !titleFrame.intersects(polarionFrame),
                  content.bounds.contains(titleFrame), content.bounds.contains(polarionFrame) else {
                throw WindowFailure.overlappingHeader
            }
            let buttons = views.compactMap { $0 as? NSButton }
            for name in ["启动", "健康检查", "打开 AuditFlow", "打开数据库连接说明"] {
                guard let button = buttons.first(where: { $0.title == name }),
                      !button.isHiddenOrHasHiddenAncestor, button.bounds.width > 0,
                      button.bounds.height > 0 else {
                    throw WindowFailure.missingControls
                }
            }
        }
        print("PASS: launcher creates its real window with visible controls and a non-overlapping header")
    }

    @MainActor
    private static func descendants(of view: NSView) -> [NSView] {
        [view] + view.subviews.flatMap { descendants(of: $0) }
    }
}

private enum WindowFailure: Error {
    case missingWindow
    case missingControls
    case overlappingHeader
    case exceedsRequestedHeight
}
