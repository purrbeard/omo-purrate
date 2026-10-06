// CLT-only smoke check of the actual Network.framework listener on macOS.
// This is not an iPhone/USB integration test or a replacement for XCTest.
import Foundation
import Network
import OmoKit

@main @MainActor struct ListenerSmoke {
    static func main() async throws {
        let listener = USBListener()
        let probe = Probe()
        var replacements = 0
        listener.onDisconnect = { error in
            replacements += 1
            if let error { print("Listener disconnected: \(error)") }
        }
        try listener.start()
        defer { probe.stop(); listener.stop() }
        try await probe.exchange(host: .ipv4(.loopback), token: 1)
        try await probe.exchange(host: .ipv6(.loopback), token: 2)
        guard replacements == 1 else { throw Probe.Failure("Expected one replaced Mac connection, got \(replacements)") }
        print("PASS: IPv4 and IPv6 loopback ping/pong; one active Mac connection replaced")
    }
}

@MainActor private final class Probe {
    struct Failure: Error { let message: String; init(_ message: String) { self.message = message } }
    private var connections: [NWConnection] = []
    private var continuation: CheckedContinuation<Void, Error>?
    private var deadline: DispatchWorkItem?
    private var codec = FrameCodec()
    func stop() { connections.forEach { $0.cancel() }; deadline?.cancel() }
    private func finish(_ result: Result<Void, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        deadline?.cancel(); deadline = nil
        continuation.resume(with: result)
    }
    func exchange(host: NWEndpoint.Host, token: Double) async throws {
        print("Connecting to \(host)")
        codec = FrameCodec()
        let client = NWConnection(host: host, port: NWEndpoint.Port(rawValue: 47101)!, using: .tcp)
        connections.append(client)
        let packet = try FrameCodec.encode(.ping(token))
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let deadline = DispatchWorkItem { [weak self] in
                Task { @MainActor [weak self] in self?.finish(.failure(Failure("No pong within 3 seconds"))) }
            }
            self.deadline = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: deadline)
            client.stateUpdateHandler = { [weak self, weak client] state in
                Task { @MainActor [weak self, weak client] in
                    guard let self, let client else { return }
                    print("Client state: \(state)")
                    switch state {
                    case .ready:
                        self.receive(client, token: token)
                        client.send(content: packet, completion: .contentProcessed { [weak self] error in
                            if let error { Task { @MainActor [weak self] in self?.finish(.failure(error)) } }
                        })
                    case .failed(let error): self.finish(.failure(error))
                    default: break
                    }
                }
            }
            client.start(queue: .main)
        }
    }
    private func receive(_ client: NWConnection, token: Double) {
        client.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self, weak client] data, _, complete, error in
            Task { @MainActor [weak self, weak client] in
                guard let self, let client else { return }
                do {
                    if let data {
                        for message in try self.codec.append(data) where message == .pong(token) {
                            self.finish(.success(())); return
                        }
                    }
                    if let error { self.finish(.failure(error)) }
                    else if complete { self.finish(.failure(Failure("Stream closed before pong"))) }
                    else { self.receive(client, token: token) }
                } catch { self.finish(.failure(error)) }
            }
        }
    }
}
