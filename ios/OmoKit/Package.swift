// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OmoKit",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "OmoKit", targets: ["OmoKit"])],
    targets: [.target(name: "OmoKit"), .testTarget(name: "OmoKitTests", dependencies: ["OmoKit"])]
)
