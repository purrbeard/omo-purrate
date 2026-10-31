import { lstatSync, mkdirSync, mkdtempSync, renameSync } from "node:fs";
import path from "node:path";

/** @param {string} target @param {{ force?: boolean, recursive?: boolean }} [options] */
export function quarantineSync(target, options = {}) {
  try {
    lstatSync(target);
  } catch (error) {
    if (options.force && error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const quarantine = path.join(path.dirname(target), "_quarantine");
  mkdirSync(quarantine, { recursive: true });
  const destination = mkdtempSync(path.join(quarantine, "item-"));
  renameSync(target, path.join(destination, path.basename(target)));
}
