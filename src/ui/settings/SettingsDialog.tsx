// Full-window settings: a nav rail (Back to app, search, grouped sections) beside a breadcrumb header and the section page.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Archive,
  ArrowLeft,
  Import,
  Info,
  Keyboard,
  KeyRound,
  MonitorSmartphone,
  PanelLeft,
  Palette,
  Plug,
  RotateCcw,
  Search,
  Server,
  Settings2,
  Smartphone,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useModalLayer } from "../lib/modal-layer";
import { useT } from "../../i18n";
import type { MessageKey, Translate } from "../../i18n";
import { TESTID } from "../testids";
import { uiState, updatePreferences, useUiState } from "../ui-state";
import type { SettingsSection } from "../ui-state";
import { DEFAULT_PREFERENCES } from "../../../shared/ipc";
import { useAppStore } from "../../state";
import { Button, IconButton, focusRing } from "../kit";
import { AboutSection } from "./AboutSection";
import { ArchivedSection } from "./ArchivedSection";
import { AccountsSection } from "./AccountsSection";
import { AndroidSection } from "./AndroidSection";
import { GeneralSection } from "./GeneralSection";
import { AppearanceSection } from "./AppearanceSection";
import { DevicesSection } from "./DevicesSection";
import { ImportSection } from "./ImportSection";
import { IphoneSection } from "./IphoneSection";
import { KeybindingsSection } from "./KeybindingsSection";
import { McpSection } from "./McpSection";
import { ModelSection } from "./ModelSection";
import { OmoSection } from "./OmoSection";
import { SkillsSection } from "./SkillsSection";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

type SectionId = SettingsSection;

interface SectionEntry {
  id: SectionId;
  label: MessageKey;
  icon: LucideIcon;
  /** Names of the settings on the page; the nav search matches them besides the label. */
  keys: readonly MessageKey[];
  /** Untranslated product names the nav search matches. */
  terms: readonly string[];
  render: () => ReactNode;
}

interface SectionGroup {
  id: string;
  label: MessageKey;
  sections: readonly SectionEntry[];
}

const IPHONE: readonly SectionEntry[] =
  window.omo.platform === "darwin"
    ? [{ id: "iphone", label: "shell.settings.nav.iphone", icon: Smartphone, keys: [], terms: ["USB"], render: () => <IphoneSection /> }]
    : [];

const GROUPS: readonly SectionGroup[] = [
  {
    id: "app",
    label: "shell.settings.group.app",
    sections: [
      {
        id: "general",
        label: "shell.settings.nav.general",
        icon: Settings2,
        keys: ["shell.settings.theme", "shell.settings.language", "shell.settings.threadNotifications", "shell.settings.timeFormat", "shell.settings.autoSettle"],
        terms: [],
        render: () => <GeneralSection />,
      },
      {
        id: "appearance",
        label: "shell.settings.nav.appearance",
        icon: Palette,
        keys: ["shell.settings.theme", "shell.settings.theme.light", "shell.settings.theme.dark"],
        terms: [],
        render: () => <AppearanceSection />,
      },
      {
        id: "keybindings",
        label: "shell.settings.nav.keybindings",
        icon: Keyboard,
        keys: ["shell.toggleSidebar", "btw.toggle", "composer.send"],
        terms: [],
        render: () => <KeybindingsSection />,
      },
    ],
  },
  {
    id: "omo",
    label: "app.brand",
    sections: [
      {
        id: "model",
        label: "shell.settings.nav.model",
        icon: Sparkles,
        keys: ["composer.profile.tab", "composer.profile.daily", "composer.profile.geeky", "composer.profile.automatic"],
        terms: [],
        render: () => <ModelSection />,
      },
      {
        id: "omo",
        label: "shell.settings.nav.runtime",
        icon: Server,
        keys: [
          "shell.settings.omo.autoUpdate",
          "shell.settings.omo.sharedHost",
          "shell.settings.omo.serverTitle",
          "shell.settings.omo.installTitle",
          "shell.settings.proxy.url",
          "shell.settings.proxy.key",
        ],
        terms: ["omo", "opencodex"],
        render: () => <OmoSection />,
      },
      {
        id: "skills",
        label: "shell.settings.nav.skills",
        icon: Wand2,
        keys: ["shell.settings.skills.intro"],
        terms: ["skills"],
        render: () => <SkillsSection />,
      },
      {
        id: "accounts",
        label: "shell.settings.nav.accounts",
        icon: KeyRound,
        keys: ["shell.settings.accounts.signIn"],
        terms: ["opencodex", "Claude", "ChatGPT"],
        render: () => <AccountsSection />,
      },
      {
        id: "mcp",
        label: "shell.settings.nav.mcp",
        icon: Plug,
        keys: ["shell.settings.mcp.import"],
        terms: ["mcp.json"],
        render: () => <McpSection />,
      },
    ],
  },
  {
    id: "workspace",
    label: "shell.settings.group.workspace",
    sections: [
      {
        id: "import",
        label: "shell.settings.nav.import",
        icon: Import,
        keys: ["shell.import.title", "shell.settings.import.syncTitle"],
        terms: [],
        render: () => <ImportSection />,
      },
      {
        id: "archived",
        label: "shell.settings.nav.archived",
        icon: Archive,
        keys: ["shell.settings.archived.restore"],
        terms: [],
        render: () => <ArchivedSection />,
      },
      {
        id: "android",
        label: "shell.settings.nav.android",
        icon: Smartphone,
        keys: ["shell.settings.android.refresh"],
        terms: ["ADB", "USB"],
        render: () => <AndroidSection />,
      },
      ...IPHONE,
      {
        id: "devices",
        label: "shell.settings.nav.devices",
        icon: MonitorSmartphone,
        keys: ["shell.settings.devices.memory"],
        terms: ["Windows", "Git"],
        render: () => <DevicesSection />,
      },
    ],
  },
  {
    id: "about",
    label: "shell.settings.group.info",
    sections: [
      {
        id: "about",
        label: "shell.settings.nav.about",
        icon: Info,
        keys: ["shell.settings.about.appVersion", "shell.settings.about.electronVersion"],
        terms: [],
        render: () => <AboutSection />,
      },
    ],
  },
];

const SECTIONS = GROUPS.flatMap((group) => group.sections);

/** True when the trimmed, case-insensitive `query` is empty or occurs in the section's label, id or search words. */
function sectionMatches(entry: SectionEntry, query: string, t: Translate): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [t(entry.label), entry.id, ...entry.keys.map((key) => t(key)), ...entry.terms].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

/** Below this width the nav rail leaves the row and opens over the page from the header toggle. */
const NARROW_QUERY = "(max-width: 720px)";

function subscribeNarrow(notify: () => void): () => void {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches);
}

const kbdClass = "ml-auto rounded border border-solid border-border bg-background px-1.5 font-mono text-xs leading-4.5 text-muted-foreground";

const navCellClass = clsx(
  "relative box-border m-0 flex h-8 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5",
  "[font-family:inherit] text-sm leading-5 text-sidebar-foreground/80 no-underline transition-colors duration-150 motion-reduce:transition-none",
  "hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4 [&_svg]:shrink-0",
  "aria-[current=true]:bg-sidebar-accent aria-[current=true]:font-medium aria-[current=true]:text-sidebar-foreground",
  "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent aria-[current=true]:before:bg-sidebar-primary",
  focusRing,
);

function SettingsPanel({ section, onSelect, onClose }: { section: SectionId; onSelect(section: SectionId): void; onClose(): void }) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const store = useAppStore();
  const narrow = useNarrow();
  const drawerOpen = narrow && navOpen;
  useModalLayer(panel, !drawerOpen, onClose);
  useModalLayer(nav, drawerOpen, () => setNavOpen(false));
  useLayoutEffect(() => {
    content.current?.toggleAttribute("inert", drawerOpen);
  }, [drawerOpen]);
  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key !== "/") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      event.preventDefault();
      if (narrow) setNavOpen(true);
      search.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [narrow]);

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, sections: group.sections.filter((entry) => sectionMatches(entry, query, t)) })).filter(
        (group) => group.sections.length > 0,
      ),
    [query, t],
  );
  const firstMatch = groups[0]?.sections[0];
  const current = SECTIONS.find((entry) => entry.id === section)!;
  const toggleLabel = t(navOpen ? "shell.hideSidebar" : "shell.showSidebar");

  // The drawer takes focus when it opens and hands it back to the toggle when it closes.
  const wasDrawerOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen) search.current?.focus();
    else if (wasDrawerOpen.current) toggle.current?.focus();
    wasDrawerOpen.current = drawerOpen;
  }, [drawerOpen]);

  const select = (id: SectionId): void => {
    onSelect(id);
    setNavOpen(false);
  };

  const clearSearch = (): void => {
    setQuery("");
    search.current?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && query !== "") {
      // The modal layer skips prevented keys, so this Escape clears the search instead of closing settings.
      event.preventDefault();
      setQuery("");
    } else if (event.key === "Enter" && firstMatch !== undefined) {
      event.preventDefault();
      select(firstMatch.id);
    }
  };

  const restoreDefaults = (): void => {
    setConfirmingReset(false);
    updatePreferences({ ...DEFAULT_PREFERENCES, onboardingCompleted: true, modelProfile: null, profileModels: {} }).then(
      () => {
        setResetError(null);
        store.dispatch({ type: "composer/modelSelected", modelId: null, effort: null, profile: null });
      },
      (error: unknown) => setResetError(errorMessage(error)),
    );
  };

  return createPortal(
    <div
      ref={panel}
      tabIndex={-1}
      className="fixed inset-0 z-1000 flex bg-background font-sans text-foreground outline-none [word-break:keep-all] wrap-break-word"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={TESTID.settingsDialog}
      data-active-section={section}
      data-narrow={narrow || undefined}
    >
      <nav
        ref={nav}
        className={clsx(
          "box-border flex w-65 flex-none flex-col [&[hidden]]:hidden border-0 border-r border-solid border-sidebar-border bg-sidebar px-2.5 pb-3 text-sidebar-foreground",
          narrow ? "absolute inset-y-0 left-0 z-20 shadow-xl" : "relative",
        )}
        aria-label={t("shell.settings.sections")}
        hidden={narrow && !navOpen}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-13" data-window-drag />
        <button
          type="button"
          className={clsx(navCellClass, "mt-2.5 h-9 font-medium text-sidebar-foreground")}
          data-testid="settings-back"
          onClick={onClose}
        >
          <ArrowLeft aria-hidden="true" />
          <span className="min-w-0 truncate">{t("shell.settings.backToApp")}</span>
          <kbd className={kbdClass} aria-hidden="true">Esc</kbd>
        </button>
        <div
          className="relative mx-0.5 mt-3 mb-2 box-border flex h-9 flex-none items-center gap-2 rounded-md border border-solid border-input bg-background px-2.5 text-muted-foreground focus-within:border-ring"
          role="search"
        >
          <Search aria-hidden="true" className="size-3.5 flex-none" />
          <input
            ref={search}
            type="text"
            className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 [font-family:inherit] text-sm text-foreground outline-none placeholder:text-muted-foreground"
            data-testid="settings-search"
            aria-label={t("shell.settings.search")}
            placeholder={t("shell.settings.search")}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {query === "" ? (
            <kbd className={kbdClass} aria-hidden="true">/</kbd>
          ) : (
            <button
              type="button"
              className={clsx("-mr-1 inline-flex size-5 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground", focusRing)}
              aria-label={t("shell.search.clear")}
              onClick={clearSearch}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1 pr-2 pb-4 [scrollbar-gutter:stable]">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5" role="group" aria-labelledby={`${titleId}-${group.id}`}>
              <div className="px-2.5 pb-1 text-xs font-medium leading-4 text-muted-foreground" id={`${titleId}-${group.id}`}>
                {t(group.label)}
              </div>
              {group.sections.map((entry) => (
                <button
                  key={entry.id}
                  data-testid={TESTID.settingsNavItem}
                  type="button"
                  className={navCellClass}
                  aria-current={entry.id === section ? "true" : undefined}
                  data-section={entry.id}
                  data-modal-autofocus={entry.id === section && !narrow ? "" : undefined}
                  onClick={() => select(entry.id)}
                >
                  <entry.icon aria-hidden="true" />
                  <span className="min-w-0 truncate">{t(entry.label)}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="m-0 px-2.5 py-2 text-sm leading-5 text-muted-foreground" role="status" data-testid="settings-search-empty">
              {t("shell.settings.search.noMatch", { query: query.trim() })}
            </p>
          )}
        </div>
      </nav>
      {drawerOpen && <div className="absolute inset-0 z-10 bg-background/60" aria-hidden="true" onClick={() => setNavOpen(false)} />}
      <div ref={content} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 flex-none items-center border-0 border-b border-solid border-border px-6" data-window-drag>
          <div className="flex min-w-0 items-center gap-2">
            {narrow && (
              <IconButton
                ref={toggle}
                icon={<PanelLeft aria-hidden="true" />}
                label={toggleLabel}
                data-testid="settings-nav-toggle"
                data-modal-autofocus=""
                aria-expanded={navOpen}
                onClick={() => setNavOpen((open) => !open)}
              />
            )}
            <div className="flex min-w-0 items-center gap-2 text-sm leading-5" data-testid="settings-breadcrumb">
              <span className="text-muted-foreground" id={titleId}>
                {t("shell.settings.title")}
              </span>
              <span className="text-muted-foreground/60" aria-hidden="true">
                /
              </span>
              <h2 className="m-0 truncate text-sm font-medium text-foreground">{t(current.label)}</h2>
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto box-border flex w-full max-w-196 flex-col items-center gap-6 px-8 pt-8 pb-12" key={section}>
            {current.render()}
            <div className={clsx(ui.card, "max-w-180")}>
              <div className="flex flex-wrap items-center gap-3 py-4">
                {confirmingReset ? (
                  <div className="flex flex-wrap items-center gap-3" role="alertdialog" aria-label={t("shell.settings.restoreConfirm")}>
                    <p className={ui.text}>{t("shell.settings.restoreConfirm")}</p>
                    <Button variant="outline" size="sm" onClick={() => setConfirmingReset(false)}>{t("common.cancel")}</Button>
                    <Button variant="destructive" size="sm" icon={<RotateCcw aria-hidden="true" />} data-testid={TESTID.settingsRestoreConfirm} onClick={restoreDefaults}>
                      {t("shell.settings.restoreConfirmAction")}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" icon={<RotateCcw aria-hidden="true" />} data-testid={TESTID.settingsRestoreDefaults} onClick={() => setConfirmingReset(true)}>
                    {t("shell.settings.restoreDefaults")}
                  </Button>
                )}
                {resetError && <ErrorText>{resetError}</ErrorText>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SettingsDialog() {
  const { settingsOpen, settingsSection } = useUiState();
  if (!settingsOpen) return null;
  return <SettingsPanel section={settingsSection} onSelect={uiState.setSettingsSection} onClose={() => uiState.setSettingsOpen(false)} />;
}
