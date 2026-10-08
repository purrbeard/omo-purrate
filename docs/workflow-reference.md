# Windows workflow reference integration

## Graph / agent / activity separation

The inspector provides exclusive Graph, Agents, and Activity views. Graph renders actual native DAG runs only; standalone tasks never imply dependency edges. Node selection shows compact identity, state, and dependency metadata without switching the main conversation. Agents contains task results, todo checkpoints, and native ownership trees. Ordinary tasks are grouped by the spawning request, preferring the active-branch structured spawn receipt's turn ID and otherwise requiring one recorded timestamp window. Missing or ambiguous provenance is shown as unassigned history rather than guessed.

Only existing child conversations appear in the sidebar's child-conversation count. Task-only records remain in Agents and status/search data. View conversation only opens a known child thread; it never creates one or starts generation. Activity observes standalone native tasks as well as DAG nodes; initial snapshots and reconnects establish baselines. The observer remains mounted across inspector view switches to retain captured transitions.

Approved reference: `C:/Users/truek/Downloads/Programs/workflow-reveal-dark-1440.mp4`, 13 seconds, 1440x900, 25fps. The video contains mock tool execution, so visual behavior is implemented using actual native runtime state instead of copying its mock counts or timings.

The six approved elements are a right workflow inspector, graph/list views, state/wave/time summaries, a persistent background-task strip above the composer, mass-ulw input guidance and a collapsed per-turn Work Log. Existing theme tokens including SBD, session trees and explicit parent relationships remain authoritative.

## Selected macOS 0.1.5 additions (win.8)

Source comparison: https://github.com/realsigridjin/omo-ui-macosapp/commit/fe621755c16a7e0d3a40bdd1bd4951f804780410. The approved additions are panel width controls (normal580/wide720/maximized840 pixels, constrained to preserve conversation space), an observed DAG transition log (50 newest entries), a per-turn native task roster, completed answer copy and recorded completion time, selected reasoning on its trigger, side-chat result notification exclusion and sidebar running elapsed time.

The log starts with a baseline rather than emitting invented history; it records only state changes seen live while this thread's panel is mounted. Reconnect snapshots and reused node IDs in another run do not fabricate transitions. Closing the panel clears its observation history. Only same-parent native tasks with one unambiguous recorded turn window are attributed to a turn; missing timestamps, timestamp-less historical tasks, overlapping windows and shared boundaries are omitted from the roster. Valid recorded windows remain eligible after history hydration. Tasks with unknown ownership remain accessible through the parent workflow/activity panel. Unknown running start times show Working, without an invented elapsed clock. Copy uses the Electron clipboard bridge; unknown answer time is omitted. System/12-hour/24-hour and locale preferences apply.

Local-only thumbs-up/down and the upstream Stop label were not copied. Stop in upstream calls the main turn interrupt and does not cancel child work, so existing Windows controls remain. This increment is validated using isolated profiles only: the running installed user app is not opened, controlled, restarted or upgraded. No commit, push, release publication or local installation is performed.

### win.8 verification

Full renderer/main/E2E typecheck passed. The unit suite passed 61 files and 778 tests before the final recorded-clock regression; after that fix the related helper suite passed 7 tests and the workflow/turn-log Electron suite passed 4 tests. The main selected-additions/preservation run passed 19 Electron tests across workflow, work-log, selected-status, composer-bar, side chat, async questions and related sessions. Desktop and 640px light/dark screenshots were inspected, including completed native task rosters and long Korean task titles. The native fixture profile connected to omo5.1.22 with one fixture session, one parent link and one stored task; no paid generation was used. Native wire turn timestamps have second precision, so roster comparisons use that same precision when both turn endpoints are second-aligned and still require exactly one owner.

The P: output build hit a filesystem rename EPERM and was retained. Packaging uses a separate C: local output instead; no installed-app files are used or replaced.

Final installer: `release/OmO UI Windows Setup 0.1.4-win.8.exe`, 113254091 bytes, SHA256 `5A8AAEA1A50F7107D5BEF322E979E1257A16739482F42D1B060CC26D7E16A4E9`. Final packaging exited0. The final unpacked build was launched and closed only under the isolated native profile, reported win.8 and omo5.1.22, and rendered the stored parent-owned task in Korean/SBD with size controls and answer copy. The fixture has no model credentials and displays pre-existing unavailable-model-profile notices; no generation was attempted.

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
