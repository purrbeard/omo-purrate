import XCTest
@testable import OmoKit

final class ConversationStoreTests: XCTestCase {
    private func thread(_ id: String = "t", cwd: String = "/work", updated: Double = 1) -> JSONValue {
        .object(["id": .string(id), "cwd": .string(cwd), "name": .null, "preview": .string("hello"), "updatedAt": .number(updated), "status": .object(["type": .string("idle")]), "path": .null, "turns": .array([])])
    }
    private func initial() -> ConversationStore { var s = ConversationStore(); s.load(thread()); return s }
    private func turn(_ status: String = "inProgress") -> JSONValue {
        .object(["threadId": .string("t"), "turn": .object(["id": .string("turn"), "status": .string(status), "items": .array([])])])
    }
    private func item(_ type: String = "agentMessage", text: String = "") -> JSONValue {
        .object(["threadId": .string("t"), "turnId": .string("turn"), "item": .object(["id": .string("i"), "type": .string(type), "text": .string(text)])])
    }
    private func delta(_ text: String) -> JSONValue {
        .object(["threadId": .string("t"), "turnId": .string("turn"), "itemId": .string("i"), "delta": .string(text)])
    }
    func testStreamingDeltasAndAuthoritativeCompletion() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.apply(method: "item/started", params: item())
        s.apply(method: "item/agentMessage/delta", params: delta("Hello "))
        s.apply(method: "item/agentMessage/delta", params: delta("world"))
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.text, "Hello world")
        s.apply(method: "item/completed", params: item(text: "Hello world!"))
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.text, "Hello world!")
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.count, 1)
    }
    func testCompletedItemWithEmptyTextPreservesThreeDeltas() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.apply(method: "item/agentMessage/delta", params: delta("one"))
        s.apply(method: "item/agentMessage/delta", params: delta("two"))
        s.apply(method: "item/agentMessage/delta", params: delta("three"))
        s.apply(method: "item/completed", params: item(text: ""))
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.text, "onetwothree")
    }
    func testDeltaBeforeItemStartedIsPreserved() {
        var s = initial()
        s.apply(method: "item/agentMessage/delta", params: delta("early"))
        s.apply(method: "item/started", params: item())
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.text, "early")
    }
    func testEveryNonActiveStatusSettles() {
        for status in ["idle", "notLoaded", "systemError", "futureStatus"] {
            var s = initial()
            s.apply(method: "turn/started", params: turn())
            s.apply(method: "item/started", params: item())
            s.apply(method: "thread/status/changed", params: .object(["threadId": .string("t"), "status": .object(["type": .string(status)])]))
            XCTAssertNil(s.threads["t"]?.activeTurnID)
            XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.status, "completed")
        }
    }
    func testCompletionPreservesStreamingAndSettlesItems() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.apply(method: "item/agentMessage/delta", params: delta("done"))
        s.apply(method: "turn/completed", params: turn("interrupted"))
        XCTAssertNil(s.threads["t"]?.activeTurnID)
        XCTAssertEqual(s.threads["t"]?.turns.first?.status, "interrupted")
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.text, "done")
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.first?.status, "completed")
    }
    func testInterruptSettlesActiveTurnAsInterrupted() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.interrupt(threadID: "t")
        XCTAssertNil(s.threads["t"]?.activeTurnID)
        XCTAssertEqual(s.threads["t"]?.turns.first?.status, "interrupted")
    }
    func testSteerVersusStartTextOnly() {
        var s = initial()
        let start = s.request(threadID: "t", text: "go")
        XCTAssertEqual(start.method, "turn/start")
        XCTAssertEqual(start.params["input"].array.first?["type"], .string("text"))
        XCTAssertEqual(start.params["input"].array.first?["text_elements"], .array([]))
        s.apply(method: "turn/started", params: turn())
        let steer = s.request(threadID: "t", text: "adjust")
        XCTAssertEqual(steer.method, "turn/steer")
        XCTAssertEqual(steer.params["expectedTurnId"], .string("turn"))
        s.apply(method: "turn/completed", params: turn("completed"))
        XCTAssertEqual(s.request(threadID: "t", text: "next").method, "turn/start")
    }
    func testPendingEchoReconcilesOnlyOncePerServerItem() {
        var s = initial()
        s.echo(threadID: "t", text: "same")
        s.echo(threadID: "t", text: "same")
        let user: JSONValue = .object(["threadId": .string("t"), "turnId": .string("turn"), "item": .object(["id": .string("u"), "type": .string("userMessage"), "content": .array([.object(["type": .string("text"), "text": .string("same")])])])])
        s.apply(method: "item/started", params: user)
        s.apply(method: "item/completed", params: user)
        XCTAssertEqual(s.threads["t"]?.pendingMessages.count, 1)
        XCTAssertEqual(s.threads["t"]?.turns.first?.items.count, 1)
        let id = s.threads["t"]!.pendingMessages.first!.id
        s.removeEcho(threadID: "t", id: id)
        XCTAssertEqual(s.threads["t"]?.pendingMessages.count, 0)
    }
    func testWorkspaceGroupingSearchAndListPreservesTurns() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.mergeList(.object(["data": .array([thread("t", updated: 3), thread("b", cwd: "/other", updated: 2), thread("c", updated: 1)]), "nextCursor": .null]))
        XCTAssertEqual(s.groups().map(\.cwd), ["/work", "/other"])
        XCTAssertEqual(s.groups().first?.threads.map(\.id), ["t", "c"])
        XCTAssertEqual(s.groups(search: "OTHER").first?.threads.map(\.id), ["b"])
        XCTAssertEqual(s.recentWorkspaces, ["/work", "/other"])
        XCTAssertEqual(s.threads["t"]?.turns.count, 1)
        XCTAssertNil(s.threads["t"]?.activeTurnID)
    }
    func testToolSummaryAndAttention() {
        let command = ConversationItem(.object(["id": .string("cmd"), "type": .string("commandExecution"), "command": .string("swift test"), "status": .string("inProgress")]))
        XCTAssertEqual(command?.text, "swift test")
        let tool = ConversationItem(.object(["id": .string("tool"), "type": .string("dynamicToolCall"), "tool": .string("edit")]))
        XCTAssertEqual(tool?.text, "edit")
        var s = initial()
        s.apply(method: "thread/status/changed", params: .object(["threadId": .string("t"), "status": .object(["type": .string("active"), "activeFlags": .array([.string("waitingOnApproval")])])]))
        XCTAssertEqual(s.threads["t"]?.needsMacAttention, true)
    }
    func testDisconnectSettlesAndUnknownNotificationsDoNothing() {
        var s = initial()
        s.apply(method: "turn/started", params: turn())
        s.apply(method: "future/notification", params: .object(["threadId": .string("t")]))
        XCTAssertEqual(s.threads["t"]?.activeTurnID, "turn")
        s.disconnect()
        XCTAssertNil(s.threads["t"]?.activeTurnID)
        XCTAssertEqual(s.threads["t"]?.status, "notLoaded")
    }
}
