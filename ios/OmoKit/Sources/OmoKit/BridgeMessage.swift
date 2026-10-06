import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    private struct Key: CodingKey {
        let stringValue: String
        init(stringValue: String) { self.stringValue = stringValue }
        var intValue: Int? { nil }
        init?(intValue: Int) { nil }
    }

    // Objects and arrays are read through their own containers; decoding `{}` as a single value fails.
    public init(from decoder: Decoder) throws {
        if let keyed = try? decoder.container(keyedBy: Key.self) {
            var object: [String: JSONValue] = [:]
            for key in keyed.allKeys { object[key.stringValue] = try keyed.decode(JSONValue.self, forKey: key) }
            self = .object(object)
            return
        }
        if var unkeyed = try? decoder.unkeyedContainer() {
            var array: [JSONValue] = []
            while !unkeyed.isAtEnd { array.append(try unkeyed.decode(JSONValue.self)) }
            self = .array(array)
            return
        }
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else { self = .string(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public subscript(_ key: String) -> JSONValue { if case .object(let v) = self { return v[key] ?? .null }; return .null }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    public var number: Double? { if case .number(let v) = self { return v }; return nil }
    fileprivate var isID: Bool { if case .string = self { return true }; if case .number(let value) = self { return value.isFinite && value.rounded() == value }; return false }
    fileprivate var isObject: Bool { if case .object = self { return true }; return false }
}

public struct RPCError: Codable, Error, Equatable, Sendable, LocalizedError {
    public let code: Int
    public let message: String
    public init(code: Int, message: String) { self.code = code; self.message = message }
    public var errorDescription: String? { message }
}

public enum BridgeMessage: Codable, Equatable, Sendable {
    case hello(version: Int, macName: String, state: String, token: String = "")
    case trusted
    case bridgeStatus(String)
    case rpc(id: Int, method: String, params: JSONValue)
    case rpcResult(id: Int, result: JSONValue)
    case serverRequest(id: JSONValue, method: String, params: JSONValue)
    case serverAnswer(id: JSONValue, result: JSONValue)
    case rpcError(id: Int, error: RPCError)
    case notification(method: String, params: JSONValue)
    case ping(Double), pong(Double)
    case unknown

    public init(from decoder: Decoder) throws {
        let v = try JSONValue(from: decoder)
        func required<T>(_ value: T?) throws -> T {
            guard let value else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Malformed bridge frame")) }
            return value
        }
        func integer(_ key: String) throws -> Int {
            let n = try required(v[key].number)
            guard n.isFinite, n.rounded() == n, n >= 0, n < Double(Int.max) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid RPC id"))
            }
            return Int(n)
        }
        switch v["type"].string {
        case "hello": self = .hello(version: try integer("version"), macName: try required(v["macName"].string), state: try required(v["bridge"]["state"].string), token: try required(v["token"].string))
        case "trusted": self = .trusted
        case "bridgeStatus": self = .bridgeStatus(try required(v["state"].string))
        case "rpc": self = .rpc(id: try integer("id"), method: try required(v["method"].string), params: v["params"])
        case "rpcResult": self = .rpcResult(id: try integer("id"), result: v["result"])
        case "serverRequest": self = .serverRequest(id: try required(v["id"].isID ? v["id"] : nil), method: try required(v["method"].string), params: try required(v["params"].isObject ? v["params"] : nil))
        case "serverAnswer": self = .serverAnswer(id: try required(v["id"].isID ? v["id"] : nil), result: try required(v["result"].isObject ? v["result"] : nil))
        case "rpcError":
            let error = try JSONDecoder().decode(RPCError.self, from: JSONEncoder().encode(v["error"]))
            self = .rpcError(id: try integer("id"), error: error)
        case "notification": self = .notification(method: try required(v["notification"]["method"].string), params: v["notification"]["params"])
        case "ping": self = .ping(try required(v["t"].number))
        case "pong": self = .pong(try required(v["t"].number))
        default: self = .unknown
        }
    }
    public func encode(to encoder: Encoder) throws {
        var fields: [String: JSONValue]
        switch self {
        case let .hello(version, name, state, token): fields = ["type": .string("hello"), "version": .number(Double(version)), "macName": .string(name), "token": .string(token), "bridge": .object(["state": .string(state)])]
        case .trusted: fields = ["type": .string("trusted")]
        case .bridgeStatus(let state): fields = ["type": .string("bridgeStatus"), "state": .string(state)]
        case let .rpc(id, method, params): fields = ["type": .string("rpc"), "id": .number(Double(id)), "method": .string(method), "params": params]
        case let .rpcResult(id, result): fields = ["type": .string("rpcResult"), "id": .number(Double(id)), "result": result]
        case let .serverRequest(id, method, params): fields = ["type": .string("serverRequest"), "id": id, "method": .string(method), "params": params]
        case let .serverAnswer(id, result): fields = ["type": .string("serverAnswer"), "id": id, "result": result]
        case let .rpcError(id, error): fields = ["type": .string("rpcError"), "id": .number(Double(id)), "error": .object(["code": .number(Double(error.code)), "message": .string(error.message)])]
        case let .notification(method, params): fields = ["type": .string("notification"), "notification": .object(["method": .string(method), "params": params])]
        case .ping(let t): fields = ["type": .string("ping"), "t": .number(t)]
        case .pong(let t): fields = ["type": .string("pong"), "t": .number(t)]
        case .unknown: fields = ["type": .string("unknown")]
        }
        try JSONValue.object(fields).encode(to: encoder)
    }
}
