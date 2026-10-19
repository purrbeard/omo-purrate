import { useEffect, useRef, useState } from "react";
import type { GitCommitResult } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { GIT_REFRESH_EVENT, useGitInfo } from "../git/use-git-info";
import clsx from "clsx";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Button, Input, Menu, Tooltip, focusRing } from "../kit";

const segment = clsx(
  "m-0 inline-flex cursor-pointer items-center border-0 bg-transparent text-xs font-medium leading-[18px] text-muted-foreground [font-family:inherit]",
  "transition-colors duration-150 hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
  focusRing,
);

/**
 * Split button shown for git workspaces next to Open: the primary action opens a dialog that lists
 * `git status --porcelain` changes, commits everything (`git add -A` + commit) and pushes; the
 * chevron menu offers commit-only. Git failures surface verbatim inside the dialog, and a push
 * without an upstream is skipped with a notice instead of an error.
 */
export function CommitPushButton({ cwd }: { cwd: string }) {
  const t = useT();
  const info = useGitInfo(cwd);
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState(true);
  const [changes, setChanges] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GitCommitResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (info === null) return null;

  const start = (withPush: boolean): void => {
    setPush(withPush);
    setOpen(true);
    setMenuOpen(false);
    setResult(null);
    setError(null);
    setChanges(null);
    setMessage("");
    window.omo
      .gitStatus(cwd)
      .then(setChanges, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };

  const submit = (): void => {
    if (busy || message.trim() === "") return;
    setBusy(true);
    setError(null);
    window.omo
      .gitCommitPush(cwd, message, push)
      .then(
        (outcome) => {
          setResult(outcome);
          window.dispatchEvent(new Event(GIT_REFRESH_EVENT));
          window.omo.gitStatus(cwd).then(setChanges, () => setChanges(null));
        },
        (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setBusy(false));
  };

  const canSubmit = !busy && message.trim() !== "";

  return (
    <>
      <div className="box-border inline-flex h-7 items-stretch overflow-hidden rounded-md border border-solid border-border bg-card" data-testid={TESTID.commitButton}>
        <Tooltip.Root>
          <Tooltip.Trigger
            delay={500}
            render={
              <button type="button" className={clsx(segment, "gap-1.5 px-2.5")} onClick={() => start(true)} disabled={open}>
                <span className="whitespace-nowrap">{t("conversation.commit.label")}</span>
              </button>
            }
          />
          <Tooltip.Content side="bottom" align="end">{t("conversation.commit.tooltip")}</Tooltip.Content>
        </Tooltip.Root>
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger
            className={clsx(segment, "border-0 border-l border-solid border-border px-1.5")}
            data-testid={TESTID.commitMenu}
            aria-label={t("conversation.commit.more")}
          >
            <ChevronDown className="size-3" aria-hidden />
          </Menu.Trigger>
          <Menu.Content side="bottom">
            <Menu.Item onClick={() => start(false)}>{t("conversation.commit.commitOnly")}</Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </div>

      {open && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="box-border flex max-h-[calc(100vh-48px)] w-full max-w-[480px] flex-col gap-3 rounded-2xl border border-solid border-border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg" role="dialog" aria-modal="true" aria-label={t("conversation.commit.title")} data-testid={TESTID.commitDialog}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="m-0 text-sm font-semibold">{t("conversation.commit.title")}</h2>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{info.branch}</span>
            </div>
            <div className="flex max-h-[180px] min-h-10 flex-col justify-center gap-0.5 overflow-y-auto rounded-md border border-solid border-border p-2" data-testid={TESTID.commitChanges}>
              {changes === null && <span className="text-muted-foreground">{t("conversation.commit.loading")}</span>}
              {changes !== null && changes.length === 0 && <span className="text-muted-foreground">{t("conversation.commit.clean")}</span>}
              {changes?.map((line) => (
                <span key={line} className="flex min-w-0 items-center gap-2 leading-5">
                  <code className="flex-none font-mono text-xs text-muted-foreground">{line.slice(0, 2)}</code>
                  <span className="min-w-0 truncate">{line.slice(3)}</span>
                </span>
              ))}
            </div>
            <Input
              ref={inputRef}
              data-testid={TESTID.commitMessage}
              type="text"
              placeholder={t("conversation.commit.message")}
              value={message}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) submit();
              }}
            />
            {error !== null && (
              <div className="flex items-start gap-1.5 break-words whitespace-pre-wrap text-destructive-foreground" data-testid={TESTID.commitError} role="alert">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("conversation.commit.failed", { message: error })}
              </div>
            )}
            {result !== null && (
              <div className="flex flex-col gap-1 text-muted-foreground" data-testid={TESTID.commitResult} role="status">
                {result.committed
                  ? result.pushed
                    ? t("conversation.commit.result", { hash: result.commitHash ?? "" })
                    : t("conversation.commit.resultNoPush", { hash: result.commitHash ?? "" })
                  : t("conversation.commit.nothing")}
                {result.pushSkipped === "no-upstream" && <span className="opacity-80">{t("conversation.commit.pushSkipped")}</span>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" data-testid={TESTID.commitCancel} onClick={() => setOpen(false)} disabled={busy}>
                {t("conversation.commit.cancel")}
              </Button>
              <Button variant="primary" size="sm" data-testid={TESTID.commitSubmit} onClick={submit} disabled={!canSubmit}>
                {push ? t("conversation.commit.label") : t("conversation.commit.submitOnly")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
