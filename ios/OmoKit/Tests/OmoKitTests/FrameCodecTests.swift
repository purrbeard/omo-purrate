import XCTest
@testable import OmoKit

final class FrameCodecTests: XCTestCase {
    func testEverySplitBoundary() throws {
        let message = BridgeMessage.hello(version: 1, macName: "Mac 한글", state: "connected")
        let frame = try FrameCodec.encode(message)
        for split in 1..<frame.count {
            var codec = FrameCodec()
            XCTAssertEqual(try codec.append(Data(frame.prefix(split))), [])
            XCTAssertEqual(try codec.append(Data(frame.dropFirst(split))), [message])
        }
    }
    func testMergedFramesAndPartialNextHeader() throws {
        let first = try FrameCodec.encode(.ping(1))
        let second = try FrameCodec.encode(.pong(1))
        var codec = FrameCodec()
        XCTAssertEqual(try codec.append(first + second.prefix(2)), [.ping(1)])
        XCTAssertEqual(try codec.append(Data(second.dropFirst(2)) + first), [.pong(1), .ping(1)])
    }
    func testByteByByte() throws {
        let frame = try FrameCodec.encode(.notification(method: "test", params: .object(["text": .string("한글")])))
        var codec = FrameCodec()
        var output: [BridgeMessage] = []
        for byte in frame { output += try codec.append(Data([byte])) }
        XCTAssertEqual(output.count, 1)
    }
    func testOversizedHeaderRejectedBeforeBody() throws {
        var codec = FrameCodec()
        XCTAssertThrowsError(try codec.append(Data([0, 128, 0, 1]))) { XCTAssertEqual($0 as? FrameCodec.Failure, .oversizedFrame) }
    }
    func testOversizedEncodingRejected() throws {
        XCTAssertThrowsError(try FrameCodec.encode(.rpcResult(id: 1, result: .string(String(repeating: "x", count: FrameCodec.maximumLength)))))
    }
    func testMalformedJSONIsFatal() {
        var codec = FrameCodec()
        XCTAssertThrowsError(try codec.append(Data([0, 0, 0, 1, 123])))
    }
    func testAllBridgeShapesRoundTrip() throws {
        let messages: [BridgeMessage] = [
            .hello(version: 2, macName: "Mac", state: "starting"), .bridgeStatus("connected"),
            .rpc(id: 3, method: "thread/list", params: .object([:])), .rpcResult(id: 3, result: .array([.bool(true), .null])),
            .rpcError(id: 4, error: .init(code: -32601, message: "Unsupported")),
            .serverRequest(id: .string("request-1"), method: "thread/list", params: .object(["limit": .number(10)])),
            .serverAnswer(id: .number(42), result: .object(["ok": .bool(true)])),
            .notification(method: "turn/started", params: .object([:])), .ping(10), .pong(10)
        ]
        var codec = FrameCodec()
        XCTAssertEqual(try codec.append(messages.reduce(Data()) { try $0 + FrameCodec.encode($1) }), messages)
    }
    func testServerRequestDeliveredInTwoChunks() throws {
        let message = BridgeMessage.serverRequest(id: .number(7), method: "thread/list", params: .object([:]))
        let frame = try FrameCodec.encode(message)
        var codec = FrameCodec()
        let split = frame.count / 2
        XCTAssertEqual(try codec.append(Data(frame.prefix(split))), [])
        XCTAssertEqual(try codec.append(Data(frame.dropFirst(split))), [message])
    }
    func testNineMiBLengthRejected() {
        var codec = FrameCodec()
        // 0x00900000 is 9 MiB, one MiB over the 8 MiB maximum.
        XCTAssertThrowsError(try codec.append(Data([0, 144, 0, 0]))) { XCTAssertEqual($0 as? FrameCodec.Failure, .oversizedFrame) }
    }
    func testUnknownFrameIgnoredByClientContract() throws {
        let body = Data(#"{"type":"future","extra":42}"#.utf8)
        var codec = FrameCodec()
        XCTAssertEqual(try codec.append(Data([0, 0, 0, UInt8(body.count)]) + body), [.unknown])
    }
    func testInvalidIDRejected() {
        XCTAssertThrowsError(try JSONDecoder().decode(BridgeMessage.self, from: Data(#"{"type":"rpcResult","id":1.5,"result":null}"#.utf8)))
    }
}
