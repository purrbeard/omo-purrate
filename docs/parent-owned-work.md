# Parent-owned work on Windows

## Upstream comparison

The latest upstream commit checked on 2026-10-07 was `78d0ef277c56325b6609887cc02c3f99be648652` (the exact upstream source is the local `upstream-78d0ef2` checkout and GitHub commit below).

Upstream groups main threads by cwd in `src/state/selectors.ts`. Only BTW side chats are excluded. `ActivityPanel` and `taskForest` display task ownership inside the main conversation using `child_session_id -> parent_session_id`, rather than DAG dependency or numeric depth. Upstream does not nest task session rows under the main sidebar row and does not persist ownership for ordinary related sessions.

Source: https://github.com/realsigridjin/omo-ui-macosapp/commit/78d0ef277c56325b6609887cc02c3f99be648652

## Windows behavior

The sidebar resolves native task records from the connected agent directory. Empty legacy `.omo/senpi-task` scaffolding no longer masks the real `agent/projects/<name>-<sha256-prefix>/senpi-task` store. Real legacy records and the native adoption marker remain authoritative, following omo 5.1.21's storage contract.

Confirmed children appear once under the listed parent. In-process tasks without their own session appear as title/status rows. A parent absent from the loaded list does not hide the child. Cycles are rejected or ignored without losing sessions. Live task updates refresh ownership and status; running children keep their parent out of Settled. Search considers children while retaining their parent.

The session menu offers New related session, Attach to current session, and Detach related session. Explicit relationships are stored as `preferences.threadParents`; creation records ownership before opening the new child. No session JSONL, ID or cwd is rewritten. Existing ordinary sessions are not assigned from names, paths or timestamps. A tool that creates an ordinary native session outside the app needs an explicit relationship before the app can nest it; automatic parent inference is not available in the native thread-list contract.

Windows artifact: `release/OmO UI Windows Setup 0.1.4-win.6.exe`, 113246487 bytes, SHA256 `239C001EEBA3004305CFACC5CCAD9BEB0D937E3EAF70FD7511DC4A5931861E54`.

Verification: typecheck; 57 unit files / 758 tests; 15 related-session, sidebar, live-work and BTW E2E tests; desktop and 640px light/dark screenshots. Actual win.6 package connected to real omo 5.1.21 using an isolated saved fixture and loaded both ownership index and native activity work. No paid prompt, installed-user-app shutdown, commit or push was performed.
