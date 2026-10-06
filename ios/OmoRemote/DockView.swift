import SwiftUI
import OmoKit

/// The stack above the composer for one thread: the collapsible todo list, then the goal strip; nothing when the thread has neither.
@MainActor struct DockView: View {
    @ObservedObject private var model: RemoteModel
    let threadID: String
    @State private var open = false
    init(model: RemoteModel, threadID: String) {
        _model = ObservedObject(wrappedValue: model)
        self.threadID = threadID
    }
    private var goal: ThreadGoal? { model.store.goals[threadID] }
    private var phases: [TodoPhase] { model.store.todos[threadID] ?? [] }
    private var live: Bool { model.ready && model.store.threads[threadID]?.activeTurnID != nil }
    var body: some View {
        let counts = TodoCounts(phases)
        if counts.total > 0 || goal != nil {
            VStack(spacing: 8) {
                if counts.total > 0 { todoCard(counts) }
                if let goal { GoalStrip(goal: goal) }
            }
        }
    }
    private func todoCard(_ counts: TodoCounts) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 10) {
                    Image(systemName: "checklist").foregroundStyle(Color.accentColor)
                    Text("todo_title").font(.caption.weight(.semibold))
                    Text("todo_progress \(counts.done) \(counts.total)").font(.caption).foregroundStyle(.secondary)
                    if counts.abandoned > 0 {
                        Text("todo_abandoned \(counts.abandoned)").font(.caption).foregroundStyle(.secondary)
                    }
                    if !open, let current = counts.current {
                        Text(current).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: open ? "chevron.down" : "chevron.up").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LocalizedStringKey(open ? "todo_collapse" : "todo_expand"))
            if open {
                Divider().padding(.top, 10)
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(phases.enumerated()), id: \.offset) { _, phase in
                        phaseView(phase)
                    }
                }
                .padding(.top, 10)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
    private func phaseView(_ phase: TodoPhase) -> some View {
        let counts = TodoCounts([phase])
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(phase.name).font(.caption.weight(.semibold))
                Spacer(minLength: 0)
                Text(verbatim: "\(counts.done)/\(counts.total)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            ForEach(Array(phase.tasks.enumerated()), id: \.offset) { _, task in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    TodoDot(status: task.status, live: live)
                    Text(task.content)
                        .font(.callout)
                        .strikethrough(task.status == "abandoned")
                        .foregroundStyle(task.status == "pending" || task.status == "abandoned" ? .secondary : .primary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(LocalizedStringKey("todo_status_" + task.status))
            }
        }
    }
}

/// Counts in the Mac dock's shape: completed, in_progress and pending are named; any other status is abandoned.
private struct TodoCounts {
    var done = 0
    var total = 0
    var abandoned = 0
    /// The task in progress, else the first pending one, for the collapsed header.
    var current: String?
    init(_ phases: [TodoPhase]) {
        var firstPending: String?
        for task in phases.flatMap(\.tasks) {
            total += 1
            switch task.status {
            case "completed": done += 1
            case "in_progress": if current == nil { current = task.content }
            case "pending": if firstPending == nil { firstPending = task.content }
            default: abandoned += 1
            }
        }
        if current == nil { current = firstPending }
    }
}

private struct TodoDot: View {
    let status: String
    let live: Bool
    var body: some View {
        Group {
            switch status {
            case "completed": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case "in_progress": Image(systemName: "circle.inset.filled").foregroundStyle(Color.accentColor).symbolEffect(.pulse, isActive: live)
            default: Image(systemName: "circle").foregroundStyle(.secondary)
            }
        }
        .font(.caption)
        .accessibilityHidden(true)
    }
}

private struct GoalStrip: View {
    let goal: ThreadGoal
    private static let knownStatuses: Set<String> = ["active", "paused", "blocked", "complete"]
    private var tint: Color {
        switch goal.status {
        case "complete": return .green
        case "blocked": return .orange
        case "paused": return .secondary
        default: return .accentColor
        }
    }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "target").foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 4) {
                if Self.knownStatuses.contains(goal.status) {
                    Text(LocalizedStringKey("goal_status_" + goal.status)).font(.caption.weight(.semibold)).foregroundStyle(tint)
                } else {
                    Text(goal.status).font(.caption.weight(.semibold)).foregroundStyle(tint)
                }
                Text(goal.objective).font(.callout).lineLimit(3)
            }
            Spacer(minLength: 0)
            DurationText(seconds: Int(goal.timeUsedSeconds.isFinite ? max(0, goal.timeUsedSeconds).rounded() : 0))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

/// Whole seconds as the Mac formats them: "42s" under a minute, else "3m 5s".
private struct DurationText: View {
    let seconds: Int
    var body: some View {
        if seconds < 60 { Text("duration_s \(seconds)") }
        else { Text("duration_m \(seconds / 60) \(seconds % 60)") }
    }
}
