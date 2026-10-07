# Composer add menu

The plus button groups attachments and native workflows above the composer. Keyboard navigation, Escape and focus restoration reuse the shared Menu primitive. The installed user app is not needed for testing.

## Attachments

- Files: native multi-selection accepts any file format. Supported images use the existing image attachment pipeline; other files are local path references that the agent can inspect with tools.
- Folder: native folder selection adds a local reference. The app does not recursively load the folder.
- Terminal: paste copied output into a reviewable dialog, or explicitly read clipboard text with the paste button. This does not read or control existing Windows Terminal tabs.
- Sketch: draw on a white 960x540 canvas, undo, erase or clear, then attach a PNG through the existing image pipeline.

Context references are deduplicated, capped at ten per message and kept separately for each conversation draft. Sent references and terminal text appear as expandable context in the user message. Image attachments retain their existing independent ten-image limit.

## Workflows

- Goal: stage the objective in the composer. Only Send persists it using `thread/goal/set`, first paused, then active after the contextual message is accepted. This prevents goal activation from launching an idle thread before its attachments arrive. Native `thread/goal/updated` notifications drive the existing goal display. A paused goal remains persisted if sending fails, so the user can retry.
  If activation fails after the message is accepted, the error is shown and the persisted goal remains paused. Reattach the goal through Add and send a follow-up to activate it.
- Plan: available only when `ulw-plan` is installed. The next request invokes `/skill:ulw-plan`. This is the native ULW planning workflow, not a sandbox permission toggle. The workflow may remain active in that session; implementation is explicitly requested through `ulw-execute`. Removing the composer chip only removes the selection from the next request.
- Installed skills: the actual enabled catalog is loaded for the active workspace. Selection reuses existing skill chips and `/skill:name` serialization. No uninstalled Codex marketplace plugins are advertised.

## Validation

`e2e/add-menu.spec.ts` checks references, per-conversation draft isolation, goal request ordering, installed skill selection, the planning request, PNG output and keyboard dismissal. Desktop and 640px screenshots use real appearance controls for Korean and paired light/dark themes. `tests/conversation/context-draft.test.ts` checks the machine-consumed context JSON and reference limits.
