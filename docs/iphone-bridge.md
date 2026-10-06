# iPhone bridge protocol

OmO for iPhone controls omo on the Mac over the USB cable. No Wi-Fi or Bluetooth is involved: the Mac reaches the phone through Apple's USB multiplexer daemon (`/var/run/usbmuxd`), the same channel Xcode and Finder use.

## Roles

- **iPhone app** listens on TCP port **47101** on the device (loopback-reachable only through usbmux; it does not need the local network permission).
- **OmO UI on the Mac** watches usbmuxd for attached iPhones and opens a connection to device port 47101 on each attached device. While OmO UI runs and its omo app-server is connected, the phone talks to that omo through the Mac.

## usbmuxd (Mac side)

Every usbmuxd packet is a 16-byte little-endian header `length` (header + body), `version` = 1, `message` = 8 (plist), `tag`, followed by an XML plist body.

- `Listen`: `{MessageType: "Listen", ClientVersionString, ProgName}`. usbmuxd answers `Result` (`Number` 0 = ok), then sends `Attached` (`DeviceID`, `Properties.ConnectionType` = `USB`, `Properties.SerialNumber`) and `Detached` (`DeviceID`) messages on the same socket.
- `Connect`: on a new socket, `{MessageType: "Connect", DeviceID, PortNumber, ...}` where `PortNumber` is the port in network byte order stored as an integer (47101 → `htons(47101)` = 64951). After `Result` 0 the socket is a raw byte stream to the phone.

Only `ConnectionType` `USB` devices are used. A failed connect (the app is not running) is retried every 2 seconds while the device stays attached.

## Frames (both directions)

Each frame is a 4-byte big-endian unsigned length followed by that many bytes of UTF-8 JSON. Frames over 8 MiB close the connection.

A frame that is not a JSON object closes the connection. A JSON object whose `type` the receiver does not know is ignored and the connection stays open, so either side can add frame types without breaking an older peer. On the Mac, an `rpc` frame without a finite numeric `id` still closes the connection.

| Direction | Frame |
|---|---|
| Mac → phone | `{"type":"hello","version":1,"macName":string,"token":string,"bridge":{"state":string}}` first, after the stream opens |
| phone → Mac | `{"type":"trusted"}` after authentication; the Mac replays current bridge status and pending server requests |
| Mac → phone | `{"type":"bridgeStatus","state":"connected"\|"starting"\|"restarting"\|"failed"\|...}` when omo's state changes |
| phone → Mac | `{"type":"rpc","id":number,"method":string,"params":object}` |
| Mac → phone | `{"type":"rpcResult","id":number,"result":any}` or `{"type":"rpcError","id":number,"error":{"code":number,"message":string}}` |
| Mac → phone | `{"type":"notification","notification":{"method":string,"params":object}}` for every omo app-server notification |
| Mac → phone | `{"type":"serverRequest","id":number\|string,"method":string,"params":object}` for every omo server request (approvals, questions); requests still waiting when the phone connects are sent right after `bridgeStatus` |
| phone → Mac | `{"type":"serverAnswer","id":number\|string,"result":object}` answers the server request with the same `id`; the Mac passes `result` to omo unchanged |
| either | `{"type":"ping","t":number}` / `{"type":"pong","t":number}` every 10 s; a side that hears nothing for 30 s closes the stream |

## Mac trust

The Mac generates a random 32-byte token once and sends its 64-character lowercase hexadecimal encoding in every `hello`. It persists the token in `iphone-token.json` under Electron's `userData` directory with mode `0600`. Invalid stored tokens fail startup rather than changing the installation's identity.

The phone saves the first valid version-1 hello's `(macName, token)` pair in UserDefaults. A later hello with that token authenticates the stream and updates the displayed Mac name. A different token leaves the stream unauthenticated and asks “Trust this Mac?” with the candidate Mac's name. Trust replaces the saved pair; Not now closes the candidate stream. Missing or malformed tokens cannot establish trust.

Before authentication, the phone drops every frame except `hello`, `ping`, and `pong`, and sends no RPC or server answer on that stream. A new connection cannot replace a live authenticated connection until its hello authenticates or the user explicitly trusts it. The phone header names the trusted Mac even while disconnected.

The phone confirms authentication with `trusted`. The Mac then replays current bridge status and pending server requests, including requests the phone dropped while waiting for trust approval.

Mac Settings > iPhone shows each attached device's serial and whether a `serverRequest` forwarded to that connected phone is still unanswered. Answering, `serverRequest/resolved`, and omo leaving its connected state clear the pending status.

## Allowed methods

The Mac forwards only: `thread/list`, `thread/start`, `thread/resume`, `thread/read`, `thread/goal/get`, `thread/name/set`, `thread/delete`, `thread/archive`, `turn/start`, `turn/steer`, `turn/interrupt`, `model/list`, `skills/list`. Anything else gets `rpcError` code -32601 without reaching omo.

## Server requests

omo's server requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`) reach every connected phone as `serverRequest` frames while the Mac window shows them too. Whichever side answers first wins: the Mac forwards a `serverAnswer` only while the request is still pending, and drops it once omo sends `serverRequest/resolved` for that id (also forwarded to the phone as a notification), once another answer was delivered, or when omo restarts. An answer whose `id` is not pending or whose `result` is not an object is ignored without a reply; there is no error frame for answers.

## Input rules

omo 5.1.4 rejects `image`, `localImage`, `skill` and `mention` input items; the phone sends text items only.
