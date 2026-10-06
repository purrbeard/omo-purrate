import SwiftUI

@main @MainActor struct OmoRemoteApp: App {
    @StateObject private var model = RemoteModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RemoteRootView()
                .environmentObject(model)
                .tint(Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255))
                .task { model.start() }
                .onChange(of: model.ready) { _, ready in
                    UIApplication.shared.isIdleTimerDisabled = ready
                }
                .onChange(of: scenePhase) { _, phase in
                    // iOS suspends socket work in the background; reconnect and refresh on foreground.
                    if phase == .active {
                        model.start()
                        Task { await model.refresh() }
                    } else if phase == .background {
                        model.stop()
                    }
                }
                .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        }
    }
}
