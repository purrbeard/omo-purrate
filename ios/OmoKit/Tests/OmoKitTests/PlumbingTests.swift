import XCTest
@testable import OmoKit

final class PlumbingTests: XCTestCase {
    private func store() -> ConversationStore {
        var s = ConversationStore()
        s.load(.object(["id": .string("t"), "cwd": .string("/work"), "preview": .string("hi"), "updatedAt": .number(1), "status": .object(["type": .string("idle")]), "turns": .array([])]))
        return s
    }
    private let catalogue: JSONValue = .object(["data": .array([.object([
        "id": .string("gpt"), "displayName": .string("GPT"), "hidden": .bool(false), "defaultReasoningEffort": .string("medium"),
        "supportedReasoningEfforts": .array([.object(["reasoningEffort": .string("low")]), .object(["reasoningEffort": .string("high")])]),
    ])])])

    func testTurnStartCarriesSelectedModelAndEffort() {
        var s = store()
        let plain = s.request(threadID: "t", text: "go")
        XCTAssertEqual(plain.params["model"], .null)
        XCTAssertEqual(plain.params["effort"], .null)
        s.setModels(catalogue)
        XCTAssertEqual(s.models.first?.efforts, ["low", "high"])
        XCTAssertEqual(s.models.first?.defaultEffort, "medium")
        s.select(model: "gpt", effort: "high")
        let selected = s.request(threadID: "t", text: "go")
        XCTAssertEqual(selected.method, "turn/start")
        XCTAssertEqual(selected.params["model"], .string("gpt"))
        XCTAssertEqual(selected.params["effort"], .string("high"))
        s.setModels(.object(["data": .array([])]))
        XCTAssertNil(s.selectedModel)
        XCTAssertEqual(s.request(threadID: "t", text: "go").params["model"], .null)
    }

    func testGoalNotificationsLandInStore() {
        var s = store()
        s.apply(method: "thread/goal/updated", params: .object(["threadId": .string("t"), "turnId": .null, "goal": .object([
            "threadId": .string("t"), "objective": .string("ship it"), "status": .string("active"), "tokenBudget": .null,
            "tokensUsed": .number(5), "timeUsedSeconds": .number(2), "createdAt": .number(1), "updatedAt": .number(3),
        ])]))
        XCTAssertEqual(s.goals["t"]?.objective, "ship it")
        XCTAssertEqual(s.goals["t"]?.status, "active")
        XCTAssertNil(s.goals["t"]?.tokenBudget)
        s.apply(method: "thread/goal/cleared", params: .object(["threadId": .string("t")]))
        XCTAssertNil(s.goals["t"])
    }

    func testServerRequestIsPerThreadAndResolvedRemovesIt() {
        var s = store()
        let params: JSONValue = .object(["threadId": .string("t"), "turnId": .string("turn"), "itemId": .string("i"), "command": .string("rm")])
        s.receiveServerRequest(id: .number(7), method: "item/commandExecution/requestApproval", params: params)
        s.receiveServerRequest(id: .number(7), method: "item/commandExecution/requestApproval", params: params)
        s.receiveServerRequest(id: .string("7"), method: "item/tool/requestUserInput", params: params)
        XCTAssertEqual(s.requests(threadID: "t").map(\.method), ["item/commandExecution/requestApproval", "item/tool/requestUserInput"])
        XCTAssertTrue(s.requests(threadID: "other").isEmpty)
        s.apply(method: "serverRequest/resolved", params: .object(["threadId": .string("t"), "requestId": .number(7)]))
        XCTAssertEqual(s.requests(threadID: "t").map(\.requestID), [.string("7")])
        XCTAssertNotNil(s.resolveServerRequest(.string("7")))
        XCTAssertNil(s.resolveServerRequest(.string("7")))
        XCTAssertTrue(s.requests(threadID: "t").isEmpty)
    }
}
