# Platform port design contract

## OpenCodex active catalog

Import replaces only OpenCodex's discovered model list with the actual `/v1/models` active catalog, including an empty catalog. It does not retain stale/disabled entries or synthesize routing aliases. Original IDs and advertised reasoning wire values stay unchanged. `owned_by` is retained in the native display name; namespaced routes group by routing provider, and OpenAI account namespaces form separate `openai / account` groups. An unavailable explicit choice stays selected and is labeled unavailable rather than silently displaying the active thread's different model.

## Managed native conversations

Left navigation contains explicitly managed main sessions, independent of creator evidence. Existing native sessions are searched by title, exact ID, or workspace in the inventory dialog. A nonempty search automatically loads remaining inventory pages and shows search progress; no-match is only shown after full coverage. Empty search retains manual load-more browsing. A failed page stops automatic loading and allows an explicit load-more retry. Adding/removing stores only managedThreadIds, never copies or deletes a conversation. New UI main sessions are included automatically. Creator badges and manual origin classification remain independent. The center opens the original conversation; the right panel retains confirmed native agent links, task records, and return-to-main behavior. Unknown historic creators remain unknown. This replaces the prior standalone automation/unknown sidebar sections: those sessions are available in inventory and appear on the left only when explicitly managed.

## Parent-owned sidebar work

Verified native child sessions and task work belong in the selected main session's right agent panel. Left navigation highlights the main session while a child conversation is open. Selecting a saved agent opens its existing conversation and native turn execution logs in the center; an explicit return-to-main action retains the right roster. Task-only agents show recorded result and execution log in the panel without starting a session. Only task IDs or native parent-header links establish agent ownership; manual related conversations are not reclassified as agents. The existing AppFrame dock/overlay breakpoint and panel style tokens own narrow layout. The panel can close and reopen from the conversation header. Unparented automation sessions remain available in native inventory.

Creator classification uses structured native provenance or recorded automation client IDs, never a title guess. It is displayed in inventory and managed rows, independently of management. Session menus offer explicit user/Dori/agent/unknown classification for missing provenance or a correction; overrides persist in preferences, not session content. Unknown sessions stay accessible in native inventory. Existing row, focus, and settled-section primitives remain in use.

Confirmed native parent/child task links and explicitly related sessions appear beneath their main session in a collapsible group. Child tasks with no standalone session remain visible as status rows; saved child sessions open their original conversation. Session files, IDs and cwd are never rewritten. Ordinary sessions are not assigned by title or path guesses; their menu can create a related session or explicitly attach/detach one. Existing settle preferences remain intact. Child search/running filters keep the parent reachable.

This Windows port preserves the upstream design system documented in `src/ui/README.md`, `src/dsh/README.md`, and `src/ui/theme/omo-theme.css`. It is not a visual redesign. Existing typography, spacing, colors, sidebar, composer, conversation, and theme tokens remain the source of truth.

## Windows shell

## Composer add menu

The supplied Codex screenshot defines the interaction and grouping: a round plus trigger, an elevated menu above the composer, an Add heading, file/folder context, explicit terminal text attachment, goal, plan, sketch, then installed skills. Reuse existing Menu keyboard navigation, theme surfaces and focus tokens rather than copying Codex branding. The menu owns scrolling and fits desktop and 640px widths. Context chips remain removable and scoped to each conversation draft. Files and folders are references, not uploaded or eagerly read. Terminal content is explicitly pasted by the user, never scraped from another running process. Sketches become ordinary PNG attachments. Show actual installed skill names and descriptions; do not advertise uninstalled Exa/GitHub/Documents/PDF plugins. Goal and plan controls must connect to supported native behavior, not cosmetic toggles. The installed user app is never used for verification.

## Workflow reference additions

### Workflow / agent conversation separation

The workflow inspector has three exclusive views: Graph, Agents, and Activity. Graph contains only native DAG runs and dependency nodes; ordinary task ownership never implies dependency edges. Selecting a node keeps the main conversation unchanged and shows compact status/dependency metadata only. Agents contains the actual task roster, native ownership hierarchy, result and todo details, with explicit conversation navigation only when an existing child session is available. Activity contains observed transitions independently of the other views and stays mounted while hidden so switching tabs does not discard captured events.

The left sidebar's related-conversation count and rows contain existing child conversations only, never task-only records. Native task links remain available for status, search, ownership and the Agents view. No inspection action creates or resumes a child session. Existing theme controls and tokens define tabs, focus, empty and stale states; the inspector body owns vertical scroll at desktop and narrow overlay widths. Actual native workflow provenance, not title similarity, determines any execution grouping.

### Selected macOS 0.1.5 additions

Keep the existing Windows graph and node details. Workflow width modes request 580px (normal), 720px (wide), and 840px (maximized), clamped by AppFrame with the existing 520px conversation floor and overlay behavior. Header size controls are labeled buttons with pressed state. The workflow body owns scrolling; a collapsible Activity section records at most 50 observed state changes scoped to the selected thread/run, never fabricated historical events. First snapshots establish a baseline. Switching threads does not mix logs.

Turn subagent rosters use native task provenance where available; timestamps may attribute a task only to a single unambiguous recorded turn in the same parent thread. Missing timestamps are excluded; valid windows remain eligible after history hydration. Overlapping turn windows must not duplicate ownership. Original Work Log filtering remains, with memory receipts and interactive requests visible. A completed answer gains a labeled copy button and its recorded completion clock time; missing time remains omitted, never replaced with the current time. No local-only rating controls are introduced. Sidebar elapsed time is shown only from a known active turn start, with timers confined to running rows. Existing 12/24-hour preference, locale and theme tokens apply. Selected reasoning is visible on its trigger; side-chat outcomes do not trigger independent thread notifications.

User's running installed app remains untouched. Verification launches isolated fixture profiles only; no installation, app quit, paid generation or publication is part of this increment.

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
