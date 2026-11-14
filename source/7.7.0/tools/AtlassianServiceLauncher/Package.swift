// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AtlassianServiceLauncher",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AtlassianServiceLauncher", targets: ["AtlassianServiceLauncher"])
    ],
    targets: [
        .executableTarget(name: "AtlassianServiceLauncher"),
        .testTarget(
            name: "AtlassianServiceLauncherTests",
            dependencies: ["AtlassianServiceLauncher"]
        )
    ]
)
