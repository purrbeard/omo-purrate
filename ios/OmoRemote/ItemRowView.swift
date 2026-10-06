import SwiftUI
import OmoKit

@MainActor struct ItemRow: View {
    let item: ConversationItem
    private var isText: Bool { ["agentMessage", "userMessage", "plan", "reasoning"].contains(item.type) }
    var body: some View {
        if isText {
            VStack(alignment: .leading, spacing: 5) {
                Text(LocalizedStringKey("item_" + item.type)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if item.type == "userMessage" { Text(item.text).textSelection(.enabled) }
                else { MarkdownText(text: item.text) }
                if item.status == "pending" { Text("sending").font(.caption).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(item.type == "userMessage" ? 12 : 0)
            .background(item.type == "userMessage" ? Color.accentColor.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 12))
        } else {
            ToolRow(item: item)
        }
    }
}

@MainActor private struct ToolRow: View {
    let item: ConversationItem
    private var presentation: ToolPresentation { ToolPresentation(item) }
    var body: some View {
        let tool = presentation
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: tool.icon).foregroundStyle(Color.accentColor).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(LocalizedStringKey(tool.titleKey)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if !tool.target.isEmpty {
                    Text(tool.target)
                        .font(.system(.callout, design: tool.monospaced ? .monospaced : .default))
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            status
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
    @ViewBuilder private var status: some View {
        switch item.status {
        case "inProgress":
            ProgressView().controlSize(.small).accessibilityLabel(Text("status_inProgress"))
        case "failed", "declined":
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red).accessibilityLabel(Text("status_failed"))
        default:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel(Text("status_completed"))
        }
    }
}

/// Keep `knownTools` in step with KNOWN_TOOLS in src/ui/conversation/tool-model.ts; the dynamic tool name picks the kind.
private struct ToolPresentation {
    let icon: String
    let titleKey: String
    let target: String
    let monospaced: Bool
    private static let knownTools: [String: (icon: String, titleKey: String)] = [
        "eval": ("chevron.left.forwardslash.chevron.right", "tool_code"),
        "edit": ("pencil.line", "tool_fileEdit"),
        "write": ("square.and.pencil", "tool_fileEdit"),
        "read": ("doc.text", "tool_read"),
        "task": ("person.2", "tool_task"),
        "todo": ("checklist", "tool_todo"),
        "todo_write": ("checklist", "tool_todo"),
        "ask_user_question": ("questionmark.circle", "tool_question"),
        "web_search": ("globe", "item_webSearch"),
        "websearch": ("globe", "item_webSearch"),
        "webfetch": ("arrow.down.doc", "tool_webFetch"),
        "web_fetch": ("arrow.down.doc", "tool_webFetch"),
        "grep": ("magnifyingglass", "tool_search"),
        "glob": ("magnifyingglass", "tool_search"),
    ]
    init(_ item: ConversationItem) {
        switch item.type {
        case "commandExecution":
            icon = "terminal"; titleKey = "item_commandExecution"; monospaced = true
            target = Self.firstLine(item.text)
        case "fileChange":
            icon = "pencil.line"; titleKey = "item_fileChange"; monospaced = true
            target = item.text.split(separator: "\n").joined(separator: ", ")
        case "dynamicToolCall":
            let known = Self.knownTools[item.text]
            icon = known?.icon ?? "wrench.and.screwdriver"
            titleKey = known?.titleKey ?? "item_dynamicToolCall"
            target = item.text; monospaced = true
        case "mcpToolCall":
            icon = "puzzlepiece.extension"; titleKey = "item_mcpToolCall"; target = item.text; monospaced = true
        case "webSearch":
            icon = "globe"; titleKey = "item_webSearch"; target = Self.firstLine(item.text); monospaced = false
        case "contextCompaction":
            icon = "arrow.triangle.2.circlepath"; titleKey = "item_contextCompaction"; target = ""; monospaced = false
        default:
            icon = "circle.dashed"; titleKey = "item_" + item.type; monospaced = false
            target = item.text == item.type ? "" : Self.firstLine(item.text)
        }
    }
    private static func firstLine(_ text: String) -> String {
        String(text.prefix(while: { $0 != "\n" })).trimmingCharacters(in: .whitespaces)
    }
}
