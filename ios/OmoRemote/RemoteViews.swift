import SwiftUI
import OmoKit

@MainActor struct RemoteRootView: View {
    @EnvironmentObject private var model: RemoteModel
    @State private var search = ""
    @State private var runningOnly = false
    @State private var period: ThreadPeriod = .any
    @State private var renameThread: ConversationThread?
    @State private var renameValue = ""
    @State private var deleteThread: ConversationThread?
    @State private var path: [String] = []
    @State private var newSession = false
    private var filteredGroups: [WorkspaceGroup] {
        let filter = ThreadFilter(query: search, runningOnly: runningOnly, period: period)
        return model.store.groups(search: search.trimmingCharacters(in: .whitespacesAndNewlines)).compactMap { group in
            let threads = filter.apply(to: group.threads)
            return threads.isEmpty ? nil : WorkspaceGroup(cwd: group.cwd, threads: threads)
        }
    }
    private var runningCount: Int {
        model.store.threads.values.filter { $0.status == "active" }.count
    }
    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if model.macName == nil {
                    ContentUnavailableView {
                        Label("waiting_for_mac", systemImage: "cable.connector")
                    } description: {
                        Text("cable_instructions")
                    } actions: {
                        Button("retry") { model.stop(); model.start() }
                    }
                } else {
                    List {
                        Section { ConnectionHeader() }
                        Section {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    filterButton("filter_running", count: runningCount, active: runningOnly) {
                                        runningOnly.toggle()
                                    }
                                    ForEach([ThreadPeriod.today, .week, .month], id: \.self) { option in
                                        let key: String = switch option {
                                        case .today: "filter_today"
                                        case .week: "filter_week"
                                        case .month: "filter_month"
                                        case .any: "filter_today"
                                        }
                                        Button(LocalizedStringKey(key)) {
                                            period = period == option ? .any : option
                                        }
                                        .buttonStyle(.bordered)
                                        .tint(period == option ? Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255) : nil)
                                    }
                                }
                            }
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        }
                        ForEach(filteredGroups) { group in
                            Section {
                                ForEach(group.threads) { thread in
                                    NavigationLink(value: thread.id) {
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(thread.title).font(.headline).lineLimit(2)
                                            if thread.needsMacAttention {
                                                Label("mac_attention", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.orange)
                                            } else if thread.activeTurnID != nil {
                                                Label("working", systemImage: "ellipsis").font(.caption).foregroundStyle(.secondary)
                                            }
                                            Text(Date(timeIntervalSince1970: thread.updatedAt), style: .relative)
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    .contextMenu {
                                        Button("rename_thread", systemImage: "pencil") {
                                            renameValue = thread.name ?? thread.title
                                            renameThread = thread
                                        }
                                        Button("delete_thread", systemImage: "trash", role: .destructive) {
                                            deleteThread = thread
                                        }
                                    }
                                    .swipeActions {
                                        Button("rename_thread", systemImage: "pencil") {
                                            renameValue = thread.name ?? thread.title
                                            renameThread = thread
                                        }.tint(Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255))
                                        Button("delete_thread", systemImage: "trash", role: .destructive) {
                                            deleteThread = thread
                                        }
                                    }
                                }
                            } header: { Text(group.cwd).textCase(nil) }
                        }
                        if (!search.isEmpty || runningOnly || period != .any) && !model.store.threads.isEmpty && filteredGroups.isEmpty {
                            Section {
                                ContentUnavailableView {
                                    Label("no_matching_sessions", systemImage: "line.3.horizontal.decrease.circle")
                                } actions: {
                                    Button("clear_filters") {
                                        search = ""
                                        runningOnly = false
                                        period = .any
                                    }
                                }
                            }
                        }
                        if model.store.threads.isEmpty {
                            Text(LocalizedStringKey(model.refreshing ? "loading_sessions" : "no_sessions")).foregroundStyle(.secondary)
                        }
                    }
                    .searchable(text: $search, prompt: Text("search_sessions"))
                    .refreshable { await model.refresh() }
                    .confirmationDialog("delete_thread_confirmation", isPresented: Binding(
                        get: { deleteThread != nil },
                        set: { if !$0 { deleteThread = nil } }
                    ), titleVisibility: .visible) {
                        Button("delete_thread", role: .destructive) {
                            if let thread = deleteThread { Task { await model.delete(threadID: thread.id) } }
                            deleteThread = nil
                        }
                        Button("cancel", role: .cancel) { deleteThread = nil }
                    }
                    .alert("rename_thread", isPresented: Binding(
                        get: { renameThread != nil },
                        set: { if !$0 { renameThread = nil } }
                    )) {
                        TextField("thread_name", text: $renameValue)
                        Button("cancel", role: .cancel) { renameThread = nil }
                        Button("save") {
                            if let thread = renameThread {
                                let name = renameValue.trimmingCharacters(in: .whitespacesAndNewlines)
                                if !name.isEmpty { Task { await model.rename(threadID: thread.id, name: name) } }
                            }
                            renameThread = nil
                        }
                    }
                }
            }
            .navigationTitle("OmO")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { newSession = true } label: { Label("new_session", systemImage: "square.and.pencil") }
                        .disabled(!model.ready)
                }
            }
            .navigationDestination(for: String.self) { id in ConversationView(threadID: id) }
            .sheet(isPresented: $newSession) {
                NewSessionSheet { id in newSession = false; path.append(id) }
            }
            .alert("error_title", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                Button("ok", role: .cancel) { model.errorMessage = nil }
            } message: { Text(model.errorMessage ?? "") }
            .onChange(of: model.macName) { _, name in if name == nil { path = []; newSession = false } }
        }
    }

    private func filterButton(_ title: LocalizedStringKey, count: Int, active: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
        } label: {
            HStack(spacing: 5) {
                Text(title)
                Text("\(count)").font(.caption.monospacedDigit())
            }
        }
        .buttonStyle(.bordered)
        .tint(active ? Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255) : nil)
    }
}
