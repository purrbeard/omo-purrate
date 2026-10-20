import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Bot, Check, CircleHelp, Code, FileText, Globe, ListChecks, Puzzle, Search, Sparkles, SquarePen, Terminal, X } from "lucide-react";
import { CodeBlock } from "../content/code/CodeBlock";
import { DiffBlock } from "../content/DiffBlock";
import { ImagePreview } from "../content/ImagePreview";
import { PathInline, PathPreviews } from "../content/media/PathText";
import { JsonTree } from "../content/JsonTree";
import { TerminalBlock } from "../content/TerminalBlock";
import { DisclosureRow, StateDot, TextShimmer } from "../kit";
import type { CommandExecutionItem, DynamicToolCallItem, FileChangeItem, McpToolCallItem } from "../../../shared/protocol";
import { useT, type MessageKey } from "../../i18n";
import type { ConversationItem } from "../../state";
import { TESTID } from "../testids";
import { fileChangeHunks } from "./diff";
import { displayPath, elapsedMs, formatDuration, isRecord } from "./format";
import { useConversationLabels } from "./labels";
import {
  toolInput,
  toolOutputs,
  toolRowModel,
  type ToolItem,
  type ToolKind,
  type ToolState,
} from "./tool-model";

// Content blocks set their own margins and radius, so overrides of those properties use "!"; JsonTree's root is
// scoped plain CSS. TerminalBlock sizing rebinds through its --tb-* custom properties.
const JSON_CLASS = "max-h-60! rounded-lg! border! border-solid! border-border!";
const TERMINAL_CLASS =
  "m-0! border border-solid border-border [--tb-font:var(--dsw-font-markdown-code-block-small)] [--tb-line-height:18px] [--tb-output-max-height:224px]";

const STATE_LABEL: Record<ToolState, MessageKey> = {
  running: "conversation.tool.state.running",
  ok: "conversation.tool.state.ok",
  error: "conversation.tool.state.error",
  stopped: "conversation.tool.state.stopped",
};

function ToolIcon({ kind }: { kind: ToolKind }) {
  switch (kind) {
    case "code":
      return <Code className="size-3.5" aria-hidden />;
    case "edit":
    case "write":
    case "fileChange":
      return <SquarePen className="size-3.5" aria-hidden />;
    case "read":
    case "fetch":
      return <FileText className="size-3.5" aria-hidden />;
    case "task":
      return <Bot className="size-3.5" aria-hidden />;
    case "todo":
      return <ListChecks className="size-3.5" aria-hidden />;
    case "question":
      return <CircleHelp className="size-3.5" aria-hidden />;
    case "web":
      return <Globe className="size-3.5" aria-hidden />;
    case "search":
      return <Search className="size-3.5" aria-hidden />;
    case "command":
      return <Terminal className="size-3.5" aria-hidden />;
    case "mcp":
      return <Puzzle className="size-3.5" aria-hidden />;
    case "generic":
      return <Sparkles className="size-3.5" aria-hidden />;
  }
}

function StatusMark({ state, durationMs }: { state: ToolState; durationMs: number | null }) {
  const t = useT();
  return (
    <span className="inline-flex h-6 flex-none items-center gap-1 text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums" data-state={state} aria-hidden="true">
      {state === "running" ? (
        <StateDot state="ongoing" size={12} />
      ) : state === "ok" ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : state === "error" ? (
        <X className="size-3.5 text-destructive-foreground" aria-hidden />
      ) : (
        <StateDot state="warning" size={8} />
      )}
      {durationMs !== null && state !== "running" && <span>{formatDuration(durationMs, t)}</span>}
    </span>
  );
}

function IoCard({ label, text, error = false, paths = false }: { label: string; text: string; error?: boolean; paths?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-solid border-border bg-message-code font-mono text-xs leading-[18px]">
      <div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
        <span className="sticky top-0 self-start text-muted-foreground">{label}</span>
        <span className="min-w-0 break-words whitespace-pre-wrap text-message-code-foreground data-[error]:text-destructive-foreground" data-error={error || undefined}>
          {paths ? <PathInline text={text} /> : text}
        </span>
      </div>
      {paths && <PathPreviews text={text} compact className="mx-4 mt-0 mb-3" />}
    </div>
  );
}

function OutputImage({ url }: { url: string }) {
  const t = useT();
  return (
    <div className="w-[min(100%,360px)] overflow-hidden rounded-lg border border-solid border-border">
      <ImagePreview
        src={url}
        alt={t("conversation.tool.image")}
        loadingLabel={t("conversation.image.loading")}
        failedLabel={t("conversation.image.failed")}
      />
    </div>
  );
}

function ToolArguments({ tool, args }: { tool: string; args: unknown }) {
  const t = useT();
  const labels = useConversationLabels();
  const input = useMemo(() => toolInput(tool, args), [tool, args]);
  return (
    <>
      {input.code !== null && (
        <div className="max-h-[260px] overflow-y-auto rounded-lg">
          <CodeBlock
            code={input.code.text}
            lang={input.code.language}
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
            toolbarLabels={labels.toolbar}
            className="m-0!"
          />
        </div>
      )}
      {input.json !== null && (
        <JsonTree data={input.json} label={t("conversation.tool.arguments")} labels={labels.json} className={JSON_CLASS} />
      )}
      {input.text !== null && <IoCard label={t("conversation.tool.arguments")} text={input.text} />}
    </>
  );
}

function DynamicToolBody({ item, state }: { item: DynamicToolCallItem; state: ToolState }) {
  const t = useT();
  const labels = useConversationLabels();
  const outputs = useMemo(() => toolOutputs(item.contentItems), [item.contentItems]);
  return (
    <>
      <ToolArguments tool={item.tool} args={item.arguments} />
      {outputs.map((part, index) => {
        switch (part.kind) {
          case "terminal":
            return (
              <div key={index} className="group/term min-w-0" data-error={part.error || undefined}>
                <TerminalBlock
                  command={item.tool}
                  output={part.text}
                  runStateDot={false}
                  labels={labels.terminal}
                  className={clsx(TERMINAL_CLASS, "[--tb-gutter:14px] group-data-[error]/term:border-destructive-foreground!")}
                />
              </div>
            );
          case "text":
            return <IoCard key={index} label={t("conversation.tool.output")} text={part.text} error={state === "error"} paths={state !== "running"} />;
          case "image":
            return <OutputImage key={index} url={part.url} />;
        }
      })}
    </>
  );
}

function CommandBody({ item, state }: { item: CommandExecutionItem; state: ToolState }) {
  const labels = useConversationLabels();
  const running = state === "running";
  return (
    <TerminalBlock
      command={item.command}
      cwd={item.cwd}
      output={item.aggregatedOutput ?? undefined}
      exitCode={running ? undefined : item.exitCode}
      running={running}
      labels={labels.terminal}
      className={TERMINAL_CLASS}
    />
  );
}

function FileChangeBody({ item, cwd }: { item: FileChangeItem; cwd: string | null }) {
  const labels = useConversationLabels();
  const diffs = useMemo(
    () => item.changes.flatMap((change) => fileChangeHunks(change, displayPath(change.path, cwd))),
    [item.changes, cwd],
  );
  return <DiffBlock diffs={diffs} labels={labels.diff} className="m-0! rounded-lg! border! border-solid! border-border!" />;
}

function mcpResultText(result: unknown): string | null {
  const content = isRecord(result) ? result["content"] : undefined;
  if (!Array.isArray(content)) return null;
  const texts = content.flatMap((block: unknown) =>
    isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
  );
  return texts.length > 0 ? texts.join("\n") : null;
}

function McpBody({ item }: { item: McpToolCallItem }) {
  const t = useT();
  const labels = useConversationLabels();
  const text = useMemo(() => mcpResultText(item.result), [item.result]);
  const result: unknown = item.result;
  return (
    <>
      <ToolArguments tool={item.tool} args={item.arguments} />
      {text !== null && <IoCard label={t("conversation.tool.output")} text={text} paths />}
      {text === null && (isRecord(result) || Array.isArray(result)) && (
        <JsonTree data={result} label={t("conversation.tool.output")} labels={labels.json} className={JSON_CLASS} />
      )}
      {item.error && <IoCard label={t("conversation.tool.error")} text={item.error.message} error />}
    </>
  );
}

function ToolBody({ item, state, cwd }: { item: ToolItem; state: ToolState; cwd: string | null }): ReactNode {
  switch (item.type) {
    case "dynamicToolCall":
      return <DynamicToolBody item={item} state={state} />;
    case "commandExecution":
      return <CommandBody item={item} state={state} />;
    case "fileChange":
      return <FileChangeBody item={item} cwd={cwd} />;
    case "mcpToolCall":
      return <McpBody item={item} />;
    case "webSearch":
      return null;
  }
}

/** DSH ToolRow port: a collapsed one-line summary that expands into the call's arguments and output. */
export const ToolCard = memo(function ToolCard({
  entry,
  item,
  cwd,
}: {
  entry: ConversationItem;
  item: ToolItem;
  cwd: string | null;
}) {
  const t = useT();
  const { streaming, startedAtMs, completedAtMs } = entry;
  const model = useMemo(
    () => toolRowModel(item, streaming, elapsedMs(startedAtMs, completedAtMs), cwd),
    [item, streaming, startedAtMs, completedAtMs, cwd],
  );
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const open = expanded && model.expandable;
  const icon = useMemo(() => <ToolIcon kind={model.kind} />, [model.kind]);
  const title = model.titleKey === null ? model.title : t(model.titleKey);
  const { summary, totals, state } = model;
  const collapsedContent = useMemo(
    () =>
      summary === "" && totals === null ? undefined : (
        <>
          {summary !== "" && (
            <>
              <span className="mx-2 size-0.5 flex-none rounded-full bg-muted-foreground" data-shimmer-decoration aria-hidden />
              <span
                className={clsx(
                  "min-w-0 flex-auto truncate text-[13px] leading-6",
                  state === "error" && "text-destructive-foreground",
                  state === "stopped" && "text-warning",
                )}
              >
                <TextShimmer>{summary}</TextShimmer>
              </span>
            </>
          )}
          {totals !== null && (
            <TextShimmer className="ml-2.5 flex-none font-mono text-[11px] leading-6 whitespace-nowrap">
              <span className="group-hover/row:text-(--diff-add) group-aria-expanded/row:text-(--diff-add)">{`+${totals.added}`}</span>{" "}
              <span className="group-hover/row:text-destructive-foreground group-aria-expanded/row:text-destructive-foreground">{`-${totals.removed}`}</span>
            </TextShimmer>
          )}
        </>
      ),
    [summary, totals, state],
  );
  return (
    <div
      className="relative flex min-w-0 flex-col"
      data-testid={TESTID.toolCard}
      data-tool={model.tool}
      data-status={model.status}
      data-state={state}
      data-item-id={item.id}
      data-flow="tool"
    >
      <span className="sr-only">{t(STATE_LABEL[state])}</span>
      <div className="flex min-w-0 items-center gap-2">
        <DisclosureRow
          className="min-w-0 flex-auto"
          rowClassName="group/row rounded-sm"
          leadingClassName="shrink-0"
          titleClassName="font-normal"
          icon={icon}
          title={title}
          running={state === "running"}
          open={open}
          expandable={model.expandable}
          expandOnRowClick
          keepContentWhenOpen
          onToggle={toggle}
          collapsedContent={collapsedContent}
        />
        <StatusMark state={state} durationMs={model.durationMs} />
      </div>
      {open && (
        <div className="flex min-w-0 flex-col gap-2 py-1 pl-1">
          <ToolBody item={item} state={state} cwd={cwd} />
        </div>
      )}
    </div>
  );
});
