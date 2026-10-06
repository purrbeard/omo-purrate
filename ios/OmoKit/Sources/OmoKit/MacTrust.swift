import Foundation

/// Trust decisions and stream ownership, independent of transport and persistence.
public struct MacTrust {
    public struct Peer: Codable, Equatable, Sendable {
        public let macName: String
        public let token: String
        public init(macName: String, token: String) { self.macName = macName; self.token = token }
    }
    public private(set) var trusted: Peer?
    public private(set) var activeConnection: UUID?
    public private(set) var candidates: [UUID: Peer] = [:]

    public init(trusted: Peer? = nil) { self.trusted = trusted }

    /// Returns whether the frame may reach the app; only a trusted hello takes stream ownership.
    public mutating func receive(_ message: BridgeMessage, from connection: UUID) -> Bool {
        switch message {
        case let .hello(version, name, _, token):
            candidates.removeValue(forKey: connection)
            guard version == 1, token.count == 64,
                  token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return false }
            let peer = Peer(macName: name, token: token)
            if activeConnection == connection, trusted?.token != token { activeConnection = nil }
            candidates[connection] = peer
            guard trusted == nil || trusted?.token == token else { return false }
            trusted = peer
            activeConnection = connection
            candidates.removeValue(forKey: connection)
            return true
        case .ping, .pong: return true
        default: return activeConnection == connection
        }
    }

    /// Explicit approval replaces the trusted Mac and authenticates its pending stream.
    @discardableResult public mutating func approve(_ connection: UUID) -> Bool {
        guard let peer = candidates.removeValue(forKey: connection) else { return false }
        trusted = peer
        activeConnection = connection
        return true
    }

    public func canSend(_ message: BridgeMessage, on connection: UUID) -> Bool {
        switch message {
        case .hello, .ping, .pong: return true
        default: return activeConnection == connection
        }
    }

    public mutating func disconnect(_ connection: UUID) {
        candidates.removeValue(forKey: connection)
        if activeConnection == connection { activeConnection = nil }
    }
}
