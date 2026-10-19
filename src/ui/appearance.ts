import type { Preferences } from "../../shared/ipc";

/** The preference fields the document-level appearance depends on. */
export type AppearancePreferences = Pick<Preferences, "contrast" | "promptFontSize" | "codeFontSize" | "diffColors" | "compactSidebar" | "reduceMotion">;

/**
 * Maps the contrast preference to the mix that appearance.css blends into borders and muted text.
 * @param contrast - percent, 80..150; 100 is the palette as designed.
 * @returns null at 100, else how far (percent) tokens move toward the foreground (stronger) or background (weaker).
 */
export function contrastMix(contrast: number): { mix: number; target: "foreground" | "background" } | null {
  if (contrast === 100) return null;
  return contrast > 100
    ? { mix: Math.round((contrast - 100) * 0.8), target: "foreground" }
    : { mix: Math.round((100 - contrast) * 1.2), target: "background" };
}

function toggle(root: HTMLElement, name: string, on: boolean, value = ""): void {
  if (on) root.setAttribute(name, value);
  else root.removeAttribute(name);
}

function px(root: HTMLElement, property: string, size: number | null): void {
  if (size === null) root.style.removeProperty(property);
  else root.style.setProperty(property, `${size}px`);
}

/** Mirrors the appearance preferences onto <html> attributes and CSS variables that appearance.css keys off. */
export function applyAppearance(prefs: AppearancePreferences, root: HTMLElement = document.documentElement): void {
  const mix = contrastMix(prefs.contrast);
  // The target color is picked in appearance.css on body, where the palette defines --foreground/--background.
  toggle(root, "data-contrast", mix !== null, mix?.target);
  if (mix === null) root.style.removeProperty("--contrast-mix");
  else root.style.setProperty("--contrast-mix", `${mix.mix}%`);
  toggle(root, "data-reduce-motion", prefs.reduceMotion);
  toggle(root, "data-compact-sidebar", prefs.compactSidebar);
  if (prefs.diffColors === "blue-orange") root.setAttribute("data-diff-colors", "blue-orange");
  else root.removeAttribute("data-diff-colors");
  px(root, "--prompt-font-size", prefs.promptFontSize);
  px(root, "--code-font-size", prefs.codeFontSize);
  toggle(root, "data-code-font", prefs.codeFontSize !== null);
}
