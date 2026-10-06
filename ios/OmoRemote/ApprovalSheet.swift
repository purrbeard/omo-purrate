import SwiftUI
import OmoKit

/// Answers one pending server request from the phone: a command or file-change approval
/// (src/ui/conversation/ApprovalCard.tsx) or omo's questions (src/ui/conversation/QuestionCard.tsx).
/// Answering sends the serverAnswer through `RemoteModel.answer`; ConversationView closes the sheet once the
/// request leaves the store. "Later" closes it without answering, so the request stays pending.
@MainActor struct ApprovalSheet: View {
    let request: PendingServerRequest
    /// The thread item the request refers to (params.itemId): file-change paths and the command fallback.
    let related: ConversationItem?
    /// The thread's workspace, stripped from changed paths.
    let cwd: String?
    @EnvironmentObject private var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    private var isQuestion: Bool { request.method == "item/tool/requestUserInput" }
    var body: some View {
        NavigationStack {
            Group {
                if isQuestion { QuestionForm(request: request, busy: busy) { answer($0) } }
                else { ApprovalForm(request: request, related: related, cwd: cwd, busy: busy) { answer($0) } }
            }
            .navigationTitle(LocalizedStringKey(isQuestion ? "question_title" : "approval_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("later") { dismiss() }.disabled(busy) } }
        }
        .interactiveDismissDisabled(busy)
    }
    private func answer(_ result: JSONValue) {
        guard !busy, model.ready else { return }
        busy = true
        Task {
            await model.answer(requestID: request.requestID, result: result)
            busy = false
        }
    }
}

/// Command or file-change approval: what omo wants to do, why, and the offered decisions.
@MainActor private struct ApprovalForm: View {
    let request: PendingServerRequest
    let related: ConversationItem?
    let cwd: String?
    let busy: Bool
    let submit: @MainActor (JSONValue) -> Void
    @EnvironmentObject private var model: RemoteModel
    @State private var note = ""
    private var isCommand: Bool { request.method == "item/commandExecution/requestApproval" }
    private var command: String? {
        guard isCommand else { return nil }
        let text = request.params["command"].string ?? related?.text ?? ""
        return text.isEmpty ? nil : text
    }
    private var changedPaths: [String] {
        guard !isCommand, let related, related.type == "fileChange" else { return [] }
        return related.text.split(separator: "\n").map { displayPath(String($0)) }
    }
    private var workingDirectory: String? { isCommand ? request.params["cwd"].string : nil }
    private var grantRoot: String? { isCommand ? nil : request.params["grantRoot"].string }
    private var reason: String { (request.params["reason"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    /// The command request may narrow the decisions; a file-change request offers all of them.
    private var decisions: [String] {
        let offered = isCommand ? request.params["availableDecisions"].array.compactMap(\.string) : []
        return offered.isEmpty ? ["accept", "acceptForSession", "decline", "cancel"] : offered
    }
    private func offers(_ decision: String) -> Bool { decisions.contains(decision) }
    private func displayPath(_ path: String) -> String {
        guard let cwd, !cwd.isEmpty, path.hasPrefix(cwd + "/") else { return path }
        return String(path.dropFirst(cwd.count + 1))
    }
    private func answer(_ decision: String) {
        var result: [String: JSONValue] = ["decision": .string(decision)]
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if decision == "decline", !trimmed.isEmpty { result["reason"] = .string(trimmed) }
        submit(.object(result))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(LocalizedStringKey(isCommand ? "approval_command" : "approval_file_change")).font(.headline)
                if let command {
                    Text(command)
                        .font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                if !changedPaths.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(changedPaths, id: \.self) { path in
                            Label { Text(path).font(.system(.callout, design: .monospaced)).textSelection(.enabled) }
                                icon: { Image(systemName: "doc.text").foregroundStyle(.secondary) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                if let workingDirectory { detail("approval_cwd", workingDirectory, monospaced: true) }
                if let grantRoot { detail("approval_grant_root", grantRoot, monospaced: true) }
                if !reason.isEmpty { detail("approval_reason", reason, monospaced: false) }
                if offers("decline") {
                    TextField("approval_decline_reason", text: $note, axis: .vertical)
                        .lineLimit(1...4).padding(10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        .disabled(busy)
                }
            }
            .padding()
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if offers("accept") {
                    Button { answer("accept") } label: { actionLabel("approval_accept") }
                        .buttonStyle(.borderedProminent)
                }
                if offers("acceptForSession") {
                    Button { answer("acceptForSession") } label: { actionLabel("approval_accept_session") }
                        .buttonStyle(.bordered)
                }
                if offers("decline") {
                    Button(role: .destructive) { answer("decline") } label: { actionLabel("approval_decline") }
                        .buttonStyle(.bordered)
                }
            }
            .controlSize(.large)
            .disabled(busy || !model.ready)
            .padding()
            .background(.bar)
        }
    }
    private func detail(_ title: LocalizedStringKey, _ value: String, monospaced: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(monospaced ? .system(.callout, design: .monospaced) : .callout).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func actionLabel(_ key: LocalizedStringKey) -> some View {
        Group {
            if busy { ProgressView() } else { Text(key).fontWeight(.semibold) }
        }
        .frame(maxWidth: .infinity)
    }
}

/// One item/tool/requestUserInput question (UserInputQuestion in shared/protocol.ts).
private struct UserQuestion: Identifiable {
    struct Option: Identifiable {
        let label: String
        let description: String
        var id: String { label }
    }
    let id: String
    let header: String
    let question: String
    let options: [Option]
    let multiSelect: Bool
    let isSecret: Bool
    /// Whether the question accepts typed text: declared isOther, or no options to pick from.
    let freeText: Bool
    init?(_ json: JSONValue) {
        guard let id = json["id"].string, let question = json["question"].string else { return nil }
        self.id = id
        self.question = question
        header = (json["header"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        options = json["options"].array.compactMap { option in
            guard let label = option["label"].string else { return nil }
            return Option(label: label, description: (option["description"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        }
        multiSelect = Self.flag(json["multiSelect"])
        isSecret = Self.flag(json["isSecret"])
        freeText = Self.flag(json["isOther"]) || options.isEmpty
    }
    private static func flag(_ value: JSONValue) -> Bool { if case .bool(let flag) = value { return flag }; return false }
}

/// The selected option labels plus free text for one question; the wire answer appends the text last.
private struct AnswerDraft {
    var selected: [String] = []
    var other = ""
    static let empty = AnswerDraft()
    var answered: Bool { !selected.isEmpty || !other.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var wire: [String] {
        let text = other.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? selected : selected + [text]
    }
}

/// Every question at once; Submit sends each question's selected labels plus its free text.
@MainActor private struct QuestionForm: View {
    let request: PendingServerRequest
    let busy: Bool
    let submit: @MainActor (JSONValue) -> Void
    @EnvironmentObject private var model: RemoteModel
    @State private var drafts: [String: AnswerDraft] = [:]
    private var questions: [UserQuestion] { request.params["questions"].array.compactMap(UserQuestion.init) }
    private var complete: Bool { !questions.isEmpty && questions.allSatisfy { drafts[$0.id, default: .empty].answered } }
    private func choose(_ question: UserQuestion, _ label: String) {
        var draft = drafts[question.id, default: .empty]
        if question.multiSelect {
            if let index = draft.selected.firstIndex(of: label) { draft.selected.remove(at: index) } else { draft.selected.append(label) }
        } else {
            draft = AnswerDraft(selected: [label], other: "")
        }
        drafts[question.id] = draft
    }
    private func otherBinding(_ question: UserQuestion) -> Binding<String> {
        Binding(
            get: { drafts[question.id, default: .empty].other },
            set: { value in
                var draft = drafts[question.id, default: .empty]
                draft.other = value
                if !question.multiSelect { draft.selected = [] }
                drafts[question.id] = draft
            })
    }
    private func send() {
        guard complete else { return }
        let answers = questions.map { question -> (String, JSONValue) in
            (question.id, .object(["answers": .array(drafts[question.id, default: .empty].wire.map(JSONValue.string))]))
        }
        submit(.object(["answers": .object(Dictionary(answers, uniquingKeysWith: { _, last in last }))]))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(questions) { question in
                    QuestionBlock(question: question, draft: drafts[question.id, default: .empty], other: otherBinding(question), busy: busy) { label in
                        choose(question, label)
                    }
                }
            }
            .padding()
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                if !complete, questions.count > 1 {
                    Text("question_incomplete").font(.caption).foregroundStyle(.secondary)
                }
                Button { send() } label: {
                    Group {
                        if busy { ProgressView() } else { Text("question_submit").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy || !complete || !model.ready)
            }
            .padding()
            .background(.bar)
        }
    }
}

/// One question: eyebrow header, the question, its options, and the free-text field when offered.
@MainActor private struct QuestionBlock: View {
    let question: UserQuestion
    let draft: AnswerDraft
    @Binding var other: String
    let busy: Bool
    let choose: @MainActor (String) -> Void
    private var typing: Bool { !other.isEmpty }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !question.header.isEmpty {
                Text(question.header).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            }
            Text(question.question).font(.headline)
            ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                let selected = draft.selected.contains(option.label)
                Button { choose(option.label) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        indicator(selected: selected, number: index + 1)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.label).font(.body).foregroundStyle(.primary)
                            if !option.description.isEmpty {
                                Text(option.description).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(selected ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
            if question.freeText {
                HStack(alignment: .top, spacing: 12) {
                    if !question.options.isEmpty {
                        indicator(selected: typing, number: nil).padding(.top, 10)
                    }
                    Group {
                        if question.isSecret { SecureField("question_secret_placeholder", text: $other) }
                        else { TextField("question_other_placeholder", text: $other, axis: .vertical).lineLimit(1...5) }
                    }
                    .padding(10)
                    .background(typing ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .disabled(busy)
                    .accessibilityLabel(Text("question_other"))
                }
            }
        }
    }
    /// Checkbox for multi-select, a numbered circle for single-select, a pencil for the free-text row.
    private func indicator(selected: Bool, number: Int?) -> some View {
        ZStack {
            if question.multiSelect {
                RoundedRectangle(cornerRadius: 5)
                    .fill(selected ? Color.accentColor : Color.clear)
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(selected ? Color.accentColor : Color.secondary.opacity(0.5), lineWidth: 1.5))
                if selected { Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.white) }
            } else {
                Circle()
                    .fill(selected ? Color.accentColor : Color.secondary.opacity(0.12))
                if let number {
                    Text(String(number)).font(.caption.weight(.semibold)).foregroundStyle(selected ? .white : .secondary)
                } else {
                    Image(systemName: "pencil").font(.caption.weight(.semibold)).foregroundStyle(selected ? .white : .secondary)
                }
            }
        }
        .frame(width: 22, height: 22)
    }
}
