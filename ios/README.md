# OmO for iPhone

OmO for iPhone controls the omo running on your Mac over a USB cable. You can browse every session, read streamed replies, send or steer a turn, stop it, and answer omo's approvals and questions from the phone. omo, its sessions and its credentials stay on the Mac; the phone only shows them.

The app is a SwiftUI iOS 17 app with bundle ID `com.sigridjineth.omoui.ios`. It follows the system light or dark appearance and speaks English and Korean.

## How it connects

The app listens on device port 47101, and that port is reachable only through usbmux over the USB cable. There's no Wi-Fi, no Bluetooth, no local-network permission and no internet connection from the app. While OmO UI runs on the Mac, it notices the plugged-in iPhone and connects automatically. Settings > iPhone in OmO UI shows the connection state and the device.

The wire protocol is documented in [docs/iphone-bridge.md](../docs/iphone-bridge.md).

## Requirements

- A Mac with full Xcode installed. Command Line Tools alone can't build the app or run its tests.
- An iPhone on iOS 17 or later and a USB cable.
- An Apple ID signed in to Xcode (Xcode > Settings > Accounts). A free personal team works.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) to generate the Xcode project.
- OmO UI installed and running on the Mac.

## Build

```sh
brew install xcodegen
cd ios
xcodegen generate
xcodebuild -project OmoRemote.xcodeproj -scheme OmoRemote \
  -destination 'generic/platform=iOS' -configuration Debug \
  -derivedDataPath DerivedData -allowProvisioningUpdates build
```

`project.yml` is the source of truth for the project, so run `xcodegen generate` again after editing it. The signing team `27XSGM7GF9` is preset there as `DEVELOPMENT_TEAM`. If you sign with a different Apple ID, change `DEVELOPMENT_TEAM` in `project.yml` to your team ID (Xcode shows it under Signing & Capabilities) and regenerate, or pass `DEVELOPMENT_TEAM=<your team ID>` to `xcodebuild`. `-allowProvisioningUpdates` lets Xcode create or refresh the provisioning profile for the connected device.

The built app lands at `ios/DerivedData/Build/Products/Debug-iphoneos/OmoRemote.app`. `DerivedData/` is ignored by git.

## Install and launch

Connect the iPhone with the cable, unlock it, and tap Trust if it asks about this computer. Then find its UDID and install:

```sh
xcrun devicectl list devices
xcrun devicectl device install app --device <UDID> \
  DerivedData/Build/Products/Debug-iphoneos/OmoRemote.app
xcrun devicectl device process launch --device <UDID> com.sigridjineth.omoui.ios
```

Run these from `ios/`, or give the full path to `OmoRemote.app`. You can also open the app from its home screen icon, named OmO.

### First launch on the phone

iOS blocks development apps until you allow them. Do this once per device:

1. Enable Developer Mode: Settings > Privacy & Security > Developer Mode, turn it on, and let the phone restart. Confirm the prompt after it boots.
2. Trust the developer: Settings > General > VPN & Device Management, pick your Apple ID under Developer App, and tap Trust.

Launch the app again after both steps.

### Renewing every 7 days

Apps signed with a free personal team expire after 7 days, and iOS then refuses to open them. Build and install again to renew. A paid Apple Developer Program team gives profiles that last much longer.

## Using it

1. Start OmO UI on the Mac.
2. Connect the iPhone with the cable and open OmO on the phone.
3. The phone leaves its waiting screen once the Mac connects. Settings > iPhone on the Mac shows the same link.

From there you can:

- browse every omo session, grouped by workspace, and open one to read its history;
- start a new session in a recent workspace;
- send a message, steer a running turn, or stop it;
- allow or deny commands and file changes, and answer omo's questions. The Mac shows the same request, and whichever side answers first wins.

Input is text only. omo rejects image input items, so the phone has no way to attach pictures.

### Keep the app open

iOS suspends the app when it goes to the background or the phone locks, and the link drops. Keep OmO open on screen while you use it. The screen stays awake while the phone is linked, so it won't auto-lock in the middle of a turn. If you switch away or the cable comes out, the app returns to the waiting screen and reconnects when you reopen it or plug the cable back in. omo keeps working on the Mac the whole time.

### Turning the bridge off

The Mac side of the bridge is on by default. Start OmO UI with `OMO_UI_IPHONE_BRIDGE=0` to disable it.

## Troubleshooting

- **The phone stays on the waiting screen.** Check that OmO UI is running, the cable is a data cable, the phone is unlocked and trusts this Mac, and OmO is in the foreground. Settings > iPhone on the Mac tells you whether it sees the device.
- **"Untrusted Developer" or the app won't open.** Repeat the trust step under VPN & Device Management. If it worked before, the 7-day profile probably expired, so reinstall.
- **`devicectl` says Developer Mode is off.** Enable it as described above and restart the phone.
- **Signing fails in `xcodebuild`.** Make sure your Apple ID is in Xcode's accounts and `DEVELOPMENT_TEAM` matches its team.

## Screenshots from the Mac

With [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) installed and the phone connected in Developer Mode:

```sh
pymobiledevice3 developer dvt screenshot out.png
```

## Tests

```sh
cd ios/OmoKit
swift test
```

These need full Xcode, because Command Line Tools ship without XCTest. If `xcode-select -p` points at Command Line Tools, set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for the command. The tests cover the OmoKit package and need no simulator or device.

`ios/Validation/ListenerSmoke.swift` is a smaller check of the real Network.framework listener on the Mac itself. From `ios/`, after `swift build` in `OmoKit`:

```sh
swiftc -parse-as-library -I OmoKit/.build/arm64-apple-macosx/debug \
  OmoRemote/USBListener.swift Validation/ListenerSmoke.swift \
  OmoKit/.build/arm64-apple-macosx/debug/OmoKit.build/*.o \
  -o OmoKit/.build/listener-smoke
OmoKit/.build/listener-smoke
```

It exercises loopback ping and pong and connection replacement, and briefly reserves localhost port 47101. It doesn't replace the tests or a real cable run.

## Code layout

- `OmoKit` is a dependency-free Swift package (iOS 17, macOS 13). `FrameCodec` decodes 4-byte big-endian length-prefixed UTF-8 JSON frames and rejects frames over 8 MiB. `BridgeMessage` and `JSONValue` model the bridge messages and ignore unknown frame types. `RPCClient` assigns request IDs and handles cancellation, deadlines and disconnect cleanup over an injectable `BridgeTransport`. `ConversationStore` turns omo's threads, turns, items and streamed deltas into the conversation the app shows, and picks `turn/steer` while a turn runs and `turn/start` otherwise.
- `OmoRemote` holds the SwiftUI views and the listener. The listener binds loopback IPv4 and IPv6 on TCP 47101, which usbmux forwards from the Mac. A new Mac connection replaces the old one. It pings every 10 seconds and drops the link after 30 seconds without data, rejecting calls still waiting.
- `project.yml` generates `OmoRemote.xcodeproj` with XcodeGen.
