# Live DAG and child work

The Activity chip is absent for threads without runs or tasks, collapsed by default, and remembers expansion per thread. Counts refer to DAG nodes plus ordinary root tasks; a node and its `task_id` are one entity. Numbered dependency layers show dependency ids, execution state, category/model, elapsed execution time, and the current native todo step or latest activity. Disclosure shows full metadata, failures/results and todo steps. Child tasks follow explicit session ownership, not dependency edges, and fold past depth 2. Disconnected rows do not animate.

## OmO 5.1.4 source evidence

Offsets below are byte offsets in `/Users/sigridjineth/.local/bin/omo`, decoded as Latin-1. The installed bundle is minified, so offsets identify source more precisely than line numbers.

- `102720242`, `function sX(e)`: DAG projection returns `run_id`, `run_key`, `name`, `status`, ISO `created_at`/`updated_at`/optional `completed_at`, `counts`, `nodes`, `edges`, `waves`. Nodes return `id`, optional `label`, `prompt`, `depends_on`, `state`, `attempt`, optional `task_id`/`started_at`/`completed_at` and `last_error: {code,message}`. Edges are `{from,to}`; waves are `{index,node_ids}`. The compact panel derives dependency layers from `depends_on` and `edges`, including waiting nodes absent from scheduler waves, and uses execution endpoints; prompts/errors appear on disclosure.
- `102722300`: snapshot envelope is `{parent_session_id, runs: snapshots.map(sX), truncated_runs?}`, published as `omo.dag.updated`. `102796800`: tasks are listed with `scope:"parent-session"`; `102798249` publishes `omo.task.updated`, with `{parent_session_id,tasks,truncated_tasks?}`. These are replacement rosters, not deltas.
- `102581803`, `function AG(e,t)`: task projection includes `task_id`, `status`, `task_summary`, `name`, `category`, `execution_mode`, `model`, `run_stats`, failure fields; detailed projection includes `description`, `agent_type`, `residency_state`, `depth`, `created_at`, `updated_at`. The codec adds `child_session_id`, optional result/error text, and truncation flags. `102798300` onward subscribes to resident children and projects `live_progress.activity`, numeric millisecond `started_at`, `current_tool`, `last_assistant_line`, `turns`, optional `tool_calls` and token counters. The panel uses title/category/model, residency, live activity and recorded runtime; child links identify owned work.
- **There is no todo array in either RPC projection.** Native child progress is read from the child's active session branch: `customType:"senpi.todo-state"`, `data:{schema:"v2",phases:[{name,tasks:[{content,status}]}]}`. Statuses are `pending`, `in_progress`, `completed`, `abandoned` (legacy `cancelled` maps to abandoned). The existing session parser follows `parentId`, so abandoned branches do not leak into progress. Latest assistant/tool activity is a fallback, not a fabricated sub-step count.
- `102176000` onward: `Nw` hashes the real workspace path with SHA-256, takes 12 hex characters and sanitizes its basename. `Mw` prefers `<cwd>/.omo/senpi-task` when present, otherwise `<agent>/projects/<basename>-<hash>/senpi-task`. Records preserve `parent_session_id` and `child_session_id`. Child sessions are under `children/<task_id>/sessions/…_<child_session_id>.jsonl`; host-session records contain `host_session.session_path` (`102163794`). The reader validates records, explicit ownership, file containment and session-header identity, and strips private spawn prompts before IPC.

## Prior art

All five repositories were cloned read-only under `/tmp/dag-prior-art`.

- [jc01rho/omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag), especially `src/model.mjs` and `src/task-data.mjs`: compact dependency layers, lifecycle colors, task-to-node joins and explicit `child_session_id -> parent_session_id` ancestry. This is the principal reference. Full task details are disclosures rather than repeated cards.
- [Hakubisual/pase-omo](https://github.com/Hakubisual/pase-omo), `shared/row.ts` and `client/dag-pill.ts`: completed/total pill, failure counts, no pill without work, and bounded live backstop refresh. Its large graph canvas is not needed in the conversation column.
- [itokun99/omo-tmux-dag](https://github.com/itokun99/omo-tmux-dag): retains completed/failed states and folds details without stealing conversation focus; it is itself a Herdr DAG port.
- [pawissanutt/omo-scope](https://github.com/pawissanutt/omo-scope), `src/store.rs`, `src/locate.rs`, `src/pinned.rs`: indented ownership tree, native child transcripts and pinned todo progress/current step. Native-file enrichment is necessary because RPC snapshots omit child todos.
- [grim-susemi/omo-herdr-dashboard](https://github.com/grim-susemi/omo-herdr-dashboard), `packages/todo/src/native-todo.mjs`: native phased todo counts and current-step selection. The separate Todo/Workers/DAG windows are condensed into one inline panel.

No prior-art code was vendored. The existing DSH token palette, StateDot primitive, dictionaries and notification/store path remain the app's implementation conventions.

## Verification surface

`SCENARIO:dag` emits native-shaped DAG/task snapshots and writes native child task/session files. `fake.advance` progresses the scene deterministically, including child todo `4/9 -> 6/9`. `e2e/dag.spec.ts` captures collapsed, expanded, nested details, dark, narrow and Korean views under `/tmp/dag-ev/`, using an isolated fake-omo app instance.
