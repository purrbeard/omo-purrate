import { useEffect, useState } from "react";
import { FileInput, RefreshCw, ScanSearch } from "lucide-react";
import { Badge, Button } from "../kit";
import { useT } from "../../i18n";
import { mcpDisplayStatus } from "../../state/mcp";
import { selectIsTurnActive } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { SectionHeading } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

const STATUS_BADGE = { connected: "success", needs_auth: "warning" } as const;

export function McpSection() {
  const t = useT();
  const actions = useActions();
  const { servers, loading, error, loadedAt } = useAppSelector((state) => state.mcp);
  const turnActive = useAppSelector((state) => Object.keys(state.threads).some((id) => selectIsTurnActive(state, id)));
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [configured, setConfigured] = useState<Array<{ name: string; enabled: boolean; type: string }>>([]);
  const loadConfigured = async (): Promise<void> => { setConfigured(await window.omo.readConfiguredMcpServers()); };
  const importExisting = async (): Promise<void> => {
    setImporting(true); setImportError(null); setImported(null);
    try {
      const result = await window.omo.importExistingMcpConfigs();
      if (result.sources === 0) setImportError(t("shell.settings.mcp.noSources"));
      setImported(result.imported.length);
      await loadConfigured(); await actions.loadMcpServers();
    } catch (reason) { setImportError(errorMessage(reason)); }
    finally { setImporting(false); }
  };
  const importConfig = async (): Promise<void> => {
    setImporting(true); setImportError(null); setImported(null);
    try {
      const result = await window.omo.importMcpConfig();
      if (result !== null) { setImported(result.imported.length); await loadConfigured(); await actions.loadMcpServers(); }
    } catch (reason) { setImportError(errorMessage(reason)); }
    finally { setImporting(false); }
  };
  useEffect(() => {
    actions.setMcpSectionOpen(true);
    void actions.loadMcpServers();
    void loadConfigured().catch((reason: unknown) => setImportError(errorMessage(reason)));
    return () => actions.setMcpSectionOpen(false);
  }, [actions]);
  const statusLabel = (status: string): string => {
    switch (status) {
      case "connected": return t("shell.settings.mcp.connected");
      case "needs_auth": return t("shell.settings.mcp.needsLogin");
      case "enabled": return t("shell.settings.mcp.enabled");
      case "unsupported": return t("shell.settings.mcp.unsupported");
      default: return status;
    }
  };
  return (
    <section className={ui.section} data-testid={TESTID.settingsMcp} aria-busy={loading}>
      <SectionHeading title={t("shell.settings.nav.mcp")} intro={t("shell.settings.mcp.intro")} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="primary" size="sm" icon={<ScanSearch aria-hidden="true" />} disabled={importing || loading || turnActive} data-testid="mcp-import-existing" onClick={() => void importExisting()}>{t("shell.settings.mcp.importExisting")}</Button>
        <Button variant="outline" size="sm" icon={<FileInput aria-hidden="true" />} disabled={importing || loading || turnActive} data-testid="mcp-import" onClick={() => void importConfig()}>
          {t(importing ? "shell.settings.mcp.importing" : "shell.settings.mcp.import")}
        </Button>
        <Button variant="outline" size="sm" icon={<RefreshCw aria-hidden="true" />} disabled={loading}
          data-testid={TESTID.mcpRefresh} onClick={() => void actions.loadMcpServers()}>
          {loading ? t("shell.settings.mcp.loading") : t("shell.settings.mcp.refresh")}
        </Button>
      </div>
      <p className={ui.muted}>{t("shell.settings.mcp.importHint")}</p>
      {imported !== null && <p className={ui.muted} role="status" data-testid="mcp-import-status">{t("shell.settings.mcp.imported", { count: imported })}</p>}
      {importError !== null && <ErrorText>{importError}</ErrorText>}
      {configured.filter((entry) => !servers.some((server) => server.name === entry.name)).map((entry) => <article key={entry.name} className={ui.card} data-testid="mcp-configured-server" data-server-name={entry.name}>
        <div className={ui.cardBody}><h3 className={`${ui.heading} wrap-anywhere`}>{entry.name}</h3><p className={ui.muted}>{entry.type} · {t(entry.enabled ? "shell.settings.mcp.configured" : "shell.settings.mcp.disabled")}</p></div>
      </article>)}
      {error !== null && <ErrorText>{t("shell.settings.mcp.error", { message: errorMessage(error) })}</ErrorText>}
      {servers.map((server) => {
        const status = mcpDisplayStatus(server);
        return (
          <article key={server.name} className={ui.card} data-testid={TESTID.mcpServer} data-server-name={server.name} data-status={status}>
            <div className={ui.cardBody}>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className={`${ui.heading} wrap-anywhere`}>{server.name}</h3>
                <Badge variant={STATUS_BADGE[status as keyof typeof STATUS_BADGE] ?? "secondary"}>{statusLabel(status)}</Badge>
              </div>
              {server.serverInfo !== null && <p className={ui.muted}>{t("shell.settings.mcp.version", { version: server.serverInfo.version })}</p>}
              {status === "needs_auth" && <p className={ui.muted}>{t("shell.settings.mcp.loginHint")}</p>}
              {server.tools.length === 0 ? <p className={ui.muted}>{t("shell.settings.mcp.tools", { count: server.toolCount ?? 0 })}</p> : (
                <details className="text-sm leading-5" data-testid={TESTID.mcpServerTools}>
                  <summary className="cursor-pointer text-muted-foreground">{t("shell.settings.mcp.tools", { count: server.tools.length })}</summary>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0 pt-3 [&_code]:wrap-anywhere">
                    {server.tools.map((tool) => <li key={tool.name}>
                      <code className={ui.mono}>{tool.name}</code>
                      {tool.description !== undefined && <p className={ui.muted}>{tool.description}</p>}
                    </li>)}
                  </ul>
                </details>
              )}
            </div>
          </article>
        );
      })}
      {loadedAt !== null && !loading && error === null && servers.length === 0 && configured.length === 0 && (
        <div className={ui.card} data-testid={TESTID.mcpEmpty}>
          <div className={ui.cardBody}><p className={ui.text}>{t("shell.settings.mcp.empty")}</p></div>
        </div>
      )}
      <p className={ui.muted}>{t("shell.settings.mcp.configHint")} <code className={ui.mono}>~/.omo/agent/mcp.json</code></p>
    </section>
  );
}
