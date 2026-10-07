# Same-session regeneration on Windows

Regeneration and user-message editing keep the native session ID and JSONL file. The sidebar row and title stay unchanged. Previous answers remain in the native session tree and are selectable through the Answer branches control. Existing separate `(edited)` sessions are not removed or merged.

The app-server in omo 5.1.21 does not implement `thread/rollback` or expose command-context `navigateTree` through extension RPC handlers. A finite native RPC process performs `navigate_tree` instead. The app-server is fully stopped before ownership is transferred, and reconnected afterwards. All loaded threads are restored; navigation is rejected if any loaded thread is active. Transient transfer status is hidden from the renderer to avoid a stale history refresh.

The runtime's `select` semantics return to the selected user message's parent. The UI then submits its edited/original text and original images with the model and effort captured when clicked. No `thread/start`, renamed session or new JSONL file is involved. A bundled extension appends a non-conversation `omoui.tree.selection` entry after successful navigation so the selected leaf survives reopening. Runtime bindings appended on RPC startup are accepted by the expected-leaf guard only when they descend from the captured leaf without a conversation message in between.

Branch list reads are read-only and independent from the exclusive navigation lock. Cancellation and stale-leaf errors leave the visible branch intact. Actual dialog requests from RPC are rejected; fire-and-forget runtime status and notifications are allowed.

The IPC only opens session paths resolved within the connected omo agent's sessions directory. No user model prompt is sent by the tree-navigation process itself.

Windows packages ship the persistence extension as an external `resources/tree-selection-extension.js`, because the separate omo executable cannot load files inside Electron's ASAR archive.

## Verified on 2026-10-07

Typecheck and all 57 unit files / 752 tests passed. The same-session E2E passed with edit, two repeated regenerations, model/effort and image preservation, exactly one session JSONL/sidebar row, original answer selection and relaunch persistence. Desktop and 640px light/dark captures were inspected. Related async-question, session-notice and three theme-transition tests passed. Final Windows packaging exited 0.

The packaged win.5 app was connected to real omo 5.1.21 in an isolated HOME with a saved fixture, no model credentials and no generation request. Native navigation returned `outcome: navigated`; `thread/read` returned both original assistant messages, the sidebar retained one row, and selecting the alternative through the UI survived reload. The installed user app remained running and untouched. Actual model generation was covered through the fake-runtime integration test rather than a paid user session.

Installer: `release/OmO UI Windows Setup 0.1.4-win.5.exe` (113251766 bytes), SHA256 `519956AFA094B3693D96F6C38F0F1AA5E568F3DB35ABFBCD051E66B3E75AB1A4`.
