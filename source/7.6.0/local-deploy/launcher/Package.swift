// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JEAuditFlowLauncher",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "JEAuditFlowLauncher", targets: ["JEAuditFlowLauncher"])
    ],
    targets: [
        .executableTarget(
            name: "JEAuditFlowLauncher",
            resources: [.process("../../Resources")]
        )
    ]
)
