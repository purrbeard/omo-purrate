import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const buildDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
const iconsetDir = path.join(buildDir, "icon.iconset");
const svg = readFileSync(path.join(buildDir, "icon.svg"));

function render(size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconsetDir, `icon_${size}x${size}.png`), render(size));
  writeFileSync(path.join(iconsetDir, `icon_${size}x${size}@2x.png`), render(size * 2));
}
writeFileSync(path.join(buildDir, "icon.png"), render(1024));
execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(buildDir, "icon.icns")], { stdio: "inherit" });
console.log(`wrote ${path.join(buildDir, "icon.icns")} and ${path.join(buildDir, "icon.png")}`);
