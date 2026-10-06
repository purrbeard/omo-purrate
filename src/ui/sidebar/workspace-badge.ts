function folderName(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** Two uppercase letters for a workspace badge: the first letters of the first two words of the folder name, else its first two characters, else "?". */
export function workspaceInitials(cwd: string): string {
  const name = folderName(cwd) || cwd;
  const words = name.split(/[\s._-]+/).filter((word) => word.length > 0);
  const letters =
    words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : [...(words[0] ?? name)].slice(0, 2).join("");
  return letters === "" ? "?" : letters.toUpperCase();
}

/** Deterministic hue (0-359) for a workspace badge, derived from the cwd with a 32-bit FNV-1a hash. */
export function workspaceHue(cwd: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cwd.length; i += 1) {
    hash ^= cwd.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}
