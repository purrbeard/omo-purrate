import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { MarkdownDelegateProvider } from "../content/markdown/MarkdownDelegate";
import { MarkdownText } from "../content/markdown/MarkdownText";
import { resolveWorkspacePath } from "../content/workspace-path";
import type { ThreadItem, UserMessageItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { selectPanelNotices, selectPendingRequestsForThread, selectSidesOf, sideDraftKey } from "../../state";
import type { Conversation, ConversationItem, ConversationTurn, SideChat } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { ApprovalCard } from "../conversation/ApprovalCard";
import { AssistantMessage } from "../conversation/AssistantMessage";
import { elapsedMs, threadTitle, workspaceName } from "../conversation/format";
import { useConversationLabels } from "../conversation/labels";
import { QuestionCard } from "../conversation/QuestionCard";
import { ReasoningRow } from "../conversation/ReasoningRow";
import { RenderBoundary } from "../conversation/RenderBoundary";
import { ToolCard } from "../conversation/ToolCard";
import { useStickToBottom } from "../conversation/use-stick-to-bottom";
import { TESTID } from "../testids";
import { sideDisplayText } from "./background";
import { BubbleIcon, CloseIcon, PlusIcon, SendIcon, SparkIcon, StopIcon } from "./icons";
import { useAskSide } from "./use-ask-side";
import { CircleAlert } from "lucide-react";
import { Menu, StateDot, TextShimmer, Tooltip, focusRing } from "../kit";
import { userErrorText } from "../conversation/user-error";

const PAD_X = "px-3.5";

/** Requested width of the docked panel; AppFrame clamps it and overlays the panel when the window is too narrow. */
export const SIDE_PANEL_WIDTH = 380;

const NEW_SIDE_ID = "new-side";
const NO_TURNS: readonly ConversationTurn[] = [];
const QUICK_ASKS = ["btw.chip.summarize", "btw.chip.changed", "btw.chip.error"] as const;
const INPUT_MAX_HEIGHT = 120;

function assertNever(value: never): never {
  throw new Error(`Unhandled side chat item: ${JSON.stringify(value)}`);
}

function userText(item: UserMessageItem): string {
  return item.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

function relatedItem(conversation: Conversation | null, turnId: string, itemId: string): ThreadItem | null {
  const turn = conversation?.turns.find((candidate) => candidate.id === turnId);
  return turn?.items.find((entry) => entry.item.id === itemId)?.item ?? null;
}

const keepFocus = (event: MouseEvent<HTMLButtonElement>): void => {
  event.preventDefault();
};

function QuestionBubble({ text, sending = false }: { text: string; sending?: boolean }) {
  return (
    <div className="max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-message-user px-3 py-[7px] [overflow-wrap:anywhere] whitespace-pre-wrap text-message-user-foreground data-[sending]:opacity-70" data-testid={TESTID.sideQuestion} data-sending={sending || undefined}>
      {text}
    </div>
  );
}

function SideErrorRow({ title, message, onDismiss }: { title: string; message: string; onDismiss?: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-xl bg-destructive py-2 pr-2 pl-2.5" data-testid={TESTID.sideError} role="alert">
      <CircleAlert className="mt-0.5 size-4 flex-none text-destructive-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-destructive-foreground">{title}</span>
        <span className="[overflow-wrap:anywhere] text-foreground">{message}</span>
      </div>
      {onDismiss !== undefined && (
        <button type="button" className={clsx("m-0 inline-grid size-[22px] flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground", focusRing)} aria-label={t("btw.dismiss")} onClick={onDismiss}>
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

function SideItem({ side, entry, cwd }: { side: SideChat; entry: ConversationItem; cwd: string | null }) {
  const labels = useConversationLabels();
  const { item } = entry;
  switch (item.type) {
    case "userMessage": {
      const text = sideDisplayText(side, userText(item)).trim();
      return text === "" ? null : <QuestionBubble text={text} />;
    }
    case "agentMessage":
      return <AssistantMessage id={item.id} text={item.text} streaming={entry.streaming} />;
    case "reasoning":
      return <ReasoningRow item={item} streaming={entry.streaming} durationMs={elapsedMs(entry.startedAtMs, entry.completedAtMs)} />;
    case "plan":
      return <MarkdownText text={item.text} streaming={entry.streaming} labels={labels.markdown} variant="compact" />;
    case "contextCompaction":
      return null;
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
      return <ToolCard entry={entry} item={item} cwd={cwd} />;
    default:
      return assertNever(item);
  }
}

const SideTurn = memo(function SideTurn({ side, turn, cwd }: { side: SideChat; turn: ConversationTurn; cwd: string | null }) {
  const t = useT();
  const failed = turn.error !== null || turn.status === "failed";
  const message = typeof turn.error?.message === "string" ? turn.error.message.trim() : "";
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid={TESTID.sideTurn} data-turn-id={turn.id} data-status={turn.status}>
      {turn.items.map((entry) => (
        <RenderBoundary key={entry.item.id} label={`a ${entry.item.type} item`} resetKey={entry}>
          <SideItem side={side} entry={entry} cwd={cwd} />
        </RenderBoundary>
      ))}
      {failed && (
        <SideErrorRow
          title={t(turn.status === "inProgress" ? "conversation.turn.retrying" : "btw.error.title")}
          message={message === "" ? t("conversation.turn.errorUnknown") : message}
        />
      )}
      {turn.status === "interrupted" && <span className="text-xs text-muted-foreground">{t("conversation.turn.stopped")}</span>}
    </div>
  );
});

function SideTranscript({ side, cwd }: { side: SideChat; cwd: string | null }) {
  const t = useT();
  const conversation = useAppSelector((state) => state.conversations[side.id] ?? null);
  const pending = useAppSelector((state) => selectPendingRequestsForThread(state, side.id));
  const scroll = useStickToBottom();
  const turns = conversation?.turns ?? NO_TURNS;
  const activeTurnId = conversation?.activeTurnId ?? null;
  const activeTurn = activeTurnId === null ? null : (turns.find((turn) => turn.id === activeTurnId) ?? null);
  const streaming = activeTurn?.items.some((entry) => entry.streaming) ?? false;
  const working = activeTurn !== null && !streaming && pending.length === 0;
  const openExternalLink = useCallback((href: string) => void window.omo.openExternal(href), []);
  const openFile = useCallback(
    (path: string) => void window.omo.revealPath(resolveWorkspacePath(cwd ?? undefined, path)),
    [cwd],
  );
  return (
    <div ref={scroll.scrollRef} className="scrollable min-h-0 flex-1 overflow-y-auto" role="region" aria-label={t("btw.transcript")}>
      <div ref={scroll.contentRef} className={clsx("flex flex-col gap-3.5 pt-3.5 pb-2", PAD_X)} data-testid={TESTID.sideTranscript} data-side-id={side.id}>
        {conversation?.historyState === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <TextShimmer active>{t("btw.loading")}</TextShimmer>
          </div>
        )}
        <MarkdownDelegateProvider openExternalLink={openExternalLink} openFile={openFile}>
          {turns.map((turn) => (
            <SideTurn key={turn.id} side={side} turn={turn} cwd={cwd} />
          ))}
        </MarkdownDelegateProvider>
        {conversation?.pendingUserMessages.map((message) => (
          <QuestionBubble key={message.clientId} text={sideDisplayText(side, message.text)} sending />
        ))}
        {working && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <StateDot state="ongoing" size={10} />
            <TextShimmer active>{t("btw.working")}</TextShimmer>
          </div>
        )}
        {pending.map((request) => (
          <RenderBoundary key={`${request.kind}:${String(request.id)}`} label={`a ${request.kind} request`} resetKey={request}>
            {request.kind === "userInput" ? (
              <QuestionCard request={request} />
            ) : (
              <ApprovalCard request={request} related={relatedItem(conversation, request.params.turnId, request.params.itemId)} cwd={cwd} />
            )}
          </RenderBoundary>
        ))}
      </div>
    </div>
  );
}

const INTRO = "flex min-h-0 flex-1 flex-col justify-end gap-3 py-4";

function NewSideIntro({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  const t = useT();
  return (
    <div className={clsx(INTRO, PAD_X)} data-testid={TESTID.sideIntro}>
      <span className="inline-grid size-9 place-items-center rounded-xl bg-muted text-foreground" aria-hidden>
        <SparkIcon size={18} />
      </span>
      <p className="m-0 text-muted-foreground">{t("btw.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {QUICK_ASKS.map((key) => (
          <button key={key} type="button" className={clsx("m-0 h-8 cursor-pointer rounded-full border-0 bg-muted px-3.5 text-[13px] leading-none font-medium text-foreground [font-family:inherit] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50", focusRing)} data-testid={TESTID.sideChip} disabled={disabled} onClick={() => onAsk(t(key))}>
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

const CONTEXT = "box-border inline-flex h-[26px] max-w-full items-center gap-1.5 self-start rounded-md text-xs text-muted-foreground";

function ContextChip({ attached, title, workspace, onChange }: { attached: boolean; title: string; workspace: string; onChange: (attached: boolean) => void }) {
  const t = useT();
  if (!attached) {
    return (
      <button type="button" className={clsx(CONTEXT, "m-0 cursor-pointer border border-dashed border-input bg-transparent px-2 [font-family:inherit] hover:text-foreground", focusRing)} data-testid={TESTID.sideContext} data-attached="false" onClick={() => onChange(true)}>
        <PlusIcon size={12} />
        <span>{t("btw.context.attach")}</span>
      </button>
    );
  }
  return (
    <span className={clsx(CONTEXT, "bg-muted pr-1 pl-2")} data-testid={TESTID.sideContext} data-attached="true" title={t("btw.context.hint")}>
      <BubbleIcon size={13} />
      <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      <span className="flex-none text-muted-foreground">{workspace}</span>
      <button type="button" className={clsx("m-0 inline-grid size-5 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground", focusRing)} aria-label={t("btw.context.remove")} onClick={() => onChange(false)}>
        <CloseIcon size={10} />
      </button>
    </span>
  );
}

function SidePicker({ sides, selected, onSelect }: { sides: readonly SideChat[]; selected: SideChat | null; onSelect: (sideId: string | null) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const position = selected === null ? -1 : sides.indexOf(selected);
  const selectedId = selected?.id ?? NEW_SIDE_ID;
  const mark = (id: string) => (id === selectedId ? <Check className="ml-auto" aria-hidden /> : null);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        className={clsx("m-0 inline-flex h-7 min-w-0 max-w-full flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 font-medium text-foreground [font:inherit] hover:bg-accent aria-expanded:bg-accent", focusRing)}
        data-testid={TESTID.sidePicker}
      >
        <span className="flex-none">{position < 0 ? t("btw.picker.new") : t("btw.side.label", { n: position + 1 })}</span>
        {selected !== null && <span className="min-w-0 truncate font-normal text-muted-foreground">{selected.question}</span>}
        <ChevronDown className="size-3 flex-none" aria-hidden />
      </Menu.Trigger>
      <Menu.Content side="bottom" align="start">
        {sides.length > 0 && (
          <>
            <Menu.Group>
              <Menu.GroupLabel>{t("btw.picker.label")}</Menu.GroupLabel>
              {sides.map((side, index) => (
                <Menu.Item key={side.id} onClick={() => onSelect(side.id)}>
                  <span className="flex min-w-0 max-w-[260px] flex-col">
                    <span className="font-medium">{t("btw.side.label", { n: index + 1 })}</span>
                    <span className="truncate text-xs text-muted-foreground">{side.question}</span>
                  </span>
                  {mark(side.id)}
                </Menu.Item>
              ))}
            </Menu.Group>
            <Menu.Separator />
          </>
        )}
        <Menu.Item icon={<PlusIcon size={12} />} onClick={() => onSelect(null)}>
          {t("btw.picker.new")}
          {mark(NEW_SIDE_ID)}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

interface SideComposerProps {
  parentId: string | null;
  side: SideChat | null;
  connected: boolean;
  running: boolean;
  contextChip: ReactNode;
  onSubmit: (text: string) => void;
  onStop: () => void;
  onEscape: () => void;
}

const SEND = clsx("m-0 inline-grid size-7 flex-none cursor-pointer place-items-center rounded-full border-0 p-0", focusRing);

function SideComposer({ parentId, side, connected, running, contextChip, onSubmit, onStop, onEscape }: SideComposerProps) {
  const t = useT();
  const actions = useActions();
  const draftKey = parentId === null ? null : sideDraftKey(parentId, side?.id ?? null);
  const draft = useAppSelector((state) => (draftKey === null ? "" : (state.btw.drafts[draftKey] ?? "")));
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const disabled = !connected || parentId === null;
  const blank = draft.trim() === "";

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus({ preventScroll: true });
  }, [disabled, draftKey]);

  const submit = (): void => {
    if (disabled || blank || draftKey === null) return;
    actions.setSideDraft(draftKey, "");
    onSubmit(draft.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape" && draft === "") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const placeholder =
    parentId === null
      ? t("btw.placeholder.noThread")
      : running
        ? t("btw.placeholder.running")
        : side === null
          ? t("btw.placeholder.new")
          : t("btw.placeholder.followUp");

  return (
    <div className="flex flex-none flex-col gap-2 px-2.5 pt-2 pb-2.5" data-testid={TESTID.sideComposer}>
      {contextChip}
      <div className={clsx("flex items-end gap-1.5 rounded-[18px] border border-solid border-border bg-composer py-1.5 pr-1.5 pl-3 focus-within:border-input", disabled && "opacity-60")}>
        <textarea
          ref={inputRef}
          className="m-0 max-h-[120px] min-h-6 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-0.5 text-[13px] leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap text-composer-foreground caret-composer-foreground outline-none [font-family:inherit] placeholder:text-composer-placeholder disabled:cursor-not-allowed"
          data-testid={TESTID.sideInput}
          aria-label={t("btw.inputLabel")}
          placeholder={placeholder}
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            if (draftKey !== null) actions.setSideDraft(draftKey, event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={onKeyDown}
        />
        {running && (
          <Tooltip.Root>
            <Tooltip.Trigger
              delay={500}
              render={
                <button type="button" className={clsx(SEND, "bg-secondary text-secondary-foreground")} data-testid={TESTID.sideStop} aria-label={t("btw.stop")} onMouseDown={keepFocus} onClick={onStop}>
                  <StopIcon />
                </button>
              }
            />
            <Tooltip.Content side="top">{t("btw.stop")}</Tooltip.Content>
          </Tooltip.Root>
        )}
        <Tooltip.Root disabled={disabled || blank}>
          <Tooltip.Trigger
            delay={500}
            render={
              <button
                type="button"
                className={clsx(SEND, disabled || blank ? "cursor-not-allowed bg-muted text-muted-foreground" : "bg-composer-send text-composer-send-foreground")}
                data-testid={TESTID.sideSend}
                aria-label={t("btw.send")}
                disabled={disabled || blank}
                onMouseDown={keepFocus}
                onClick={submit}
              >
                <SendIcon />
              </button>
            }
          />
          <Tooltip.Content side="top">{t("btw.send")}</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  );
}

/**
 * The /btw side chat panel, laid out after the Aside browser's Ask Aside panel: an inset card beside the conversation
 * with a side picker, the attached-context chip, the side transcript and its own composer. It shows the active main
 * thread's side chats only; without an explicit selection the newest side chat is shown.
 */
export function SidePanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const actions = useActions();
  const askSide = useAskSide();
  const parentId = useAppSelector((state) => state.activeThreadId);
  const parent = useAppSelector((state) => (state.activeThreadId === null ? null : (state.threads[state.activeThreadId] ?? null)));
  const connected = useAppSelector((state) => state.bridge?.state === "connected");
  const sides = useAppSelector((state) => selectSidesOf(state, state.activeThreadId));
  const recorded = useAppSelector((state) => (state.activeThreadId === null ? null : state.btw.selected[state.activeThreadId]));
  const attached = useAppSelector((state) => state.activeThreadId === null || state.btw.detached[state.activeThreadId] !== true);
  const selected = recorded === undefined ? (sides.at(-1) ?? null) : (sides.find((side) => side.id === recorded) ?? null);
  const selectedId = selected?.id ?? null;
  const running = useAppSelector((state) => selectedId !== null && (state.conversations[selectedId]?.activeTurnId ?? null) !== null);
  const notices = useAppSelector((state) => selectPanelNotices(state, state.activeThreadId, selectedId));
  const fallbackTitle = t("conversation.header.newSession");
  const close = useCallback(() => actions.setSidePanel(false), [actions]);

  useEffect(() => {
    if (parentId !== null && selectedId !== null) void actions.selectSide(parentId, selectedId);
  }, [actions, parentId, selectedId]);

  const ask = (question: string): void => {
    if (selected === null) void askSide(question);
    else void actions.sendToSide(selected.id, question);
  };

  return (
    <aside className="relative box-border flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-solid border-border bg-background text-[13px] leading-5 text-foreground [font-family:var(--dsw-font-family)] transition-[opacity,translate] duration-150 ease-out starting:translate-x-3 starting:opacity-0 data-[placement=overlay]:shadow-xl motion-reduce:transition-none" data-testid={TESTID.sidePanel} data-placement={placement} aria-label={t("btw.title")}>
      <header className="flex h-12 flex-none items-center gap-1.5 border-0 border-b border-solid border-border pr-2 pl-3.5" data-window-drag>
        <span className="inline-flex h-[22px] flex-none items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-semibold tracking-wide text-foreground">
          <SparkIcon size={12} />
          {t("btw.badge")}
        </span>
        {parentId !== null && (
          <SidePicker sides={sides} selected={selected} onSelect={(sideId) => void actions.selectSide(parentId, sideId)} />
        )}
        <span className="flex-1" />
        <kbd className="flex-none rounded-md bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground [font-family:var(--dsw-font-family)]" aria-hidden>
          {window.omo.platform === "darwin" ? "⌘E" : "Ctrl+E"}
        </kbd>
      </header>
      {parent === null ? (
        <div className={clsx(INTRO, PAD_X)} data-testid={TESTID.sideIntro}>
          <p className="m-0 text-muted-foreground">{t("btw.noThread")}</p>
        </div>
      ) : selected === null ? (
        <NewSideIntro disabled={!connected} onAsk={(question) => void askSide(question)} />
      ) : (
        <SideTranscript key={selected.id} side={selected} cwd={parent.cwd} />
      )}
      {notices.length > 0 && (
        <div className={clsx("flex flex-none flex-col gap-2 pb-1", PAD_X)}>
          {notices.map((notice) => (
            <SideErrorRow key={notice.id} title={t("btw.error.title")} message={userErrorText(notice.message, t("conversation.error.requestFailed")).text} onDismiss={() => actions.dismissNotice(notice.id)} />
          ))}
        </div>
      )}
      <SideComposer
        parentId={parent === null ? null : parent.id}
        side={selected}
        connected={connected}
        running={running}
        contextChip={
          parent !== null && selected === null ? (
            <ContextChip
              attached={attached}
              title={threadTitle(parent, fallbackTitle)}
              workspace={workspaceName(parent.cwd)}
              onChange={(value) => actions.setSideContext(parent.id, value)}
            />
          ) : null
        }
        onSubmit={ask}
        onStop={() => {
          if (selected !== null) void actions.interruptSide(selected.id);
        }}
        onEscape={close}
      />
    </aside>
  );
}
