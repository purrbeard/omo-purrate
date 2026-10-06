import XCTest
@testable import OmoKit

final class MacTrustTests: XCTestCase {
    private let token = String(repeating: "a", count: 64)
    private let otherToken = String(repeating: "b", count: 64)
    private func hello(_ token: String, name: String = "Mac") -> BridgeMessage {
        .hello(version: 1, macName: name, state: "connected", token: token)
    }
    func testFirstHelloIsTrusted() {
        var trust = MacTrust()
        let connection = UUID()
        XCTAssertTrue(trust.receive(hello(token), from: connection))
        XCTAssertEqual(trust.trusted, .init(macName: "Mac", token: token))
        XCTAssertEqual(trust.activeConnection, connection)
    }
    func testStoredTokenAuthenticatesNextConnection() {
        var trust = MacTrust(trusted: .init(macName: "Old name", token: token))
        let connection = UUID()
        XCTAssertTrue(trust.receive(hello(token, name: "Renamed Mac"), from: connection))
        XCTAssertEqual(trust.trusted?.macName, "Renamed Mac")
        XCTAssertTrue(trust.canSend(.rpc(id: 1, method: "thread/list", params: .object([:])), on: connection))
    }
    func testDifferentTokenDropsRPCAndCannotSendRPC() {
        var trust = MacTrust(trusted: .init(macName: "Mac", token: token))
        let connection = UUID()
        XCTAssertFalse(trust.receive(hello(otherToken, name: "Other Mac"), from: connection))
        let rpc = BridgeMessage.rpc(id: 1, method: "thread/list", params: .object([:]))
        XCTAssertFalse(trust.receive(rpc, from: connection))
        XCTAssertFalse(trust.canSend(rpc, on: connection))
        XCTAssertFalse(trust.canSend(.trusted, on: connection))
        XCTAssertFalse(trust.receive(.serverRequest(id: .number(1), method: "approval", params: .object([:])), from: connection))
        XCTAssertFalse(trust.receive(.rpcResult(id: 1, result: .null), from: connection))
        XCTAssertTrue(trust.receive(.ping(1), from: connection))
        XCTAssertTrue(trust.canSend(.pong(1), on: connection))
        XCTAssertEqual(trust.trusted?.token, token)
        XCTAssertNil(trust.activeConnection)
    }
    func testUnauthenticatedConnectionDoesNotDisplaceLiveMac() {
        var trust = MacTrust()
        let live = UUID(), candidate = UUID()
        XCTAssertTrue(trust.receive(hello(token), from: live))
        XCTAssertFalse(trust.receive(.bridgeStatus("connected"), from: candidate))
        XCTAssertEqual(trust.activeConnection, live)
        XCTAssertFalse(trust.receive(hello(otherToken), from: candidate))
        XCTAssertEqual(trust.activeConnection, live)
        XCTAssertTrue(trust.receive(.bridgeStatus("connected"), from: live))
        trust.disconnect(candidate)
        XCTAssertEqual(trust.activeConnection, live)
    }
    func testExplicitApprovalReplacesTrustedMacAndStream() {
        var trust = MacTrust()
        let live = UUID(), candidate = UUID()
        _ = trust.receive(hello(token), from: live)
        _ = trust.receive(hello(otherToken, name: "New Mac"), from: candidate)
        XCTAssertTrue(trust.approve(candidate))
        XCTAssertEqual(trust.trusted, .init(macName: "New Mac", token: otherToken))
        XCTAssertEqual(trust.activeConnection, candidate)
        XCTAssertFalse(trust.receive(.bridgeStatus("connected"), from: live))
        XCTAssertTrue(trust.receive(.bridgeStatus("connected"), from: candidate))
        XCTAssertTrue(trust.canSend(.trusted, on: candidate))
        trust.disconnect(live)
        XCTAssertEqual(trust.activeConnection, candidate)
    }
    func testDisconnectedCandidateCannotBeApproved() {
        var trust = MacTrust(trusted: .init(macName: "Mac", token: token))
        let candidate = UUID()
        _ = trust.receive(hello(otherToken), from: candidate)
        trust.disconnect(candidate)
        XCTAssertFalse(trust.approve(candidate))
        XCTAssertEqual(trust.trusted?.token, token)
    }
    func testMalformedOrUnsupportedHelloCannotEstablishTrust() {
        var trust = MacTrust()
        let connection = UUID()
        XCTAssertFalse(trust.receive(hello(""), from: connection))
        XCTAssertFalse(trust.receive(hello(String(repeating: "z", count: 64)), from: connection))
        XCTAssertFalse(trust.receive(.hello(version: 2, macName: "Mac", state: "connected", token: token), from: connection))
        XCTAssertNil(trust.trusted)
        XCTAssertThrowsError(try JSONDecoder().decode(BridgeMessage.self, from: Data(#"{"type":"hello","version":1,"macName":"Mac","bridge":{"state":"connected"}}"#.utf8)))
    }
}
