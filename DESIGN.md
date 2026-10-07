# Platform port design contract

## Parent-owned sidebar work

Confirmed native parent/child task links and explicitly related sessions appear beneath their main session in a collapsible group. Child tasks with no standalone session remain visible as status rows; saved child sessions open their original conversation. Session files, IDs and cwd are never rewritten. Ordinary sessions are not assigned by title or path guesses; their menu can create a related session or explicitly attach/detach one. Existing settle preferences remain intact. Child search/running filters keep the parent reachable.

This Windows port preserves the upstream design system documented in `src/ui/README.md`, `src/dsh/README.md`, and `src/ui/theme/omo-theme.css`. It is not a visual redesign. Existing typography, spacing, colors, sidebar, composer, conversation, and theme tokens remain the source of truth.

## Windows shell

## Workflow reference additions

The approved workflow-reveal video contributes six behaviors: right workflow inspector, list/graph views of real dependencies, status/wave/time summaries, persistent background-work strip, mass-ulw input guidance, and collapsed per-turn work log. Preserve existing theme tokens and native parent relationships. No new session is created by viewing work. The existing AppFrame right-panel slot owns docked versus overlay placement; workflow, files and side chat are mutually selected, retaining their existing data. The panel header stays fixed and its body owns vertical scrolling. On narrow windows use the existing accessible overlay shell, with close and focus restoration.

Graph primitives are dependency columns, compact status cards, curved SVG edges and a keyboard-operable zoom/fit toolbar. Use theme surface/border/text/status tokens and existing StateDot semantics. Graph geometry uses 200px cards, 48px column gaps and 100px row pitch; the horizontal canvas alone owns graph overflow. Fit preserves at least 75% scale for readable cards, with horizontal panning for wide graphs and optional manual smaller zoom. Workflow docks only when at least 520px remains for conversation after its preferred width, avoiding crowded header controls. Unknown or cyclic relationships remain inspectable; ordinary tasks are lists, never fabricated graphs. Node details reuse WorkRow including prompt, activity, result and child todos. Panel/list choices do not change backend execution. Counts deduplicate linked DAG/task records and never call restored or detached children actively running.

The background-work strip belongs above the composer and uses live work counts independently of the main turn. Its button opens the workflow inspector; only supported main-turn stop remains. The mass-ulw hint uses existing keyword-border treatment without changing submitted text. Each turn's native tool/task activity is grouped into a collapsed Work Log, retaining existing tool detail controls and duration. It never assigns unrelated tasks to a turn by guessing time or title.

Use existing typography, 8/12/16px spacing rhythm, 8px control radii and 1px borders. Selected controls use existing active-surface tokens, statuses include words as well as color, and all controls have visible keyboard focus. Motion is limited to existing short color/opacity transitions; reduced motion disables transition and no graph-layout tween is required. Verify desktop and narrow light/dark, Korean long titles, terminal/error/stale/empty work, same-thread follow-up with a running child, and existing files/side-chat transitions.

## Screenshot additions

The supplied dark conversation reference establishes three columns: project/thread navigation, conversation and composer, then a read-only file inspector with file tabs and searchable workspace files. Native Windows title-bar controls remain above the content. The light settings reference establishes full-window navigation, section search, breadcrumbs and bottom Back action. Existing functional sections remain; unsupported cloud plan/sync controls are not fabricated. The project reference establishes a centered chooser using real thread workspaces and recent folders, with New project and Continue actions. The device overview uses the current PC and actual Android connection plus local Git memory status; no example quotas, cloud encryption claims or simulated remote devices.

- Use the native Windows title bar and system minimize, maximize, and close controls.
- Use an opaque window background; macOS alone keeps vibrancy and traffic lights.
- Preserve existing narrow-layout behavior and light/dark theme selection.
- Use Ctrl+E for side chat on Windows and Command+E on macOS.
- Label the file-manager target Explorer on Windows while preserving existing IPC IDs.
- Explain that iPhone USB is unsupported on Windows and do not start usbmux retries there.

## Verification

Each native model route has a provider-grouped available-model select above its text editor. Selecting appends a unique fallback for agents/categories and replaces the single mapping target. Direct text editing remains available, with controlled drafts preserving multiline input.

Editing and regeneration keep the session ID, file and sidebar row. Alternative answers live in the native session tree; no automatic renamed session is created. Existing answers remain reachable through an inline, labeled branch select that reuses the app's menu/select tokens and keyboard focus. Navigation is disabled while a turn or navigation is pending, with cancellation and error leaving the previous branch visible. Existing edited sessions are retained as independent sessions. The composer model and effort selected at click time are used for regeneration.

MCP exposes separate existing-configuration discovery and manual file import buttons. Saved servers that have no loaded session status appear as configured, never as connected. Model role editors reuse labeled native selects, existing cards and explicit save-and-reconnect actions; account keys and arbitrary runtime configuration are never sent to the renderer.

About includes a separate Windows app update card using SettingRow and existing Buttons. Manual check, unpublished, current, available, downloading progress, verified, installing and error states are explicit. The install action explains that the app closes for the Windows installer and is disabled during active turns. No installation occurs on a background check.

Profile model overrides reuse the composer model picker and native labeled select controls. MCP import uses the existing settings toolbar button, with importing, success, cancellation and error states. opencodex accounts are a read-only provider card, never showing credential values or offering unsupported pin/remove actions. Android replaces the iPhone navigation item and uses existing card, facts, Button and input styles; device discovery is manual, connection requires choosing a ready device, and disconnect is explicit. Android's browser surface uses readable responsive text, labeled controls, keyboard focus, and safe text rendering for model output.

The omo settings section includes an opencodex card using the existing SettingRow, Button and card styles. Endpoint and password inputs keep the stored key out of IPC responses. Applying explicitly states that omo reconnects. Loading, applying, success model count and failure are visible states.

Drive the real Electron application, not a static replica. Check light/dark desktop and narrow windows, side chat, settings, native window controls, keyboard navigation, and Korean text for overlap or clipping. Existing Playwright screenshots and scenarios are reused.
