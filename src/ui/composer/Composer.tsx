import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, SyntheticEvent } from "react";
import clsx from "clsx";
import { IconFolderOpenOutlineRegular, IconPaperclipOutlineRegular, IconCloseOutlineRegular, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { focusRing } from "../kit";
import { ArrowUpGlyph } from "../glyphs";
import { parseBtwCommand, selectActiveCwd, selectIsTurnActive, selectSkillCatalog } from "../../state";
import type { SkillCatalog } from "../../state";
import { useT } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { useAskSide } from "../btw/use-ask-side";
import { ConversationDock } from "../conversation/ConversationDock";
import { TESTID } from "../testids";
import { updatePreferences, useUiState } from "../ui-state";
import { CheckoutBar } from "./CheckoutBar";
import { ModelPicker } from "./ModelPicker";
import { ContextGauge } from "./ContextGauge";
import { PermissionPicker } from "./PermissionPicker";
import { ReasoningPicker } from "./ReasoningPicker";
import { SkillMenu } from "./SkillMenu";
import type { SkillMenuStatus } from "./SkillMenu";
import { acceptCommand, matchCommands, menuOptions, nativeSkills } from "./commands";
import { useNativeCatalog } from "./use-native-catalog";
import type { MenuOption } from "./commands";
import { detectMagicKeyword, segmentDraft } from "./magic-keyword";
import { acceptSkill, detectSkillTrigger, pruneSelected, rankSkills, serializeSkillDraft } from "./skill-draft";
import type { SkillDraft } from "./skill-draft";
import { capImages, IMAGE_LIMIT, isImageFile, readImage, type ImageInput } from "./attachments";
import { AddMenu, type AddAction } from "./AddMenu";
import { ContextDialog } from "./ContextDialog";
import { SketchDialog } from "./SketchDialog";
import { addContext, contextMessage, CONTEXT_LIMIT, type DraftContext } from "./context-draft";
import { userMessageParts } from "../conversation/UserBubble";
import { userErrorText } from "../conversation/user-error";

/** Ghost 28px chip in the composer row (attach, workspace). */
const chipClass = clsx(
  "m-0 inline-flex h-7 min-w-0 max-w-[min(280px,60cqw)] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2",
  "text-[13px] font-medium leading-5 text-muted-foreground [font-family:inherit]",
  "transition-colors duration-150 hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
  focusRing,
);
/** Removable context chip above the draft. */
const contextChipClass = clsx(
  "m-0 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-solid border-border bg-muted px-2 py-0.5",
  "text-xs leading-5 text-muted-foreground [font-family:inherit] [&>span]:min-w-0 [&>span]:truncate [&>svg]:flex-none hover:text-foreground",
  focusRing,
);
/** The mirror and the textarea share one box, font and wrapping so painted keywords line up with the caret. */
const draftBox = "m-0 box-border block w-full border-0 pt-0.5 pr-2.5 pl-4 [font-family:var(--dsw-font-family)] text-[length:inherit] leading-[inherit] tracking-normal [word-spacing:normal] [overflow-wrap:anywhere] whitespace-pre-wrap";
/** Round 32px primary action; the send button is solid --primary only while it can send. */
const roundAction = clsx(
  "m-0 grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 p-0",
  "transition-colors duration-150 disabled:cursor-default motion-reduce:transition-none",
  focusRing,
);

const NO_THREAD_DRAFT = "";
const EMPTY_DRAFT: SkillDraft = { text: "", selected: [] };
const NO_OPTIONS: readonly MenuOption[] = [];

function menuStatus(hasThread: boolean, loaded: boolean, catalog: SkillCatalog | null): SkillMenuStatus {
  if (!hasThread) return { kind: "startSession" };
  if (!loaded || catalog === null) return { kind: "resumeSession" };
  if (catalog.status === "error") return { kind: "error", message: catalog.errors.map((error) => error.message).join("; ") };
  return catalog.status === "ready" ? { kind: "ready" } : { kind: "loading" };
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}

/**
 * The message capsule at the bottom of the main pane. Drafts are kept per thread for the
 * lifetime of the component; without an active thread, sending first starts a thread in the
 * chosen workspace (the native picker opens when none is known). A "/" token at the caret opens
 * the skill menu; picked skills are sent as the leading `/skill:` run.
 */
export function Composer() {
  const t = useT();
  const actions = useActions();
  const askSide = useAskSide();
  const activeThreadId = useAppSelector((state) => state.activeThreadId);
  const turnActive = useAppSelector(selectIsTurnActive);
  const connected = useAppSelector((state) => state.bridge?.state === "connected");
  const lastWorkspace = useUiState().preferences?.lastWorkspace ?? null;
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null);
  const workspace = pickedWorkspace ?? lastWorkspace;

  const activeCwd = useAppSelector(selectActiveCwd);
  const cwdLoaded = useAppSelector((state) => activeCwd !== null &&
    (state.loadedSkillCwds[activeCwd] === true || selectSkillCatalog(state, activeCwd).status === "ready"));
  const catalogCwd = activeCwd ?? workspace;
  const catalog = useAppSelector((state) => (catalogCwd === null ? null : selectSkillCatalog(state, catalogCwd)));

  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const text = draft.text;
  const [images, setImages] = useState<ImageInput[]>([]);
  const [context, setContext] = useState<DraftContext[]>([]);
  const [planMode, setPlanMode] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [addDialog, setAddDialog] = useState<"terminal" | "goal" | "sketch" | null>(null);
  const contextDrafts = useRef(new Map<string, { context: DraftContext[]; plan: boolean; goal: string }>());
  const contextRef = useRef({ context, plan: planMode, goal: goalDraft });
  contextRef.current = { context, plan: planMode, goal: goalDraft };
  const [imageNotice, setImageNotice] = useState("");
  const [dropping, setDropping] = useState(false);
  const imageDrafts = useRef(new Map<string, ImageInput[]>());
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const addImages = (added: ImageInput[]): void => {
    setImages((current) => {
      if (current.length + added.length > IMAGE_LIMIT) setImageNotice(t("composer.images.limit"));
      return capImages(current, added);
    });
  };
  const addFiles = async (files: File[]): Promise<void> => {
    if (!connected || busy) return;
    setImageNotice("");
    const accepted = files.filter((file) => isImageFile(file.name, file.type));
    const others = files.filter((file) => !accepted.includes(file)).map((file) => window.omo.imageFilePath(file));
    if (others.includes("")) setImageNotice(t("composer.images.rejected"));
    addReferences(others.filter((path) => path !== "").map((value) => ({ kind: "file", value })));
    try { addImages(await Promise.all(accepted.slice(0, IMAGE_LIMIT + 1).map(readImage))); }
    catch (error) { setImageNotice(t("composer.images.error", { message: String(error) })); }
  };
  const addReferences = (added: readonly DraftContext[]): void => {
    setContext(current => {
      const distinct = [...current, ...added].filter((entry, index, all) => all.findIndex(candidate => candidate.kind === entry.kind && candidate.value === entry.value) === index);
      if (distinct.length > CONTEXT_LIMIT) setImageNotice(t("composer.chip.contextLimit"));
      return addContext(current, added);
    });
  };
  const pickReferences = async (kind: "files" | "folder"): Promise<void> => {
    try {
      const paths = await window.omo.pickAttachments(kind);
      const imagePaths = kind === "files" ? paths.filter(path => isImageFile(path)) : [];
      addImages(imagePaths.map(path => ({ type: "localImage", path })));
      addReferences(paths.filter(path => !imagePaths.includes(path)).map(value => ({ kind: kind === "folder" ? "folder" : "file", value })));
    } catch (error) { setImageNotice(userErrorText(error, t("conversation.error.requestFailed")).text); }
  };
  const addAction = (action: AddAction): void => {
    dismissMenu();
    switch (action) {
      case "files": case "folder": void pickReferences(action); break;
      case "terminal": case "goal": case "sketch": setAddDialog(action); break;
      case "plan": setPlanMode(current => !current); break;
    }
  };
  const [caret, setCaret] = useState(0);
  const [composing, setComposing] = useState(false);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [limitReached, setLimitReached] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const drafts = useRef(new Map<string, SkillDraft>());
  const draftThread = useRef(activeThreadId);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseId = useId();
  const listboxId = `${baseId}-skills`;
  const optionId = useCallback((index: number): string => `${baseId}-skill-${index}`, [baseId]);

  useLayoutEffect(() => {
    if (draftThread.current === activeThreadId) return;
    contextDrafts.current.set(draftThread.current ?? NO_THREAD_DRAFT, contextRef.current);
    const nextContext = contextDrafts.current.get(activeThreadId ?? NO_THREAD_DRAFT);
    setContext(nextContext?.context ?? []);
    setPlanMode(nextContext?.plan ?? false);
    setGoalDraft(nextContext?.goal ?? "");
    setAddDialog(null);
    imageDrafts.current.set(draftThread.current ?? NO_THREAD_DRAFT, imagesRef.current);
    setImages(imageDrafts.current.get(activeThreadId ?? NO_THREAD_DRAFT) ?? []);
    setImageNotice("");
    drafts.current.set(draftThread.current ?? NO_THREAD_DRAFT, draftRef.current);
    draftThread.current = activeThreadId;
    const next = drafts.current.get(activeThreadId ?? NO_THREAD_DRAFT) ?? EMPTY_DRAFT;
    setDraft(next);
    pendingCaret.current = null;
    setCaret(next.text.length);
    setDismissedStart(null);
    setLimitReached(false);
  }, [activeThreadId]);

  useLayoutEffect(() => {
    const target = pendingCaret.current;
    const el = inputRef.current;
    if (target === null || el === null) return;
    pendingCaret.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(target, target);
  }, [draft]);

  const trigger = connected && !composing ? detectSkillTrigger(text, caret) : null;
  const menuOpen = trigger !== null && trigger.start !== dismissedStart;
  const nativeCatalog = useNativeCatalog(activeCwd, menuOpen && activeThreadId !== null);
  const triggerKey = trigger === null ? "" : `${trigger.start}:${trigger.query}`;
  const status = menuStatus(activeThreadId !== null, cwdLoaded, catalog);
  const query = trigger?.query ?? "";
  const catalogSkills = useMemo(() => catalog?.skills !== undefined && catalog.skills.length > 0 ? catalog.skills :
    nativeCatalog === null ? catalog?.skills : nativeSkills(nativeCatalog.commands), [catalog?.skills, nativeCatalog]);
  const rows = useMemo(
    () => (menuOpen && cwdLoaded && catalogSkills !== undefined ? rankSkills(catalogSkills, query) : []),
    [menuOpen, cwdLoaded, catalogSkills, query],
  );
  const options = useMemo(
    () => (menuOpen ? menuOptions(matchCommands(query, nativeCatalog?.commands), rows, query) : NO_OPTIONS),
    [menuOpen, rows, query, nativeCatalog],
  );
  const activeIndex =
    options.length === 0 ? -1 : highlight.key === triggerKey ? Math.min(highlight.index, options.length - 1) : 0;
  const triggerStart = useRef<number | null>(null);
  triggerStart.current = trigger?.start ?? null;

  const catalogStatus = catalog?.status;
  useEffect(() => {
    if (menuOpen && activeCwd !== null) void actions.ensureSkills(activeCwd);
  }, [actions, menuOpen, cwdLoaded, activeCwd, catalogStatus]);

  const keepDismissal = (nextText: string, selection: number): void => {
    setDismissedStart((dismissed) =>
      dismissed !== null && detectSkillTrigger(nextText, selection)?.start === dismissed ? dismissed : null,
    );
  };

  const edit = (nextText: string, selection: number): void => {
    pendingCaret.current = null;
    if (detectSkillTrigger(nextText, selection) === null) setHighlight({ key: "", index: 0 });
    setDraft((current) => ({ text: nextText, selected: pruneSelected(nextText, current.selected) }));
    setCaret(selection);
    setLimitReached(false);
    keepDismissal(nextText, selection);
  };

  const onSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    const selection = event.currentTarget.selectionStart;
    setCaret(selection);
    keepDismissal(event.currentTarget.value, selection);
  };

  const dismissMenu = useCallback((): void => {
    setDismissedStart(triggerStart.current);
    setLimitReached(false);
  }, []);

  const localCommand = async (name: string, argument = ""): Promise<void> => {
    setDismissedStart(null);
    setHighlight({ key: "", index: 0 });
    setLimitReached(false);
    try {
      switch (name) {
        case "compact":
          if (activeThreadId !== null) await window.omo.request("thread/compact/start", { threadId: activeThreadId });
          break;
        case "goal":
          if (argument === "") setAddDialog("goal");
          else if (activeThreadId !== null) await window.omo.request("thread/goal/set", { threadId: activeThreadId, objective: argument });
          else setGoalDraft(argument);
          break;
        case "model": document.querySelector<HTMLButtonElement>(`[data-testid="${TESTID.modelPicker}"]`)?.click(); break;
        case "plan": setPlanMode(current => !current); break;
      }
    } catch (error) {
      setImageNotice(userErrorText(error, t("conversation.error.requestFailed")).text);
    }
  };

  const pickOption = (index: number): void => {
    const option = options[index];
    if (option === undefined || trigger === null) return;
    if (option.kind === "command") {
      if (trigger.start === 0 && option.command.source === undefined && ["compact", "goal", "model", "plan"].includes(option.command.name)) {
        const remaining = draft.text.slice(trigger.end).trim();
        setDraft({ text: option.command.name === "goal" ? "" : remaining, selected: pruneSelected(remaining, draft.selected) });
        setCaret(remaining.length);
        void localCommand(option.command.name, option.command.name === "goal" ? remaining : "");
        return;
      }
      const accepted = acceptCommand(draft.text, trigger, option.command.name);
      pendingCaret.current = accepted.caret;
      setDraft({ text: accepted.text, selected: pruneSelected(accepted.text, draft.selected) });
      setCaret(accepted.caret);
      setLimitReached(false);
      return;
    }
    const result = acceptSkill(draft, trigger, option.skill.name);
    if (!result.ok) {
      setLimitReached(true);
      return;
    }
    pendingCaret.current = result.caret;
    setDraft(result.draft);
    setCaret(result.caret);
    setLimitReached(false);
  };

  const fit = useCallback((): void => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = "0px";
    const max = parseFloat(getComputedStyle(el).maxHeight);
    el.style.height = `${Number.isFinite(max) ? Math.min(el.scrollHeight, max) : el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit, text]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [fit]);

  const blank = text.trim() === "";
  const canSend = connected && (!blank || images.length > 0 || context.length > 0 || goalDraft !== "") && !busy;
  const keyword = detectMagicKeyword(text);
  const segments = useMemo(() => segmentDraft(text), [text]);
  const syncMirrorScroll = (): void => {
    const mirror = mirrorRef.current;
    const el = inputRef.current;
    if (mirror !== null && el !== null) mirror.scrollTop = el.scrollTop;
  };
  useLayoutEffect(syncMirrorScroll, [text]);

  const pickWorkspace = async (): Promise<string | null> => {
    const dir = await window.omo.pickDirectory(workspace);
    if (dir === null) return null;
    setPickedWorkspace(dir);
    void updatePreferences({ lastWorkspace: dir });
    return dir;
  };

  const routeSideCommand = (question: string): void => {
    actions.setSidePanel(true);
    if (activeThreadId === null) return;
    setDraft(EMPTY_DRAFT);
    setDismissedStart(null);
    if (question !== "") void askSide(question);
  };

  const submit = async (): Promise<void> => {
    let message = text.trim();
    if (!canSend) return;
    const local = /^\/(compact|goal|model|plan)(?:\s+(.*))?$/s.exec(message);
    const slashPlan = local?.[1] === "plan" && (local[2]?.trim() ?? "") !== "";
    if (slashPlan) message = local?.[2]?.trim() ?? "";
    else if (local !== null) {
      setDraft(EMPTY_DRAFT);
      await localCommand(local[1]!, local[2]?.trim() ?? "");
      return;
    }
    const command = parseBtwCommand(message);
    if (command !== null && images.length === 0 && context.length === 0 && goalDraft === "" && !planMode) {
      routeSideCommand(command.question);
      return;
    }
    const selected = draft.selected;
    const contextual = contextMessage(message || goalDraft, context);
    const serialized = serializeSkillDraft({ text: contextual, selected });
    const transport = (planMode || slashPlan) && !selected.includes("ulw-plan") ? `/skill:ulw-plan ${serialized}` : serialized;
    setBusy(true);
    let targetThreadId = activeThreadId;
    let accepted = false;
    try {
      if (activeThreadId === null) {
        const cwd = workspace ?? (await pickWorkspace());
        if (cwd === null) return;
        const threadId = await actions.newThread(cwd);
        if (threadId === null) return;
        targetThreadId = threadId;
        drafts.current.delete(NO_THREAD_DRAFT);
      }
      if (goalDraft !== "" && targetThreadId !== null) {
        // Paused persists the goal without launching an idle thread ahead of its contextual message.
        await window.omo.request("thread/goal/set", { threadId: targetThreadId, objective: goalDraft, status: "paused" });
      }
      setDraft(EMPTY_DRAFT);
      setImages([]);
      setContext([]);
      setGoalDraft("");
      contextDrafts.current.delete(NO_THREAD_DRAFT);
      imageDrafts.current.delete(NO_THREAD_DRAFT);
      setDismissedStart(null);
      const sent = await actions.sendMessage(transport, images);
      accepted = sent;
      if (!sent) {
        setPlanMode(planMode);
        setContext(current => addContext(context, current));
        setGoalDraft(current => current || goalDraft);
        setImages((current) => capImages(images, current));
        setDraft((current) => (current.text === "" ? { text: message, selected: pruneSelected(message, selected) } : current));
        setCaret(message.length);
      } else {
        setPlanMode(false);
        if (goalDraft !== "" && targetThreadId !== null) {
          await window.omo.request("thread/goal/set", { threadId: targetThreadId, status: "active" });
        }
      }
    } catch (error) {
      setImageNotice(userErrorText(error, t("conversation.error.requestFailed")).text);
      if (!accepted) {
        setPlanMode(planMode);
        setContext(current => addContext(context, current));
        setGoalDraft(current => current || goalDraft);
        setImages(current => capImages(images, current));
        setDraft(current => current.text === "" ? { text: message, selected } : current);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length === 0) return;
        const offset = event.key === "ArrowDown" ? 1 : -1;
        setHighlight({ key: triggerKey, index: (activeIndex + offset + options.length) % options.length });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissMenu();
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && activeIndex >= 0) {
        event.preventDefault();
        pickOption(activeIndex);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submit();
  };

  const keepFocus = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
  };

  const placeholder = !connected
    ? t("composer.placeholder.disconnected")
    : activeThreadId === null
      ? workspace === null
        ? t("composer.placeholder.heroNoWorkspace")
        : t("composer.placeholder.hero", { workspace: basename(workspace) })
      : turnActive
        ? t("composer.placeholder.running")
        : t("composer.placeholder.idle");
  // A /btw or /side draft goes to the side panel, so it never steers the running turn.
  const steers = turnActive && parseBtwCommand(text) === null;
  const sendLabel = steers ? t("composer.steer") : t("composer.send");

  return (
    <div className="flex flex-none flex-col items-center px-5 pb-4 [--dsh-composer-card-max-width:var(--container-3xl)]">
      <ConversationDock />
      <div
        className={clsx(
          "relative box-border flex w-full max-w-3xl flex-col gap-2.5 rounded-2xl border border-solid pt-2.5",
          "bg-composer text-sm leading-6 text-composer-foreground shadow-xs transition-colors duration-150 motion-reduce:transition-none",
          keyword !== null ? "border-primary" : dropping ? "border-ring bg-accent" : connected ? "border-border focus-within:border-input" : "border-border/60",
        )}
        data-testid={TESTID.composer}
        data-composer-card=""
        data-keyword={keyword?.keyword}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDropping(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
        onDrop={(event) => { event.preventDefault(); setDropping(false); void addFiles(Array.from(event.dataTransfer.files)); }}
      >
        {menuOpen && (
          <SkillMenu
            listboxId={listboxId}
            optionId={optionId}
            status={status}
            options={options}
            diagnostics={status.kind === "ready" ? (catalog?.errors ?? []) : []}
            catalogEmpty={catalogSkills === undefined || catalogSkills.length === 0}
            activeIndex={activeIndex}
            limitReached={limitReached}
            onPick={pickOption}
            onHover={(index) => setHighlight({ key: triggerKey, index })}
            onRetry={() => {
              if (activeCwd !== null) void actions.loadSkills(activeCwd, { force: true });
            }}
            onDismiss={dismissMenu}
          />
        )}
        {dropping && <div className="px-4 text-[13px] text-muted-foreground" role="status">{t("composer.images.drop")}</div>}
        {images.length > 0 && <div className="flex flex-wrap gap-2.5 px-4 py-1">
          {userMessageParts(images).images.map((image, index) => <div key={image.key} className="relative size-[72px]" data-testid={TESTID.attachmentThumbnail}>
            <img className="size-full rounded-sm border border-solid border-border object-cover" src={image.src} alt={t("composer.images.preview", { number: index + 1 })} />
            <button type="button" className={clsx("absolute -top-1 -right-1 m-0 grid size-[22px] cursor-pointer place-items-center rounded-sm border border-solid border-border bg-composer p-0 text-composer-foreground", focusRing)} data-testid={TESTID.attachmentRemove} aria-label={t("composer.images.remove", { number: index + 1 })} onClick={() => setImages((current) => current.filter((_, position) => position !== index))}><IconCloseOutlineRegular size={14} /></button>
          </div>)}
        </div>}
        {imageNotice !== "" && <div className="px-4 text-[13px] text-muted-foreground" data-testid={TESTID.attachmentNotice} role="status">{imageNotice}</div>}
        {(context.length > 0 || planMode || goalDraft !== "") && <div className="flex flex-wrap gap-1.5 px-4">
          {context.map((entry, index) => <button type="button" key={`${entry.kind}:${entry.value}`} data-testid="context-chip" className={contextChipClass}
            title={entry.value} aria-label={`${t("composer.chip.removeAttachment")}: ${entry.kind === "terminal" ? "WindowsTerminal" : basename(entry.value)}`}
            onClick={() => setContext(current => current.filter((_, position) => position !== index))}>
            <span>{entry.kind === "terminal" ? "WindowsTerminal" : basename(entry.value)}</span><IconCloseOutlineRegular size={12} />
          </button>)}
          {planMode && <button type="button" className={contextChipClass} data-testid="plan-mode-chip" aria-label={t("composer.chip.removePlan")} onClick={() => setPlanMode(false)}>{t("composer.chip.planChip")}<IconCloseOutlineRegular size={12} /></button>}
          {goalDraft !== "" && <button type="button" className={contextChipClass} data-testid="goal-draft-chip" title={goalDraft} aria-label={t("composer.chip.removeGoal")} onClick={() => setGoalDraft("")}><span>{t("composer.chip.goalChip")}: {goalDraft}</span><IconCloseOutlineRegular size={12} /></button>}
        </div>}
        <div className="relative mr-1">
          <div
            ref={mirrorRef}
            className={clsx(draftBox, "pointer-events-none absolute inset-0 overflow-hidden pr-[calc(10px+var(--dsh-scrollbar-width,5px))] select-none", connected ? "text-composer-foreground" : "text-muted-foreground")}
            aria-hidden
          >
            {segments.map((segment, index) =>
              segment.kind === "keyword" ? (
                <span key={index} className="font-medium text-primary" data-testid={TESTID.keywordHighlight}>
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
            {"\u200b"}
          </div>
          <textarea
            ref={inputRef}
            className={clsx(
              draftBox,
              "relative max-h-[292px] min-h-[52px] resize-none overflow-y-scroll bg-transparent text-transparent caret-composer-foreground outline-none [scrollbar-gutter:stable]",
              "placeholder:text-composer-placeholder disabled:cursor-not-allowed disabled:placeholder:opacity-60",
            )}
            data-testid={TESTID.composerInput}
            data-thread-id={activeThreadId ?? ""}
            aria-label={t("composer.inputLabel")}
            role="combobox"
            aria-multiline
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? listboxId : undefined}
            aria-activedescendant={menuOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder={placeholder}
            rows={1}
            value={text}
            disabled={!connected}
            onChange={(event) => edit(event.target.value, event.target.selectionStart)}
            onSelect={onSelect}
            onCompositionStart={() => {
              composingRef.current = true;
              setComposing(true);
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              setComposing(false);
              setCaret(event.currentTarget.selectionStart);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) { event.preventDefault(); void addFiles(files); }
            }}
            onKeyDown={onKeyDown}
            onScroll={syncMirrorScroll}
          />
        </div>
        {keyword !== null && (
          <div className="mx-4 mt-0.5 block text-[13px] leading-[18px] [overflow-wrap:anywhere] text-muted-foreground" data-testid={TESTID.keywordHint} role="status">
            <span className="font-semibold text-primary">{keyword.text}</span>
            {t(keyword.keyword === "mass-ulw" ? "composer.keyword.massHint" : "composer.keyword.hint")}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 pt-0.5 pr-2.5 pb-2.5 pl-3 [container-type:inline-size]">
          <div className="flex min-w-0 items-center gap-2">
            <AddMenu disabled={!connected || busy} skills={catalogSkills ?? []} loading={catalog?.status === "loading"}
              plan={planMode} onOpen={() => {
                dismissMenu();
                const targetCwd = activeCwd ?? workspace;
                if (targetCwd !== null) void actions.ensureSkills(targetCwd);
              }} onAction={addAction} onSkill={skill => {
                const base = draft.text === "" ? "/" : `${draft.text} /`;
                const result = acceptSkill({ text: base, selected: draft.selected }, { start: base.length - 1, end: base.length, query: "" }, skill.name);
                if (!result.ok) { setImageNotice(t("composer.skills.limit", { max: 5 })); return; }
                pendingCaret.current = result.caret;
                setDraft(result.draft);
                setCaret(result.caret);
              }} />
            {connected && <PermissionPicker disabled={!connected} />}
            {activeThreadId === null && (
              <button
                type="button"
                className={chipClass}
                data-testid={TESTID.workspaceChip}
                aria-label={workspace === null ? t("composer.workspace.choose") : t("composer.workspace.label", { path: workspace })}
                title={workspace ?? undefined}
                disabled={!connected}
                onClick={() => void pickWorkspace()}
              >
                <IconFolderOpenOutlineRegular className="flex-none opacity-70" size={14} />
                <span className="min-w-0 truncate">{workspace === null ? t("composer.workspace.choose") : basename(workspace)}</span>
              </button>
            )}
          </div>
          <div className="ml-auto flex min-w-0 flex-none items-center gap-2">
            {steers && !blank && (
              <span className="flex-none rounded-sm bg-muted px-2 text-xs leading-[22px] whitespace-nowrap text-muted-foreground" data-testid={TESTID.steeringHint}>
                {t("composer.steering")}
              </span>
            )}
            <ContextGauge />
            <div className="flex min-w-0 items-center gap-0.5" role="group" aria-label={t("composer.modelGroup")}>
              <ModelPicker disabled={!connected} />
              <ReasoningPicker disabled={!connected} />
            </div>
            <button type="button" className={clsx(chipClass, "w-7 justify-center px-0")} data-testid={TESTID.attachmentPick} aria-label={t("composer.images.attach")} disabled={!connected || busy} onClick={() => void pickReferences("files")}><IconPaperclipOutlineRegular size={16} /></button>
            {turnActive && (
              <Tooltip label={t("composer.stop")} side="top" delayMs={500}>
                <button
                  type="button"
                  className={clsx(roundAction, "bg-secondary text-secondary-foreground hover:bg-accent")}
                  data-testid={TESTID.composerStop}
                  aria-label={t("composer.stop")}
                  onMouseDown={keepFocus}
                  onClick={() => void actions.interrupt()}
                >
                  <StopIcon />
                </button>
              </Tooltip>
            )}
            <Tooltip label={sendLabel} side="top" delayMs={500} disabled={!canSend}>
              <button
                type="button"
                className={clsx(roundAction, canSend ? "bg-composer-send text-composer-send-foreground hover:bg-composer-send/90" : "bg-muted text-muted-foreground")}
                data-testid={TESTID.composerSend}
                aria-label={sendLabel}
                disabled={!canSend}
                onMouseDown={keepFocus}
                onClick={() => void submit()}
              >
                <ArrowUpGlyph size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <CheckoutBar />
      {addDialog === "sketch" && <SketchDialog onClose={() => setAddDialog(null)} onAttach={image => { addImages([image]); setAddDialog(null); }} />}
      {(addDialog === "terminal" || addDialog === "goal") && <ContextDialog kind={addDialog} onClose={() => setAddDialog(null)} onAccept={value => {
        if (addDialog === "terminal") addReferences([{ kind: "terminal", value }]);
        else setGoalDraft(value);
        setAddDialog(null);
        inputRef.current?.focus({ preventScroll: true });
      }} />}
    </div>
  );
}
