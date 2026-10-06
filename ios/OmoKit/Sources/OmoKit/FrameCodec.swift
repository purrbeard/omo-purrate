import Foundation

public struct FrameCodec {
    public static let maximumLength = 8 * 1024 * 1024
    public enum Failure: Error, Equatable { case oversizedFrame }
    private var buffer = Data()
    public init() {}

    public static func encode(_ message: BridgeMessage) throws -> Data {
        let body = try JSONEncoder().encode(message)
        guard body.count <= maximumLength else { throw Failure.oversizedFrame }
        let n = UInt32(body.count)
        var data = Data([UInt8((n >> 24) & 255), UInt8((n >> 16) & 255), UInt8((n >> 8) & 255), UInt8(n & 255)])
        data.append(body)
        return data
    }

    /// Retains partial headers/bodies. Any malformed or oversized frame is fatal to the stream.
    public mutating func append(_ data: Data) throws -> [BridgeMessage] {
        buffer.append(data)
        var messages: [BridgeMessage] = []
        var offset = 0
        while buffer.count - offset >= 4 {
            let start = buffer.startIndex + offset
            let length = (0..<4).reduce(0) { ($0 << 8) | Int(buffer[start + $1]) }
            guard length <= Self.maximumLength else { buffer.removeAll(); throw Failure.oversizedFrame }
            guard buffer.count - offset - 4 >= length else { break }
            let body = buffer.subdata(in: (start + 4)..<(start + 4 + length))
            messages.append(try JSONDecoder().decode(BridgeMessage.self, from: body))
            offset += length + 4
        }
        if offset > 0 { buffer.removeFirst(offset) }
        return messages
    }
}
