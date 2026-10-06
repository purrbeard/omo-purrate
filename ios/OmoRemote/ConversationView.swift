import SwiftUI
import OmoKit

@MainActor struct ConversationView: View {
    let threadID: String
    @EnvironmentObject private var model: RemoteModel
    @State private var draft = ""
    @State private var submitting = false
    @State private var presentedRequest: PendingServerRequest?
    /// Requests the user closed without answering; they stay reachable from the banner instead of reopening.
    @State private var deferredRequestIDs: Set<String> = []
    private var thread: ConversationThread? { model.store.threads[threadID] }
    private var pendingRequest: PendingServerRequest? { model.store.requests(threadID: threadID).first }
    private var working: Bool { thread?.activeTurnID != nil }
    private var items: [ConversationItem] { (thread?.turns.flatMap(\.items) ?? []) + (thread?.pendingMessages ?? []) }
    private var streamKey: String { "\(items.count)-\(items.last?.text.count ?? 0)-\(working)" }
    var body: some View {
        VStack(spacing: 0) {
            ConnectionHeader().padding(.horizontal).padding(.bottom, 8)
            if let pending = pendingRequest {
                Button { presentedRequest = pending } label: {
                    HStack {
                        Label("request_pending", systemImage: "bell.badge")
                        Spacer()
                        Text("request_review").fontWeight(.semibold)
                    }
                    .font(.callout)
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .padding(.horizontal).padding(.bottom, 8)
            } else if thread?.needsMacAttention == true {
                Label("mac_attention", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.orange).padding(8)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(items) { item in ItemRow(item: item) }
                        if working {
                            HStack { ProgressView(); Text("working").font(.callout).foregroundStyle(.secondary) }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding()
                }
                .onChange(of: streamKey) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            }
            Divider()
            DockView(model: model, threadID: threadID)
            ComposerView(threadID: threadID, working: working, draft: $draft, submitting: $submitting)
        }
        .navigationTitle(thread?.title ?? "OmO")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.ready) { if model.ready { await model.open(threadID) } }
        .sheet(item: $presentedRequest, onDismiss: {
            if let id = pendingRequest?.id { deferredRequestIDs.insert(id) }
        }) { request in
            ApprovalSheet(request: request, related: relatedItem(for: request), cwd: thread?.cwd)
        }
        .onChange(of: pendingRequest?.id, initial: true) { _, id in
            guard let id, let pending = pendingRequest else { presentedRequest = nil; return }
            if !deferredRequestIDs.contains(id) { presentedRequest = pending }
        }
    }
    private func relatedItem(for request: PendingServerRequest) -> ConversationItem? {
        guard let itemID = request.params["itemId"].string else { return nil }
        return thread?.turns.flatMap(\.items).first { $0.id == itemID }
    }
}
