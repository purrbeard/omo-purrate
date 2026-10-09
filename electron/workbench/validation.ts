import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export function threadId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new Error("Invalid workbench thread id");
  return value;
}

export async function workspace(value: unknown): Promise<string> {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Workbench cwd must be an absolute directory");
  const cwd = await realpath(value);
  if (!(await stat(cwd)).isDirectory()) throw new Error("Workbench cwd must be a directory");
  return cwd;
}
