import SwiftUI
import OmoKit

/// The message composer: draft field, model/effort chip, "/" skills chip, and the Stop / Send (Steer) controls.
/// Model and effort travel on turn/start through `RemoteModel.select(model:effort:)`; a picked skill is inserted
/// into the draft as `/name ` because omo accepts skills only as text.
@MainActor struct ComposerView: View {
    let threadID: String
    let working: Bool
    @Binding var draft: String
    @Binding var submitting: Bool
    @EnvironmentObject private var model: RemoteModel
    @State private var modelPickerPresented = false
    @State private var skillPickerPresented = false
    @State private var skillQuery = ""
    private var cwd: String? { model.store.threads[threadID]?.cwd }
    private var selectedModel: ModelOption? {
        guard let id = model.store.selectedModel else { return nil }
        return model.store.models.first { $0.id == id }
    }
    private var modelChipTitle: String {
        guard let selected = selectedModel else { return String(localized: "model_default") }
        guard let effort = model.store.selectedEffort else { return selected.displayName }
        return selected.displayName + " · " + effortTitle(effort)
    }
    var body: some View {
        VStack(spacing: 10) {
            TextField("message_placeholder", text: $draft, axis: .vertical)
                .lineLimit(1...7).padding(10)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .disabled(submitting)
            HStack(spacing: 8) {
                Button { skillQuery = ""; skillPickerPresented = true } label: {
                    ComposerChip { Text(verbatim: "/").font(.system(.caption, design: .monospaced).weight(.bold)) }
                }
                .accessibilityLabel(Text("skills"))
                .disabled(!model.ready || submitting)
                Button { modelPickerPresented = true } label: {
                    ComposerChip {
                        Image(systemName: "cpu")
                        Text(modelChipTitle).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.caption2)
                    }
                }
                .accessibilityLabel(Text("model_title"))
                .accessibilityValue(Text(modelChipTitle))
                .disabled(!model.ready || submitting)
                Spacer(minLength: 8)
                if working {
                    Button(role: .destructive) { Task { await model.interrupt(threadID) } } label: {
                        Label("stop", systemImage: "stop.fill")
                    }.disabled(!model.ready)
                }
                Button {
                    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    submitting = true
                    Task {
                        if await model.send(threadID: threadID, text: text) { draft = "" }
                        submitting = false
                    }
                } label: {
                    if submitting { ProgressView() }
                    else { Label(LocalizedStringKey(working ? "steer" : "send"), systemImage: "arrow.up") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.ready || submitting || model.busyThreads.contains(threadID) || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding()
        .onChange(of: draft) { previous, current in
            // Typing "/" as the first token opens the skills list, like the Mac composer; dismissing it and
            // continuing the token does not reopen it.
            guard let query = leadingSkillQuery(current), !previous.hasPrefix("/") else { return }
            skillQuery = query
            skillPickerPresented = true
        }
        .sheet(isPresented: $modelPickerPresented) {
            ModelPickerSheet().presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $skillPickerPresented) {
            SkillPickerSheet(cwd: cwd, initialQuery: skillQuery) { insertSkill($0) }
                .presentationDetents([.medium, .large])
        }
    }
    /// The text after "/" when the whole draft is one leading `/query` token; nil otherwise.
    private func leadingSkillQuery(_ text: String) -> String? {
        guard text.range(of: #"^/[A-Za-z0-9:_-]*$"#, options: .regularExpression) != nil else { return nil }
        return String(text.dropFirst())
    }
    /// Replaces a leading `/query` token with `/name `, or prepends it so the skill run leads the message.
    private func insertSkill(_ name: String) {
        let token = "/" + name + " "
        if let range = draft.range(of: #"^/[A-Za-z0-9:_-]*"#, options: .regularExpression) {
            var rest = String(draft[range.upperBound...])
            if rest.hasPrefix(" ") { rest.removeFirst() }
            draft = token + rest
        } else {
            draft = token + draft
        }
    }
}

private let knownEfforts: Set<String> = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

/// The localized effort name for the efforts the Mac composer names; any other effort id is shown as sent.
private func effortTitle(_ effort: String) -> String {
    knownEfforts.contains(effort) ? String(localized: String.LocalizationValue("effort_" + effort)) : effort
}

/// The capsule used by the composer's picker chips; matches the connection header pill (caption, 9/5 padding).
private struct ComposerChip<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        HStack(spacing: 4) { content }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Color.accentColor.opacity(0.15), in: Capsule())
    }
}

private struct EffortChip: View {
    let title: String
    let selected: Bool
    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(selected ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.08), in: Capsule())
    }
}

private struct ModelGroup: Identifiable {
    var id: String { provider }
    let provider: String
    let models: [ModelOption]
}

/// Lists the visible models grouped by provider prefix with the efforts each supports, like the Mac ModelPicker.
@MainActor private struct ModelPickerSheet: View {
    @EnvironmentObject private var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    private var visible: [ModelOption] { model.store.models.filter { !$0.hidden } }
    private var groups: [ModelGroup] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let matching = visible.filter { trimmed.isEmpty || $0.displayName.localizedCaseInsensitiveContains(trimmed) || $0.id.localizedCaseInsensitiveContains(trimmed) }
        var order: [String] = []
        var byProvider: [String: [ModelOption]] = [:]
        for option in matching {
            let provider = option.id.split(separator: "/", maxSplits: 1).first.map(String.init) ?? option.id
            if byProvider[provider] == nil { order.append(provider) }
            byProvider[provider, default: []].append(option)
        }
        return order.map { ModelGroup(provider: $0, models: byProvider[$0] ?? []) }
    }
    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Section {
                        Button { model.select(model: nil, effort: nil); dismiss() } label: {
                            HStack {
                                Text("model_default").foregroundStyle(.primary)
                                Spacer()
                                if model.store.selectedModel == nil { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
                            }
                        }
                    }
                }
                ForEach(groups) { group in
                    Section {
                        ForEach(group.models) { option in
                            ModelRow(option: option, selected: model.store.selectedModel == option.id, currentEffort: model.store.selectedEffort) { effort in
                                model.select(model: option.id, effort: effort)
                                dismiss()
                            }
                        }
                    } header: { Text(group.provider).textCase(nil) }
                }
                if visible.isEmpty {
                    Section {
                        if let error = model.modelsError {
                            Text("models_error").foregroundStyle(.secondary)
                            Text(error).font(.caption).foregroundStyle(.secondary)
                            Button("retry") { Task { await model.loadModels() } }.disabled(!model.ready)
                        } else {
                            Text("models_empty").foregroundStyle(.secondary)
                        }
                    }
                } else if groups.isEmpty {
                    Text("models_no_match").foregroundStyle(.secondary)
                }
            }
            .searchable(text: $query, prompt: Text("search_models"))
            .navigationTitle("model_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } } }
        }
    }
}

/// Tapping the row keeps the current effort when the model supports it, else sends the model's default.
private struct ModelRow: View {
    let option: ModelOption
    let selected: Bool
    let currentEffort: String?
    /// Receives the effort to send with the model, nil when the model lists none.
    let choose: (String?) -> Void
    private var resolvedEffort: String? {
        if let effort = currentEffort, option.efforts.contains(effort) { return effort }
        return option.defaultEffort ?? option.efforts.first
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(option.displayName).foregroundStyle(.primary)
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
            if option.id != option.displayName {
                Text(option.id).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if !option.efforts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(option.efforts, id: \.self) { effort in
                            Button { choose(effort) } label: {
                                EffortChip(title: effortTitle(effort), selected: selected && currentEffort == effort)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { choose(option.efforts.isEmpty ? nil : resolvedEffort) }
    }
}

/// Lists the workspace's skills; a tap hands the name back so the composer inserts `/name ` into the draft.
@MainActor private struct SkillPickerSheet: View {
    let cwd: String?
    let onPick: (String) -> Void
    @EnvironmentObject private var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var query: String
    @State private var loading = false
    init(cwd: String?, initialQuery: String, onPick: @escaping (String) -> Void) {
        self.cwd = cwd; self.onPick = onPick
        _query = State(initialValue: initialQuery)
    }
    private var skills: [SkillOption] { cwd.map { model.store.skills(cwd: $0) } ?? [] }
    private var filtered: [SkillOption] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let bare = trimmed.lowercased().hasPrefix("skill:") ? String(trimmed.dropFirst("skill:".count)) : trimmed
        guard !bare.isEmpty else { return skills }
        let prefixed = skills.filter { $0.name.lowercased().hasPrefix(bare.lowercased()) }
        let contained = skills.filter { skill in
            !prefixed.contains(where: { $0.name == skill.name }) && (skill.name.localizedCaseInsensitiveContains(bare) || skill.description.localizedCaseInsensitiveContains(bare))
        }
        return prefixed + contained
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(filtered) { skill in
                        Button { onPick(skill.name); dismiss() } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Text(verbatim: "/" + skill.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                                    if !skill.enabled {
                                        Text("skills_user_only")
                                            .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                                            .padding(.horizontal, 5).padding(.vertical, 2)
                                            .background(Color.secondary.opacity(0.08), in: Capsule())
                                    }
                                }
                                if !skill.description.isEmpty {
                                    Text(skill.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                    }
                    if filtered.isEmpty {
                        if loading {
                            HStack { ProgressView(); Text("skills_loading").foregroundStyle(.secondary) }
                        } else if skills.isEmpty, let error = model.skillsError {
                            Text("skills_error").foregroundStyle(.secondary)
                            Text(error).font(.caption).foregroundStyle(.secondary)
                            Button("retry") { Task { await reload() } }.disabled(!model.ready || cwd == nil)
                        } else {
                            Text(LocalizedStringKey(skills.isEmpty ? "skills_empty" : "skills_no_match")).foregroundStyle(.secondary)
                        }
                    }
                } footer: { Text("skills_footer") }
            }
            .searchable(text: $query, prompt: Text("search_skills"))
            .navigationTitle("skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } } }
            .task { if skills.isEmpty { await reload() } }
        }
    }
    private func reload() async {
        guard let cwd, model.ready else { return }
        loading = true
        await model.loadSkills(cwd: cwd)
        loading = false
    }
}
