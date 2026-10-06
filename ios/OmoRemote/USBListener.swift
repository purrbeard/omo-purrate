import Foundation
import Network
import OmoKit

/// Loopback USB streams remain isolated until their Mac token is trusted.
@MainActor final class USBListener: BridgeTransport {
    var onMessage: ((BridgeMessage) -> Void)?
    var onDisconnect: ((Error?) -> Void)?
    var onTrustRequest: ((String?) -> Void)?
    var trustedMacName: String? { trust.trusted?.macName }
    private let defaults: UserDefaults
    private var trust: MacTrust
    private var listener: NWListener?
    private var active: UUID?
    private var pending: UUID?
    private var streams: [UUID: Stream] = [:]
    @MainActor private final class Stream {
        let connection: NWConnection
        var codec = FrameCodec()
        var hello: BridgeMessage?
        var heartbeat: Timer?
        var lastHeard = ProcessInfo.processInfo.systemUptime
        var lastPing = ProcessInfo.processInfo.systemUptime
        init(_ connection: NWConnection) { self.connection = connection }
    }
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let peer = defaults.data(forKey: "trustedMac").flatMap { try? JSONDecoder().decode(MacTrust.Peer.self, from: $0) }
        trust = MacTrust(trusted: peer)
    }
    func start() throws {
        guard listener == nil else { return }
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        let newListener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: 47101)!)
        newListener.newConnectionHandler = { [weak self, weak newListener] connection in
            Task { @MainActor [weak self, weak newListener] in
                guard let self, let newListener, self.listener === newListener else { connection.cancel(); return }
                self.accept(connection)
            }
        }
        newListener.stateUpdateHandler = { [weak self, weak newListener] state in
            if case .failed(let error) = state {
                Task { @MainActor [weak self, weak newListener] in
                    guard let self, let newListener, self.listener === newListener else { return }
                    self.stop(); self.onDisconnect?(error)
                }
            }
        }
        listener = newListener
        newListener.start(queue: .main)
    }
    func stop() {
        let old = listener
        listener = nil
        old?.cancel()
        for id in Array(streams.keys) { close(id, nil) }
    }
    private func accept(_ connection: NWConnection) {
        let id = UUID()
        let stream = Stream(connection)
        streams[id] = stream
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self, self.streams[id] != nil else { return }
                switch state {
                case .ready:
                    self.receive(id)
                    stream.heartbeat = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                        Task { @MainActor [weak self] in await self?.tick(id) }
                    }
                case .failed(let error): self.close(id, error)
                case .cancelled: self.close(id, nil)
                default: break
                }
            }
        }
        connection.start(queue: .main)
    }
    private func receive(_ id: UUID) {
        guard let stream = streams[id] else { return }
        stream.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            Task { @MainActor [weak self] in
                guard let self, self.streams[id] === stream else { return }
                do {
                    if let data, !data.isEmpty {
                        stream.lastHeard = ProcessInfo.processInfo.systemUptime
                        for message in try stream.codec.append(data) {
                            guard self.streams[id] === stream else { return }
                            let allowed = self.trust.receive(message, from: id)
                            if case .hello = message {
                                stream.hello = message
                                if allowed {
                                    self.promote(id)
                                    try await self.write(.trusted, to: id)
                                    guard self.active == id else { return }
                                }
                                else if let peer = self.trust.candidates[id] {
                                    if self.active == id { self.active = nil; self.onDisconnect?(nil) }
                                    if let previous = self.pending, previous != id { self.close(previous, nil) }
                                    self.pending = id; self.onTrustRequest?(peer.macName)
                                } else { self.close(id, nil); return }
                            }
                            guard allowed else { continue }
                            if case .ping(let t) = message { try await self.write(.pong(t), to: id) }
                            else if case .pong = message { /* Heartbeat only. */ }
                            else { self.onMessage?(message) }
                        }
                    }
                    guard self.streams[id] === stream else { return }
                    if let error { self.close(id, error) }
                    else if complete { self.close(id, nil) }
                    else { self.receive(id) }
                } catch { self.close(id, error) }
            }
        }
    }
    func resolveTrust(approve: Bool) {
        guard let id = pending else { return }
        if approve, trust.approve(id), let hello = streams[id]?.hello {
            promote(id)
            Task {
                do {
                    try await write(.trusted, to: id)
                    guard active == id else { return }
                    onMessage?(hello)
                } catch { close(id, error) }
            }
        } else { close(id, nil) }
    }
    private func promote(_ id: UUID) {
        if let previous = active, previous != id { close(previous, nil) }
        active = id
        if pending == id { pending = nil; onTrustRequest?(nil) }
        if let peer = trust.trusted, let data = try? JSONEncoder().encode(peer) { defaults.set(data, forKey: "trustedMac") }
    }
    func send(_ message: BridgeMessage) async throws {
        guard let id = active, trust.canSend(message, on: id) else { throw RPCClient.Failure.disconnected }
        try await write(message, to: id)
    }
    private func write(_ message: BridgeMessage, to id: UUID) async throws {
        guard let target = streams[id]?.connection, trust.canSend(message, on: id) else { throw RPCClient.Failure.disconnected }
        let data = try FrameCodec.encode(message)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            target.send(content: data, completion: .contentProcessed { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            })
        }
    }
    private func tick(_ id: UUID) async {
        guard let stream = streams[id] else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if now - stream.lastHeard >= 30 { close(id, RPCClient.Failure.timeout); return }
        guard now - stream.lastPing >= 10 else { return }
        stream.lastPing = now
        do { try await write(.ping(Date().timeIntervalSince1970 * 1000), to: id) }
        catch { close(id, error) }
    }
    private func close(_ id: UUID, _ error: Error?) {
        guard let stream = streams.removeValue(forKey: id) else { return }
        stream.heartbeat?.invalidate()
        stream.connection.stateUpdateHandler = nil
        stream.connection.cancel()
        trust.disconnect(id)
        if pending == id { pending = nil; onTrustRequest?(nil) }
        if active == id { active = nil; onDisconnect?(error) }
    }
}
