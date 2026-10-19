import type { ITheme } from "@xterm/xterm";

type ColorKey = Exclude<keyof ITheme, "extendedAnsi">;

/** Every ITheme color as a semantic token expression (tokens.css `--terminal-*` roles, per light/dark scheme). */
const COLORS: Readonly<Partial<Record<ColorKey, string>>> = {
  foreground: "var(--terminal-foreground)",
  background: "var(--terminal-background)",
  cursor: "var(--terminal-cursor)",
  cursorAccent: "var(--terminal-background)",
  selectionBackground: "var(--terminal-selection)",
  scrollbarSliderBackground: "var(--border)",
  scrollbarSliderHoverBackground: "var(--muted-foreground)",
  scrollbarSliderActiveBackground: "var(--foreground)",
  black: "var(--terminal-black)",
  red: "var(--terminal-red)",
  green: "var(--terminal-green)",
  yellow: "var(--terminal-yellow)",
  blue: "var(--terminal-blue)",
  magenta: "var(--terminal-magenta)",
  cyan: "var(--terminal-cyan)",
  white: "var(--terminal-white)",
  brightBlack: "var(--muted-foreground)",
  brightRed: "var(--terminal-red)",
  brightGreen: "var(--terminal-green)",
  brightYellow: "var(--terminal-yellow)",
  brightBlue: "var(--terminal-blue)",
  brightMagenta: "var(--terminal-magenta)",
  brightCyan: "var(--terminal-cyan)",
  brightWhite: "var(--terminal-white)",
};

/**
 * Resolves the terminal palette under `scope` into `rgba()` strings. Tokens are built from var() and color-mix(), whose
 * computed form (`color(srgb ...)`) xterm cannot parse with an alpha channel, so each color is rasterized once here.
 * @param scope - element inside the panel, so the panel's tokens and the body's theme and palette both apply.
 * @returns the xterm theme for the current light/dark scheme and palette.
 */
export function readTerminalTheme(scope: HTMLElement): ITheme {
  const probe = document.createElement("span");
  probe.hidden = true;
  scope.append(probe);
  const computed = getComputedStyle(probe);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const theme: ITheme = {};
  for (const [key, token] of Object.entries(COLORS) as [ColorKey, string][]) {
    probe.style.color = token;
    theme[key] = context === null ? computed.color : rasterize(context, computed.color);
  }
  probe.remove();
  return theme;
}

function rasterize(context: CanvasRenderingContext2D, color: string): string {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${red}, ${green}, ${blue}, ${((alpha ?? 255) / 255).toFixed(3)})`;
}

/**
 * Font options from the output element's computed CSS (the code font family, the panel's size, the screen's line height).
 * @param element - the element xterm opens into.
 * @returns xterm font options; `lineHeight` is the CSS line height as a multiple of the font size.
 */
export function readTerminalFont(element: HTMLElement): { fontFamily: string; fontSize: number; lineHeight: number } {
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize);
  return { fontFamily: style.fontFamily, fontSize, lineHeight: parseFloat(style.lineHeight) / fontSize };
}
