import { useEffect, useId, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import clsx from "clsx";
import { Activity, ChevronRight, Copy, Eye, EyeOff, LoaderCircle, RefreshCw, RotateCw, ServerCog, SquareTerminal, TriangleAlert } from "lucide-react";
import type { SshHost, SshHostState, SshInventory, SshSpecs, SshStatus } from "../../../shared/servers";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { selectMainThreadId, useAppStore } from "../../state";
import { Badge, Button, focusRing, IconButton, Tooltip } from "../kit";
import { relativeTime } from "../lib/relative-time";
import { updatePreferences, useUiState } from "../ui-state";
import { hostAddress, osBadge, sizeFromGb, sizeFromMb, uptime } from "./format";
import { openTerminalCommand, setTerminalTarget } from "./terminal-bridge";

const STATUS_LABEL: Record<SshStatus, MessageKey> = {
  online: "servers.status.online",
  "auth-failed": "servers.status.authFailed",
  unreachable: "servers.status.unreachable",
  unknown: "servers.status.unknown",
};

const DOT: Record<SshStatus, string> = {
  online: "bg-success",
  "auth-failed": "bg-warning",
  unreachable: "bg-destructive-foreground",
  unknown: "bg-muted-foreground/50",
};

function emptyState(alias: string): SshHostState {
  return { alias, status: "unknown", latencyMs: null, checkedAt: null, message: null, specs: null, specsAt: null, probing: false };
}

function ago(t: Translate, at: number | null, now: number): string {
  if (at === null) return t("servers.never");
  const { unit, n } = relativeTime(at, now);
  return t(`servers.ago.${unit}`, { n });
}

function StatusDot({ state }: { state: SshHostState }) {
  if (state.probing) return <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin text-muted-foreground" />;
  return <span aria-hidden className={clsx("size-2 shrink-0 rounded-full", DOT[state.status])} />;
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content side="bottom">{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

export function ServersPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const store = useAppStore();
  const hidden = useUiState().preferences?.hiddenSshHosts ?? [];
  const [inventory, setInventory] = useState<SshInventory | null>(null);
  const [states, setStates] = useState<Record<string, SshHostState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const headingId = useId();

  useEffect(() => {
    setTerminalTarget(() => {
      const state = store.getState();
      const threadId = selectMainThreadId(state);
      const cwd = threadId === null ? undefined : state.threads[threadId]?.cwd;
      return threadId === null || cwd === undefined ? null : { threadId, cwd };
    });
  }, [store]);

  useEffect(() => {
    let active = true;
    window.omo.listSshHosts().then((next) => {
      if (!active) return;
      setInventory(next);
      setStates(next.states);
      setSelected((current) => current !== null && next.hosts.some((host) => host.alias === current) ? current : next.hosts.find((host) => !hidden.includes(host.alias))?.alias ?? null);
    }, (error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => window.omo.onSshHostState((state) => setStates((current) => ({ ...current, [state.alias]: state }))), []);

  // Relative "checked" times stay current while the panel is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const hosts = inventory?.hosts ?? [];
  const shown = hosts.filter((host) => !hidden.includes(host.alias));
  const folded = hosts.filter((host) => hidden.includes(host.alias));
  const stateOf = (alias: string): SshHostState => states[alias] ?? emptyState(alias);
  const fail = (error: unknown): void => setNotice(error instanceof Error ? error.message : String(error));
  const toggleHidden = (alias: string): void => {
    const next = hidden.includes(alias) ? hidden.filter((entry) => entry !== alias) : [...hidden, alias];
    updatePreferences({ hiddenSshHosts: next }).catch(fail);
  };
  const checkAll = (): void => { for (const host of shown) window.omo.testSshHost(host.alias).catch(fail); };
  const current = hosts.find((host) => host.alias === selected) ?? null;
  const counts = useMemo(() => shown.reduce((sum, host) => sum + (states[host.alias]?.status === "online" ? 1 : 0), 0), [shown, states]);

  const row = (host: SshHost): ReactNode => {
    const state = stateOf(host.alias);
    const badge = osBadge(state.specs);
    const isHidden = hidden.includes(host.alias);
    const toggle = t(isHidden ? "servers.unhide" : "servers.hide");
    return (
      <li key={host.alias} className="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/60 data-selected:bg-accent" data-selected={selected === host.alias || undefined}
        data-testid="server-row" data-alias={host.alias} data-status={state.status} data-probing={state.probing || undefined}>
        <button type="button" className={clsx("m-0 box-border flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-foreground [font-family:inherit]", focusRing)}
          aria-pressed={selected === host.alias} onClick={() => setSelected(host.alias)}>
          <StatusDot state={state} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{host.alias}</span>
              {badge !== null && <Badge variant="outline" data-testid="server-os">{badge}</Badge>}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums" data-testid="server-latency">{state.latencyMs === null ? "" : t("servers.ms", { ms: state.latencyMs })}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate font-mono">{hostAddress(host)}</span>
              <span className="sr-only">{t(STATUS_LABEL[state.status])}</span>
              <span className="ml-auto shrink-0 tabular-nums" data-testid="server-checked">{ago(t, state.checkedAt, now)}</span>
            </span>
          </span>
        </button>
        <Tip label={toggle}>
          <IconButton icon={isHidden ? <Eye /> : <EyeOff />} label={`${toggle}: ${host.alias}`} className="size-7! opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-data-selected:opacity-100"
            data-testid="server-hide" aria-pressed={isHidden} onClick={() => toggleHidden(host.alias)} />
        </Tip>
      </li>
    );
  };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-card text-sm text-foreground data-[placement=overlay]:shadow-lg"
      data-testid="servers-panel" data-placement={placement} aria-labelledby={headingId} tabIndex={-1}>
      <header className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border py-1.5 pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={headingId} className="m-0 text-sm font-semibold">{t("servers.title")}</h2>
          <span className="truncate text-xs text-muted-foreground" title={inventory?.configPath}>
            {inventory === null ? t("servers.loading") : t("servers.summary", { online: counts, total: shown.length })}
          </span>
        </div>
        <Button variant="secondary" size="sm" icon={<Activity />} data-testid="servers-check-all" disabled={shown.length === 0} onClick={checkAll}>{t("servers.checkAll")}</Button>
        <Tip label={t("servers.reload")}><IconButton icon={<RotateCw />} label={t("servers.reload")} data-testid="servers-reload" onClick={() => setRevision((value) => value + 1)} /></Tip>
      </header>
      <div className="max-h-[48%] min-h-24 shrink-0 overflow-auto border-0 border-b border-solid border-border p-1.5" data-testid="servers-list">
        {inventory !== null && inventory.error !== null ? <p className="m-0 px-2.5 py-3 text-xs text-muted-foreground">{inventory.error === "not-found" ? t("servers.noConfig", { path: inventory.configPath }) : inventory.error}</p>
          : inventory !== null && hosts.length === 0 ? <p className="m-0 px-2.5 py-3 text-xs text-muted-foreground">{t("servers.noHosts", { path: inventory.configPath })}</p>
          : <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={t("servers.title")}>{shown.map(row)}</ul>}
        {folded.length > 0 && (
          <details className="group/hidden mt-1" data-testid="servers-hidden-group">
            <summary className={clsx("flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden", focusRing)}>
              <ChevronRight aria-hidden className="size-3.5 transition-transform group-open/hidden:rotate-90 motion-reduce:transition-none" />
              {t("servers.hidden", { count: folded.length })}
            </summary>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 opacity-80">{folded.map(row)}</ul>
          </details>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {current === null ? <p className="m-0 px-4 py-6 text-center text-xs text-muted-foreground">{t("servers.select")}</p>
          : <ServerDetail host={current} state={stateOf(current.alias)} now={now} onError={fail} onNotice={setNotice} />}
      </div>
      {notice !== null && <p className="m-0 shrink-0 border-0 border-t border-solid border-border px-3 py-2 text-xs text-muted-foreground" role="status" data-testid="servers-notice">{notice}</p>}
    </aside>
  );
}

function ServerDetail({ host, state, now, onError, onNotice }: { host: SshHost; state: SshHostState; now: number; onError(error: unknown): void; onNotice(message: string): void }) {
  const t = useT();
  const command = `ssh ${host.alias}`;
  const failed = state.status === "auth-failed" || state.status === "unreachable";
  return (
    <section className="flex flex-col gap-3 p-3" data-testid="server-detail" data-alias={host.alias} aria-labelledby="server-detail-title">
      <div className="flex items-start gap-3">
        <ServerCog aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id="server-detail-title" className="m-0 truncate text-base font-semibold">{host.alias}</h3>
          <p className="m-0 truncate font-mono text-xs text-muted-foreground">{hostAddress(host)}{host.identityFiles.length > 0 && ` · ${host.identityFiles.map((file) => file.split(/[\\/]/).at(-1)).join(", ")}`}</p>
          <p className="m-0 flex items-center gap-1.5 text-xs" data-testid="server-status" data-status={state.status}>
            <StatusDot state={state} />
            <span>{state.probing ? t("servers.probing") : t(STATUS_LABEL[state.status])}</span>
            {state.latencyMs !== null && !state.probing && <span className="text-muted-foreground tabular-nums">· {t("servers.ms", { ms: state.latencyMs })}</span>}
            <span className="text-muted-foreground">· {t("servers.checked", { when: ago(t, state.checkedAt, now) })}</span>
          </p>
        </div>
      </div>
      {failed && state.message !== null && (
        <p className={clsx("m-0 flex items-start gap-2 rounded-md border border-solid px-3 py-2 text-xs", state.status === "auth-failed" ? "border-warning/40 bg-warning/10" : "border-destructive-foreground/30 bg-destructive-foreground/10")} data-testid="server-message">
          <TriangleAlert aria-hidden className={clsx("mt-px size-3.5 shrink-0", state.status === "auth-failed" ? "text-warning" : "text-destructive-foreground")} />
          <span className="min-w-0 font-mono [overflow-wrap:anywhere]">{state.message}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" icon={<RefreshCw />} data-testid="server-refresh" disabled={state.probing} onClick={() => window.omo.refreshSshSpecs(host.alias).catch(onError)}>{t("servers.refresh")}</Button>
        <Button variant="secondary" size="sm" icon={<Activity />} data-testid="server-test" disabled={state.probing} onClick={() => window.omo.testSshHost(host.alias).catch(onError)}>{t("servers.test")}</Button>
        <Button variant="ghost" size="sm" icon={<Copy />} data-testid="server-copy" onClick={() => window.omo.copyText(command).then(() => onNotice(t("servers.copied", { command })), onError)}>{t("servers.copy")}</Button>
        <Button variant="ghost" size="sm" icon={<SquareTerminal />} data-testid="server-terminal"
          onClick={() => openTerminalCommand({ title: host.alias, command }).then((opened) => { if (!opened) onNotice(t("servers.terminal.noSession")); }, onError)}>{t("servers.terminal")}</Button>
      </div>
      {state.specs === null ? <p className="m-0 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground" data-testid="server-specs-empty">{t("servers.specs.empty")}</p>
        : <SpecCard specs={state.specs} />}
      {state.specsAt !== null && <p className="m-0 text-xs text-muted-foreground">{t("servers.specs.readAt", { when: ago(t, state.specsAt, now) })}</p>}
    </section>
  );
}

function SpecCard({ specs }: { specs: SshSpecs }) {
  const t = useT();
  const disk = specs.disks[0];
  const tiles: Array<{ id: string; label: MessageKey; value: string | null; detail?: string | null }> = [
    { id: "cpu", label: "servers.spec.cpu", value: specs.cpuModel },
    { id: "cores", label: "servers.spec.cores", value: specs.cores === null ? null : String(specs.cores), detail: specs.arch || null },
    { id: "ram", label: "servers.spec.ram", value: sizeFromMb(specs.ramTotalMb),
      detail: [specs.ramAvailableMb === null ? null : t("servers.spec.available", { size: sizeFromMb(specs.ramAvailableMb) ?? "" }),
        specs.swapTotalMb === null || specs.swapTotalMb === 0 ? null : t("servers.spec.swap", { size: sizeFromMb(specs.swapTotalMb) ?? "" })].filter(Boolean).join(" · ") || null },
    { id: "disk", label: "servers.spec.disk", value: disk === undefined ? null : sizeFromGb(disk.totalGb),
      detail: disk === undefined ? null : [disk.mount, t("servers.spec.free", { size: sizeFromGb(disk.freeGb) }), specs.disks.length > 1 ? t("servers.spec.moreDisks", { count: specs.disks.length - 1 }) : null].filter(Boolean).join(" · ") },
    { id: "gpu", label: "servers.spec.gpu", value: specs.gpus.length === 0 ? t("servers.spec.none") : specs.gpus.map((gpu) => gpu.name).join(", "),
      detail: specs.gpus.some((gpu) => gpu.memoryMb !== null) ? specs.gpus.map((gpu) => sizeFromMb(gpu.memoryMb)).filter(Boolean).join(", ") : null },
    { id: "os", label: "servers.spec.os", value: specs.osName, detail: [specs.hostname, specs.kernel].filter(Boolean).join(" · ") || null },
    { id: "uptime", label: "servers.spec.uptime", value: uptime(specs.uptimeSeconds) },
    { id: "load", label: "servers.spec.load", value: specs.load, detail: specs.family === "windows" ? t("servers.spec.cpuLoad") : t("servers.spec.loadAverage") },
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-border bg-border" data-testid="server-specs" data-family={specs.family}>
      {tiles.map(({ id, label, value, detail }) => (
        <div key={id} className={clsx("flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2.5", (id === "cpu" || id === "os") && "col-span-2")} data-testid={`server-spec-${id}`}>
          <dt className="text-xs font-medium text-muted-foreground">{t(label)}</dt>
          <dd className="m-0 truncate text-sm font-medium" title={value ?? undefined}>{value ?? t("servers.spec.unknown")}</dd>
          {detail != null && detail !== "" && <dd className="m-0 truncate text-xs text-muted-foreground" title={detail}>{detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
