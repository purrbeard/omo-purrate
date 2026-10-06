import Foundation

public enum ThreadPeriod: Equatable, Hashable, Sendable {
    case any
    case today
    case week
    case month
}

public struct ThreadFilter: Sendable {
    public let query: String
    public let runningOnly: Bool
    public let period: ThreadPeriod

    public init(query: String = "", runningOnly: Bool = false, period: ThreadPeriod = .any) {
        self.query = query
        self.runningOnly = runningOnly
        self.period = period
    }

    public func apply(to threads: [ConversationThread], now: Date = .now) -> [ConversationThread] {
        let start: Date? = switch period {
        case .any: nil
        case .today: Calendar.current.startOfDay(for: now)
        case .week: now.addingTimeInterval(-7 * 24 * 60 * 60)
        case .month: now.addingTimeInterval(-30 * 24 * 60 * 60)
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return threads.filter { thread in
            if runningOnly && thread.status != "active" { return false }
            if let start, Date(timeIntervalSince1970: thread.updatedAt) < start { return false }
            return needle.isEmpty || [thread.title, thread.name ?? "", thread.preview]
                .contains { $0.localizedCaseInsensitiveContains(needle) }
        }
    }
}
