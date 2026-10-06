import XCTest
@testable import OmoKit

@MainActor private final class TestTransport: BridgeTransport {
    var onMessage: ((BridgeMessage) -> Void)?
    var onDisconnect: ((Error?) -> Void)?
    var sent: [BridgeMessage] = []
    var onSend: ((BridgeMessage) -> Void)?
    var sendError: Error?
    func start() throws {}
    func stop() { onDisconnect?(nil) }
    func send(_ message: BridgeMessage) async throws {
        if let sendError { throw sendError }
        // Exercise the actual framing and JSON path, not just an isolated continuation.
        var codec = FrameCodec()
        let decoded = try codec.append(FrameCodec.encode(message))[0]
        sent.append(decoded)
        onSend?(decoded)
    }
    func deliver(_ message: BridgeMessage) throws {
        var codec = FrameCodec()
        for decoded in try codec.append(FrameCodec.encode(message)) { onMessage?(decoded) }
    }
}

final class RPCClientTests: XCTestCase {
    @MainActor func testTurnStartSucceedsAfterMoreThanOldDefaultDeadline() async throws {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 1_000_000 })
        let sent = expectation(description: "Turn start sent")
        transport.onSend = { message in
            guard case let .rpc(id, method, _) = message, method == "turn/start" else { return }
            sent.fulfill()
            Task { @MainActor in
                // Longer than the injected deadline, without sleeping in real time.
                try? await Task.sleep(nanoseconds: 2_000_000)
                try? transport.deliver(.rpcResult(id: id, result: .object([:])))
            }
        }
        let call = Task { try await client.call("turn/start") }
        await fulfillment(of: [sent], timeout: 1)
        let result = try await call.value
        XCTAssertEqual(result, .object([:]))
    }

    @MainActor func testResultThroughFramesAndUniqueIDs() async throws {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        transport.onSend = { message in
            guard case .rpc(let id, _, _) = message else { return XCTFail("Expected RPC") }
            do { try transport.deliver(.rpcResult(id: id, result: .number(Double(id)))) }
            catch { XCTFail("\(error)") }
        }
        let first = try await client.call("thread/list")
        let second = try await client.call("thread/list")
        XCTAssertEqual(first, .number(1)); XCTAssertEqual(second, .number(2))
        XCTAssertEqual(client.pendingCount, 0)
    }
    @MainActor func testOutOfOrderResultsResolveCorrectCaller() async throws {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        let sent = expectation(description: "Two exact send events")
        sent.expectedFulfillmentCount = 2
        transport.onSend = { _ in sent.fulfill() }
        let a = Task { try await client.call("a") }
        let b = Task { try await client.call("b") }
        await fulfillment(of: [sent], timeout: 1)
        for message in transport.sent.reversed() {
            if case let .rpc(id, method, _) = message { try transport.deliver(.rpcResult(id: id, result: .string(method))) }
        }
        let aResult = try await a.value
        let bResult = try await b.value
        XCTAssertEqual(aResult, .string("a")); XCTAssertEqual(bResult, .string("b"))
    }
    @MainActor func testRPCError() async {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        transport.onSend = { message in
            if case .rpc(let id, _, _) = message {
                do { try transport.deliver(.rpcError(id: id, error: .init(code: -32601, message: "Unsupported"))) }
                catch { XCTFail("\(error)") }
            }
        }
        do { _ = try await client.call("unsupported"); XCTFail("Expected error") }
        catch { XCTAssertEqual((error as? RPCError)?.code, -32601) }
        XCTAssertEqual(client.pendingCount, 0)
    }
    @MainActor func testDisconnectRejectsPending() async {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        transport.onSend = { _ in transport.stop() }
        do { _ = try await client.call("thread/list"); XCTFail("Expected disconnect") }
        catch { guard case RPCClient.Failure.disconnected = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(client.pendingCount, 0)
    }
    @MainActor func testTimeoutAndLateResponse() async throws {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 0 })
        do { _ = try await client.call("thread/list"); XCTFail("Expected timeout") }
        catch { guard case RPCClient.Failure.timeout = error else { return XCTFail("\(error)") } }
        try transport.deliver(.rpcResult(id: 1, result: .null))
        XCTAssertEqual(client.pendingCount, 0)
    }
    @MainActor func testCancellationAfterExactSend() async {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        let sent = expectation(description: "Request sent")
        transport.onSend = { _ in sent.fulfill() }
        let task = Task { try await client.call("thread/list") }
        await fulfillment(of: [sent], timeout: 1)
        task.cancel()
        do { _ = try await task.value; XCTFail("Expected cancellation") }
        catch { guard case RPCClient.Failure.cancelled = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(client.pendingCount, 0)
    }
    @MainActor func testSendFailureAndNotificationDispatch() async throws {
        let transport = TestTransport()
        let client = RPCClient(transport: transport, timeoutOverride: { _ in 2_000_000_000 })
        var store = ConversationStore()
        client.onEvent = { if case let .notification(method, params) = $0 { store.apply(method: method, params: params) } }
        try transport.deliver(.notification(method: "thread/started", params: .object(["thread": .object([
            "id": .string("t"), "cwd": .string("/work"), "preview": .string("test"), "updatedAt": .number(1), "status": .object(["type": .string("idle")])
        ])])))
        XCTAssertEqual(store.threads["t"]?.cwd, "/work")
        transport.sendError = RPCError(code: 99, message: "Send failed")
        do { _ = try await client.call("thread/list"); XCTFail("Expected send error") }
        catch { XCTAssertEqual((error as? RPCError)?.code, 99) }
        XCTAssertEqual(client.pendingCount, 0)
    }
}
