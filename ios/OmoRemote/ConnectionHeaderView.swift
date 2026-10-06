import SwiftUI
import OmoKit

@MainActor struct ConnectionHeader: View {
    @EnvironmentObject private var model: RemoteModel
    var body: some View {
        HStack {
            Label(model.macName ?? model.trustedMacName ?? "OmO", systemImage: "desktopcomputer")
            Spacer()
            if model.ready {
                Text(LocalizedStringKey("state_" + model.bridgeState))
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(Color.green.opacity(0.15), in: Capsule())
            } else {
                Text("Link down - connect the cable and open OmO UI")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
        }
        .accessibilityElement(children: .combine)
        .alert(String(localized: "trust_mac_title"), isPresented: Binding(
            get: { model.pendingMacName != nil },
            set: { if !$0 { model.resolveMacTrust(approve: false) } }
        )) {
            Button(String(localized: "trust_mac_accept")) { model.resolveMacTrust(approve: true) }
            Button(String(localized: "trust_mac_not_now"), role: .cancel) { model.resolveMacTrust(approve: false) }
        } message: {
            Text(model.pendingMacName ?? "")
        }
    }
}
