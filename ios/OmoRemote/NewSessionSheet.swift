import SwiftUI
import OmoKit

@MainActor struct NewSessionSheet: View {
    let onCreated: (String) -> Void
    @EnvironmentObject private var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var selected = ""
    @State private var creating = false
    var body: some View {
        NavigationStack {
            Form {
                Section("workspace") {
                    ForEach(model.store.recentWorkspaces, id: \.self) { cwd in
                        Button { selected = cwd } label: {
                            HStack { Text(cwd).foregroundStyle(.primary); Spacer(); if selected == cwd { Image(systemName: "checkmark") } }
                        }
                    }
                    if model.store.recentWorkspaces.isEmpty { Text("no_workspaces").foregroundStyle(.secondary) }
                }
                Section {
                    Button {
                        creating = true
                        Task {
                            if let id = await model.create(cwd: selected) { onCreated(id) }
                            creating = false
                        }
                    } label: { if creating { ProgressView() } else { Text("create_session") } }
                    .disabled(selected.isEmpty || creating || !model.ready)
                }
            }
            .navigationTitle("new_session")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() }.disabled(creating) } }
            .onAppear { selected = model.store.recentWorkspaces.first ?? "" }
        }
    }
}
