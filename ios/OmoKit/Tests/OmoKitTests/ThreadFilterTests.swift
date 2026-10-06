import XCTest
@testable import OmoKit

final class ThreadFilterTests: XCTestCase {
    private func thread(_ id: String, updatedAt: Date, status: String = "idle", name: String? = nil) -> ConversationThread {
        let value: JSONValue = .object([
            "id": .string(id),
            "cwd": .string("/work"),
            "name": name.map(JSONValue.string) ?? .null,
            "preview": .string("preview"),
            "updatedAt": .number(updatedAt.timeIntervalSince1970),
            "status": .object(["type": .string(status)]),
            "turns": .array([])
        ])
        return ConversationThread(value)!
    }

    func testMonthExcludesThreadOlderThanThirtyDays() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let recent = thread("recent", updatedAt: now.addingTimeInterval(-29 * 24 * 60 * 60))
        let old = thread("old", updatedAt: now.addingTimeInterval(-40 * 24 * 60 * 60))

        let result = ThreadFilter(period: .month).apply(to: [recent, old], now: now)

        XCTAssertEqual(result.map(\.id), ["recent"])
    }

    func testTodayStartsAtLocalMidnight() {
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current
        let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 5, hour: 14))!
        let midnight = calendar.startOfDay(for: now)
        let today = thread("today", updatedAt: midnight)
        let yesterday = thread("yesterday", updatedAt: midnight.addingTimeInterval(-1))

        let result = ThreadFilter(period: .today).apply(to: [today, yesterday], now: now)

        XCTAssertEqual(result.map(\.id), ["today"])
    }

    func testRunningOnlyKeepsActiveThreadsAndCombinesSearch() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let activeMatch = thread("active", updatedAt: now, status: "active", name: "Build")
        let idleMatch = thread("idle", updatedAt: now, name: "Build")
        let activeOther = thread("other", updatedAt: now, status: "active", name: "Deploy")

        let result = ThreadFilter(query: "build", runningOnly: true).apply(to: [activeMatch, idleMatch, activeOther], now: now)

        XCTAssertEqual(result.map(\.id), ["active"])
    }
}
