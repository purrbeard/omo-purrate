import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  CodeBlock,
  DiffBlock,
  DisclosureRow,
  IconAgentPresetOutlineRegular,
  IconApiOutlineRegular,
  IconBrowseOutlineRegular,
  IconCheckOutlineRegular,
  IconChecklistOutlineRegular,
  IconCloseOutlineRegular,
  IconCodeOutlineRegular,
  IconEditOutlineRegular,
  IconGlobeOutlineRegular,
  IconPluginPinwheelOutlineRegular,
  IconQuestionOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
  JsonTree,
  StateDot,
  TerminalBlock,
  TextShimmer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { ImagePreview } from "@deepseek-ai/dsh-client-ui-primitives/src/ImagePreview.tsx";
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
import a11y from "./a11y.module.css";
import css from "./ToolCard.module.css";

const STATE_LABEL: Record<ToolState, MessageKey> = {
  running: "conversation.tool.state.running",
  ok: "conversation.tool.state.ok",
  error: "conversation.tool.state.error",
  stopped: "conversation.tool.state.stopped",
};

function ToolIcon({ kind }: { kind: ToolKind }) {
  switch (kind) {
    case "code":
      return <IconCodeOutlineRegular size={14} />;
    case "edit":
    case "write":
    case "fileChange":
      return <IconEditOutlineRegular size={14} />;
    case "read":
    case "fetch":
      return <IconBrowseOutlineRegular size={14} />;
    case "task":
      return <IconAgentPresetOutlineRegular size={14} />;
    case "todo":
      return <IconChecklistOutlineRegular size={14} />;
    case "question":
      return <IconQuestionOutlineRegular size={14} />;
    case "web":
      return <IconGlobeOutlineRegular size={14} />;
    case "search":
      return <IconSearchOutlineRegular size={14} />;
    case "command":
      return <IconApiOutlineRegular size={14} />;
    case "mcp":
      return <IconPluginPinwheelOutlineRegular size={14} />;
    case "generic":
      return <IconSparkleRegular size={14} />;
  }
}

function StatusMark({ state, durationMs }: { state: ToolState; durationMs: number | null }) {
  const t = useT();
  return (
    <span className={css.status} data-state={state} aria-hidden="true">
      {state === "running" ? (
        <StateDot state="ongoing" size={12} />
      ) : state === "ok" ? (
        <IconCheckOutlineRegular size={14} className={css.statusIcon} />
      ) : state === "error" ? (
        <IconCloseOutlineRegular size={14} className={css.statusIcon} />
      ) : (
        <StateDot state="warning" size={8} />
      )}
      {durationMs !== null && state !== "running" && <span>{formatDuration(durationMs, t)}</span>}
    </span>
  );
}

function IoCard({ label, text, error = false }: { label: string; text: string; error?: boolean }) {
  return (
    <div className={css.ioCard}>
      <div className={css.ioSection}>
        <span className={css.ioLabel}>{label}</span>
        <span className={css.ioText} data-error={error || undefined}>
          {text}
        </span>
      </div>
    </div>
  );
}

function OutputImage({ url }: { url: string }) {
  const t = useT();
  return (
    <div className={css.image}>
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
        <div className={css.codeScroll}>
          <CodeBlock
            code={input.code.text}
            lang={input.code.language}
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
            toolbarLabels={labels.toolbar}
            className={css.flush}
          />
        </div>
      )}
      {input.json !== null && (
        <JsonTree data={input.json} label={t("conversation.tool.arguments")} labels={labels.json} className={css.json} />
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
              <div key={index} className={css.terminalFrame} data-error={part.error || undefined}>
                <TerminalBlock
                  command={item.tool}
                  output={part.text}
                  runStateDot={false}
                  labels={labels.terminal}
                  className={clsx(css.terminal, css.terminalNoDot)}
                />
              </div>
            );
          case "text":
            return <IoCard key={index} label={t("conversation.tool.output")} text={part.text} error={state === "error"} />;
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
      className={css.terminal}
    />
  );
}

function FileChangeBody({ item, cwd }: { item: FileChangeItem; cwd: string | null }) {
  const labels = useConversationLabels();
  const diffs = useMemo(
    () => item.changes.flatMap((change) => fileChangeHunks(change, displayPath(change.path, cwd))),
    [item.changes, cwd],
  );
  return <DiffBlock diffs={diffs} labels={labels.diff} className={css.diff} />;
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
      {text !== null && <IoCard label={t("conversation.tool.output")} text={text} />}
      {text === null && (isRecord(result) || Array.isArray(result)) && (
        <JsonTree data={result} label={t("conversation.tool.output")} labels={labels.json} className={css.json} />
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
              <span className={css.sep} data-shimmer-decoration aria-hidden />
              <span
                className={clsx(
                  css.summary,
                  state === "error" && css.errorSummary,
                  state === "stopped" && css.stoppedSummary,
                )}
              >
                <TextShimmer>{summary}</TextShimmer>
              </span>
            </>
          )}
          {totals !== null && (
            <TextShimmer className={css.totals}>
              <span className={css.added}>{`+${totals.added}`}</span> <span className={css.removed}>{`-${totals.removed}`}</span>
            </TextShimmer>
          )}
        </>
      ),
    [summary, totals, state],
  );
  return (
    <div
      className={css.root}
      data-testid={TESTID.toolCard}
      data-tool={model.tool}
      data-status={model.status}
      data-state={state}
      data-item-id={item.id}
      data-flow="tool"
    >
      <span className={a11y.visuallyHidden}>{t(STATE_LABEL[state])}</span>
      <div className={css.head}>
        <DisclosureRow
          className={css.disclosure}
          rowClassName={css.row}
          leadingClassName={css.leading}
          titleClassName={css.title}
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
        <div className={css.body}>
          <ToolBody item={item} state={state} cwd={cwd} />
        </div>
      )}
    </div>
  );
});
