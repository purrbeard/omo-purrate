# Upstream integration, 2026-10-07

Source: realsigridjin/omo-ui-macosapp main at `78d0ef2` (0.1.4), compared against common base `2e26bec` (0.1.3). The Windows fork remains independently identified as `0.1.4-win.4`; this local build is not a published upstream release.

Portable features integrated:

- Composer checkout/branch status, separate reasoning picker, workspace permission presets, commit/push dialog and header side-chat toggle.
- Thread outcome notifications, in-app Open actions, 12/24-hour formatting, manual settle/unsettle and inactivity-based sidebar settling.
- Four-step first-launch wizard, saved completion state and reopening from About.
- General workspace defaults/recent-workspace management, default model selection, available-model list, Skills inventory and confirmed device-default restoration.
- History custom-message annotations and memory-write cards, refreshed after live memory writes without replacing task/todo state.
- Model-chain reorder/removal/reasoning controls and JSONC comment-preserving updates using the existing Windows routing writer.
- Theme transition cancellation when a later selection has the same brightness as the current screen.

Protected Windows/user features:

- Five `palette` values including SBD and `body[data-palette]`; upstream's parallel `colorTheme` contract was not introduced.
- User profile model assignments, proxy reasoning/model discovery, opencodex account inventory, MCP import, Android/device settings and workspace file panel.
- Existing routing `omo.json`/`omo.jsonc`, root/`[senpi]` merging, named mappings, backup and supervised restart. The upstream `[native]` writer was not introduced.
- Retained nonblocking questions and selected-model reroll behavior, Windows updater gzip/dotted-asset fixes and Windows package identity.

Windows adaptations use both path separators, Ctrl shortcuts, native `path.join` test paths and the packaged AppUserModelID for Electron notifications. Git UI tests commit/push only inside disposable local fixture repositories, never the project or an external remote. Behavior tests gate completion on an explicit file event rather than a fixed delay.

The original SettingsPage replacement, deletion of SectionHeading, parallel palette stylesheet and macOS release metadata were excluded because the fork already has those surfaces or because replacement removes Windows/user features. Existing SettingsDialog remains the full-screen settings surface with new controls connected to it.

Before integration, uncommitted user files were copied to `P:/coding/fastopen/_quarantine/pre-upstream-20261007`. No project commit, push or release publication was made.

## Verification

Typecheck and production build passed. The full unit run passed 55 files / 724 tests; the subsequently restored upstream time-format file passed 3 tests. The full Windows E2E run passed 74 of 76 tests initially. The remaining failures were the settings navigation/search test identifiers and a locale-dependent shell assertion. After adaptation, the related settings/shell run passed 11 tests with the search test still failing; the final search-shortcut fix passed its single regression. Earlier focused runs verified onboarding, all five palettes, theme transition cancellation, profile selection, MCP import, routing, proxy setup, session notices and app updates. Light/dark desktop and narrow SBD screenshots were inspected.

## Additional question-reply diagnosis

The installed app's retained nonblocking question labels a resolved request as a completed turn. Resolution of the request does not imply completion of model execution. A read-only `thread/read` for the reported thread `01a11239-309f-7a04-beba-cf11f0bb4a66` returned `status.type: active` and a final `inProgress` turn while the card said the turn had ended. Submitting the expired request goes through `turn/start`; native omo rejects it with `-32603: Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.`

The normal idle retained-question path remains covered by `e2e/async-question.spec.ts`. No reply or turn interrupt was sent to the user's thread during diagnosis. The additional busy-thread correction was proposed separately and was not applied without a requested implementation decision.
