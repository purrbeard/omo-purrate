import SwiftUI

enum MarkdownBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case list([MarkdownListItem])
    case code(language: String?, text: String)
    case quote(String)
    case rule
}

struct MarkdownListItem: Equatable {
    var depth: Int
    var ordinal: Int?
    var text: String
}

/// Line-oriented block parser: fenced code, headings, lists, quotes, rules; everything else is an inline-markdown paragraph.
enum MarkdownParser {
    private struct Fence {
        let marker: Character
        let length: Int
        let language: String?
    }

    static func blocks(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var list: [MarkdownListItem] = []
        var quote: [String] = []
        func flushParagraph() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] }
        }
        func flushList() {
            if !list.isEmpty { blocks.append(.list(list)); list = [] }
        }
        func flushQuote() {
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))); quote = [] }
        }
        func flushAll() { flushParagraph(); flushList(); flushQuote() }

        var index = 0
        while index < lines.count {
            let line = lines[index]
            if let fence = fenceOpening(line), let close = closingFence(in: lines, from: index + 1, matching: fence) {
                flushAll()
                blocks.append(.code(language: fence.language, text: lines[(index + 1)..<close].joined(separator: "\n")))
                index = close + 1
                continue
            }
            // An unterminated fence line falls through and renders as ordinary text.
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushAll()
            } else if let heading = heading(trimmed) {
                flushAll()
                blocks.append(.heading(level: heading.level, text: heading.text))
            } else if isRule(trimmed) {
                flushAll()
                blocks.append(.rule)
            } else if let item = listItem(line) {
                flushParagraph(); flushQuote()
                list.append(item)
            } else if trimmed.hasPrefix(">") {
                flushParagraph(); flushList()
                quote.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
            } else if !list.isEmpty, line.first?.isWhitespace == true {
                // Indented continuation of the previous list item.
                list[list.count - 1].text += " " + trimmed
            } else {
                flushList(); flushQuote()
                paragraph.append(line)
            }
            index += 1
        }
        flushAll()
        return blocks
    }

    /// Inline markdown (emphasis, code spans, links) for one block's text; falls back to the literal text when parsing fails.
    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    /// A line opening a fence: three or more backticks or tildes, optionally followed by an info string whose first word is the language.
    private static func fenceOpening(_ line: String) -> Fence? {
        let trimmed = line.drop(while: { $0 == " " })
        guard let marker = trimmed.first, marker == "`" || marker == "~" else { return nil }
        let run = trimmed.prefix(while: { $0 == marker })
        guard run.count >= 3 else { return nil }
        let info = trimmed.dropFirst(run.count).trimmingCharacters(in: .whitespaces)
        // A backtick fence's info string may not contain backticks; that line is a code span, not a fence.
        if marker == "`", info.contains("`") { return nil }
        let language = info.split(separator: " ").first.map(String.init)
        return Fence(marker: marker, length: run.count, language: language)
    }

    /// The index of the first line at or after `start` that closes `fence`: only the same marker, at least as long, nothing else.
    private static func closingFence(in lines: [String], from start: Int, matching fence: Fence) -> Int? {
        var index = start
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            if trimmed.count >= fence.length, trimmed.allSatisfy({ $0 == fence.marker }) { return index }
            index += 1
        }
        return nil
    }

    private static func heading(_ trimmed: String) -> (level: Int, text: String)? {
        let hashes = trimmed.prefix(while: { $0 == "#" })
        guard (1...6).contains(hashes.count) else { return nil }
        let rest = trimmed.dropFirst(hashes.count)
        guard rest.first == " " else { return nil }
        let text = rest.trimmingCharacters(in: .whitespaces)
        let withoutClosing = text.reversed().drop(while: { $0 == "#" }).reversed()
        return (hashes.count, String(withoutClosing).trimmingCharacters(in: .whitespaces))
    }

    private static func isRule(_ trimmed: String) -> Bool {
        guard let marker = trimmed.first, marker == "-" || marker == "*" || marker == "_" else { return false }
        let compact = trimmed.filter { $0 != " " }
        return compact.count >= 3 && compact.allSatisfy { $0 == marker }
    }

    private static func listItem(_ line: String) -> MarkdownListItem? {
        let indent = line.prefix(while: { $0 == " " || $0 == "\t" })
        let depth = indent.reduce(0) { $0 + ($1 == "\t" ? 2 : 1) } / 2
        let rest = line.dropFirst(indent.count)
        guard let first = rest.first else { return nil }
        if first == "-" || first == "*" || first == "+" {
            let after = rest.dropFirst()
            guard after.first == " " || after.first == "\t" else { return nil }
            return MarkdownListItem(depth: depth, ordinal: nil, text: after.trimmingCharacters(in: .whitespaces))
        }
        let digits = rest.prefix(while: \.isNumber)
        guard !digits.isEmpty, digits.count <= 9, let ordinal = Int(digits) else { return nil }
        let afterDigits = rest.dropFirst(digits.count)
        guard let delimiter = afterDigits.first, delimiter == "." || delimiter == ")" else { return nil }
        let after = afterDigits.dropFirst()
        guard after.first == " " || after.first == "\t" else { return nil }
        return MarkdownListItem(depth: depth, ordinal: ordinal, text: after.trimmingCharacters(in: .whitespaces))
    }
}

@MainActor struct MarkdownText: View {
    let text: String
    private var blocks: [MarkdownBlock] { MarkdownParser.blocks(text) }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@MainActor private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    var body: some View {
        switch block {
        case .paragraph(let text):
            Text(MarkdownParser.inline(text)).textSelection(.enabled)
        case let .heading(level, text):
            Text(MarkdownParser.inline(text)).font(headingFont(level)).textSelection(.enabled).padding(.top, 4)
        case .list(let items):
            MarkdownListView(items: items)
        case let .code(language, text):
            CodeBlockView(language: language, code: text)
        case .quote(let text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1).fill(Color.accentColor).frame(width: 3)
                Text(MarkdownParser.inline(text)).foregroundStyle(.secondary).textSelection(.enabled)
            }
        case .rule:
            Divider()
        }
    }
    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .title3.weight(.bold)
        case 2: return .headline
        default: return .subheadline.weight(.semibold)
        }
    }
}

@MainActor private struct MarkdownListView: View {
    let items: [MarkdownListItem]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.ordinal.map { "\($0)." } ?? "•")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 16, alignment: .trailing)
                    Text(MarkdownParser.inline(item.text)).textSelection(.enabled)
                }
                .padding(.leading, CGFloat(item.depth) * 16)
            }
        }
    }
}

@MainActor private struct CodeBlockView: View {
    let language: String?
    let code: String
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                if let language { Text(language) } else { Text("code") }
                Spacer(minLength: 0)
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                } label: {
                    Label(LocalizedStringKey(copied ? "copied" : "copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.borderless)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 6)
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}
