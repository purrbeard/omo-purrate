import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface ExitInfo {
  code: number | null;
  signal: string | null;
  stderrTail: string;
  /** True when stop() was called before the child exited. */
  expected: boolean;
}

export interface StopTimeouts {
  afterStdinEnd: number;
  afterSigterm: number;
}

const STDERR_LIMIT = 4096;
const CLOSE_GRACE_MS = 250;

/**
 * Tracks one child process: a 4 KB stderr ring buffer, exit detection (including spawn failure),
 * and graceful stop escalation. onExitSeen runs as soon as the process exits; `exited` resolves once
 * stdio has closed, or shortly after exit when grandchildren keep the pipes open.
 */
export class ManagedChild {
  private stderr = "";
  private seen = false;
  private stopRequested = false;
  private stopPromise: Promise<void> | null = null;
  private failure: Error | null = null;
  private resolveSeen: () => void = () => undefined;
  private readonly exitSeen = new Promise<void>((resolve) => {
    this.resolveSeen = resolve;
  });
  private resolveExited: (info: ExitInfo) => void = () => undefined;
  readonly exited = new Promise<ExitInfo>((resolve) => {
    this.resolveExited = resolve;
  });

  constructor(
    readonly process: ChildProcessWithoutNullStreams,
    onExitSeen: (code: number | null, signal: string | null) => void,
  ) {
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (text: string) => {
      this.stderr = (this.stderr + text).slice(-STDERR_LIMIT);
    });
    // EPIPE after the child died surfaces through the exit handler; the stream error carries nothing more.
    process.stdin.on("error", () => undefined);

    let code: number | null = null;
    let signal: string | null = null;
    let finalized = false;
    let closeTimer: NodeJS.Timeout | undefined;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(closeTimer);
      this.resolveExited({ code, signal, stderrTail: this.stderr, expected: this.stopRequested });
    };
    const markExit = (exitCode: number | null, exitSignal: string | null): void => {
      if (this.seen) return;
      this.seen = true;
      code = exitCode;
      signal = exitSignal;
      this.resolveSeen();
      onExitSeen(exitCode, exitSignal);
      closeTimer = setTimeout(finalize, CLOSE_GRACE_MS);
    };
    process.on("error", (error) => {
      if (this.seen) return;
      this.failure = error;
      markExit(null, null);
    });
    process.on("exit", markExit);
    process.on("close", () => {
      if (this.seen) finalize();
    });
  }

  get hasExited(): boolean {
    return this.seen;
  }

  get stderrTail(): string {
    return this.stderr;
  }

  /** The error emitted when the process could not be spawned. */
  get spawnError(): Error | null {
    return this.failure;
  }

  /** Closes stdin, then sends SIGTERM and SIGKILL after the given waits; resolves after exit. Idempotent. */
  stop(timeouts: StopTimeouts): Promise<void> {
    this.stopRequested = true;
    this.stopPromise ??= (async () => {
      if (!this.seen) {
        this.process.stdin.end();
        if (!(await this.waitForExit(timeouts.afterStdinEnd))) {
          this.process.kill("SIGTERM");
          if (!(await this.waitForExit(timeouts.afterSigterm))) {
            this.process.kill("SIGKILL");
            await this.exitSeen;
          }
        }
      }
      await this.exited;
    })();
    return this.stopPromise;
  }

  private async waitForExit(ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const elapsed = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    try {
      return await Promise.race([this.exitSeen.then(() => true), elapsed]);
    } finally {
      clearTimeout(timer);
    }
  }
}
