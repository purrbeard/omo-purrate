# Windows workflow reference integration

Approved reference: `C:/Users/truek/Downloads/Programs/workflow-reveal-dark-1440.mp4`, 13 seconds, 1440x900, 25fps. The video contains mock tool execution, so visual behavior is implemented using actual native runtime state instead of copying its mock counts or timings.

The six approved elements are a right workflow inspector, graph/list views, state/wave/time summaries, a persistent background-task strip above the composer, mass-ulw input guidance and a collapsed per-turn Work Log. Existing theme tokens including SBD, session trees and explicit parent relationships remain authoritative.

## Data and interaction

The workflow inspector uses the existing AppFrame right-panel slot. Files, workflow and side chat select the same slot rather than stacking independent panels. Narrow windows use the existing overlay placement. Escape and the close button close workflow; overlay focus stays inside the inspector and restores when it closes. The inspector retains graph/list selection while its selected thread changes.

Graphs use native DAG nodes and their actual dependency edges. Ordinary child tasks stay in their list rather than receiving inferred edges. A graph node opens existing task details, including prompt, progress and result. Counts deduplicate tasks already referenced by DAG nodes. Persisted, detached, restored and suspended task records do not count as actively executing merely because the parent connection is live.

Fit preserves at least 75% card size and pans horizontally for large graphs instead of shrinking text to an unreadable thumbnail. Workflow switches to overlay when its preferred width would leave less than 520px for the conversation. This was adjusted after inspecting actual desktop and narrow captures.

The background strip depends on child-work state, not on the main turn's working indicator. It can remain visible after a main response completes and during another message in the same conversation. Its action opens the inspector. No unsupported child-cancellation action is exposed; supported main-turn interruption is unchanged.

Whole-token `mass ulw`, `mass-ulw` and `/mass-ulw` prefixes get a localized composer hint and the existing keyword emphasis. Submitted text is not rewritten. Work Logs group real tool/reasoning items from their own turn into native details, initially collapsed. User messages, final answers, errors and interactive requests remain accessible. Expand a log to use the existing tool detail controls.

Memory-write receipts remain visible outside the collapsed Work Log, preserving the existing Remembered card. Error summaries in a collapsed Work Log remain visible, with full tool content available on expansion.

## Verification

`e2e/workflow.spec.ts` uses event-driven fake-runtime advancement to finish a main response while a DAG continues. It exercises a same-thread follow-up, real fixture edges and node details, default-collapsed tool work, preserved raw input, terminal strip removal, graph/list placement, file-panel switching and desktop/narrow light/dark captures. No fixed sleeps or paid user-conversation requests are needed.

Pure dependency geometry, keyword serialization and activity-summary regressions belong beside their existing unit tests. Existing DAG, live activity, fake tool-history and parent-ownership E2E assertions are updated only where the new inspector or collapsed work log changes how users reach their details.

Verified on 2026-10-07:

- Typecheck passed. Full Vitest suite: 59 files / 770 tests passed, exit 0. Graph geometry includes seven tests and keyword handling includes nine tests.
- Final related Electron run: workflow, DAG, three live-state/relaunch tests and memory/session notices, six passed. Additional final workflow run including zoom/fit and arrow navigation passed. Earlier unchanged related tests passed: async questions, fake approval/question/interruption/history/theme behavior, parent ownership, real workspace files.
- Inspected graph/list desktop (1440x900) and narrow (640x760) screenshots in both light and dark. Evidence: `test-results/evidence/workflow-{light,dark}-{desktop,narrow}-{graph,list}.png`.
- Final packaged app reports 0.1.4-win.7 / Electron 44.5.1, connected to actual omo 5.1.21 in the pre-existing isolated native fixture HOME. Existing one session and one native-owned completed task remain available, no running strip for restored completed work, Korean SBD preserved. Native detail and mass-ulw hint inspected without sending a paid model request. QA app closed; installed user app not replaced.
- Vite and Electron builds and NSIS package exited 0. Existing Vite large-chunk advisory remains. Direct Electron extraction hit Windows EPERM on directory rename; package used the already extracted Electron files through `--config.electronDist` and a separate final output folder, with no runtime change or deletion.
- CSS LSP was unavailable because Biome is not installed; no dependency was added. TypeScript LSP, typecheck, build and rendered screenshots cover the changes. `git diff --check` passed.

Installer: `release/workflow-win7-final/OmO UI Windows Setup 0.1.4-win.7.exe`, 113335419 bytes. SHA256: `713A8272037AF0E3944ED666D4A9B6357A5C9BF04F4A9C0C88E90CFDAD307968`.
