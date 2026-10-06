export interface PhoneFrame { type: string; id?: number; version?: number; result?: { thread?: { id: string } }; error?: { code: number }; notification?: { method: string }; }
export function createFakeUsbmuxd(socketPath: string): Promise<{
  frames: PhoneFrame[];
  waitFor(predicate: (frame: PhoneFrame) => boolean, timeout?: number): Promise<PhoneFrame>;
  send(value: unknown): void;
  detach(): void;
  close(): Promise<void>;
}>;
