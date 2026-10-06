#!/usr/bin/env node
// Captures the README media into docs/media/: PNG screenshots of the built app and docs/media/side-chat.gif.
// The app runs through Playwright's Electron support against tests/fixtures/fake-omo.mjs with the FAKE_OMO_DEMO
// scenes from scripts/readme-demo.mjs, fresh user data and temp demo workspaces, so no local session data
// appears. Run `npm run build` first (`npm run screenshots` does both); ffmpeg on PATH encodes the GIF.
// `--only hero,migrate` limits the run to the named captures (hero, migrate, korean, onboarding, gif).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { DEMO, NAMES, PROMPTS, SETTLED, WORKSPACES, seedThreads, skillCatalog } from "./readme-demo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "media");
const FAKE_OMO = path.join(ROOT, "tests", "fixtures", "fake-omo.mjs");
const TIMEOUT_MS = 30_000;
const GIF_LIMIT_BYTES = 4 * 1024 * 1024;
const WIDE = { width: 1440, height: 1000 };
const NARROW = { width: 1280, height: 800 };
const tid = (id) => `[data-testid="${id}"]`;

const temp = mkdtempSync(path.join(tmpdir(), "omo-ui-readme-"));
const workspace = (name) => path.join(temp, name);
const demoFile = path.join(temp, "demo.json");
const seedFile = path.join(temp, "seed-threads.json");
let launches = 0;

function parseOnly(argv) {
  const index = argv.indexOf("--only");
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined) throw new Error("--only needs a comma-separated list");
  return new Set(value.split(","));
}

/**
 * Launches the built app with fresh user data and an environment built from scratch: a temporary HOME, zsh and the
 * system PATH, so neither the app nor the login shell it runs to capture omo's environment reads the user's home,
 * shell startup files or variables. `omo: null` leaves omo unresolvable for the onboarding screen. A setup failure
 * after the launch closes the app and rethrows the setup error.
 */
async function launch({ theme, locale = "en", size = WIDE, omo = FAKE_OMO, video = null }) {
  const run = path.join(temp, `run-${++launches}`);
  const userData = path.join(run, "user-data");
  const home = path.join(run, "home");
  for (const dir of [userData, home]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(userData, "preferences.json"), `${JSON.stringify({ theme, locale })}\n`);
  // node's directory is on PATH only for the fake omo, whose shebang is `#!/usr/bin/env node`.
  const searchPath = [...(omo === null ? [] : [path.dirname(process.execPath)]), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const env = {
    HOME: home,
    SHELL: "/bin/zsh",
    TMPDIR: tmpdir(),
    PATH: searchPath.join(":"),
    OMO_UI_USER_DATA: userData,
    OMO_UI_QA_PICK_DIR: workspace(WORKSPACES[0]),
    FAKE_OMO_HOME: path.join(run, "fake-home"),
    FAKE_OMO_DEMO: demoFile,
    FAKE_OMO_SEED_THREADS: seedFile,
    FAKE_OMO_SKILLS: JSON.stringify(skillCatalog(temp)),
  };
  for (const key of ["USER", "LOGNAME"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  if (omo !== null) env.OMO_UI_OMO_BIN = omo;
  const app = await electron.launch({
    args: ["."],
    cwd: ROOT,
    env,
    timeout: TIMEOUT_MS,
    ...(video === null ? {} : { recordVideo: { dir: video, size } }),
  });
  try {
    const page = await app.firstWindow({ timeout: TIMEOUT_MS });
    const startedAt = Date.now();
    await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), size);
    await page.waitForFunction((width) => window.innerWidth === width, size.width, { timeout: TIMEOUT_MS });
    const ready = omo === null ? tid("onboarding") : `html[data-bridge-state="connected"] ${tid("app-frame")}`;
    await page.locator(ready).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await page.waitForFunction((dark) => document.body.hasAttribute("data-ds-dark-theme") === dark, theme === "dark");
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    // CDP captures leave out the native vibrancy layer behind the transparent window; paint the theme's opaque fill.
    const fill = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--dsw-specific-sidebar-fill)";
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
    await page.addStyleTag({ content: `html { background: ${fill} !important; }` });
    return { app, page, startedAt };
  } catch (error) {
    await app.close().catch((closeError) => console.error(`closing the app after its launch setup failed: ${closeError}`));
    throw error;
  }
}

async function settle(page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const end = animation.effect?.getComputedTiming().endTime;
      return animation.playState === "running" && typeof end === "number" && end !== Infinity;
    });
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Screenshot of the window, of a clip, or of the padded union of the first visible match of each selector. */
async function shot(page, name, selectors = null, pad = 24, fixedClip = undefined) {
  await settle(page);
  let clip = fixedClip;
  if (selectors !== null) {
    const boxes = [];
    for (const selector of selectors) {
      const box = await page.locator(selector).first().boundingBox();
      if (box === null) throw new Error(`${name}: nothing visible for ${selector}`);
      boxes.push(box);
    }
    const view = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
    const right = Math.min(view.width, Math.max(...boxes.map((box) => box.x + box.width)) + pad);
    const bottom = Math.min(view.height, Math.max(...boxes.map((box) => box.y + box.height)) + pad);
    clip = { x, y, width: right - x, height: bottom - y };
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, ...(clip === undefined ? {} : { clip }) });
  console.log(`shot ${path.relative(ROOT, file)}`);
}

/** Starts a session in a demo workspace through its sidebar compose button, or New session for the picked one. */
async function newSession(page, workspaceName = null) {
  const known = await page.locator(tid("thread-row")).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-thread-id")));
  if (workspaceName === null) await page.locator(tid("new-session")).click();
  else {
    const group = page.locator(`${tid("workspace-group")}[data-cwd="${workspace(workspaceName)}"]`);
    await group.hover();
    await group.locator(tid("workspace-compose")).click();
  }
  await page.waitForFunction(
    ({ row, before }) => {
      const id = document.querySelector(`${row}[aria-current="page"]`)?.getAttribute("data-thread-id") ?? null;
      return id !== null && !before.includes(id);
    },
    { row: tid("thread-row"), before: known },
    { timeout: TIMEOUT_MS },
  );
  await page.locator(tid("composer-input")).waitFor({ state: "visible" });
}

async function pickSkill(page, name) {
  await page.locator(tid("composer-input")).pressSequentially(`/${name.slice(0, 4)}`);
  await page.locator(`${tid("skill-option")}[data-skill-name="${name}"]`).click({ timeout: TIMEOUT_MS });
  await page.locator(tid("skill-menu")).waitFor({ state: "hidden" });
}

async function send(page, text, skills = []) {
  const input = page.locator(tid("composer-input"));
  await input.click();
  for (const skill of skills) await pickSkill(page, skill);
  await page.keyboard.insertText(text);
  await input.press("Enter");
}

/** Names the active session through thread/name/set, the way omo titles a session from its first request. */
async function nameSession(page, name) {
  const threadId = await page.locator(`${tid("thread-row")}[aria-current="page"]`).getAttribute("data-thread-id");
  await page.evaluate(({ id, value }) => window.omo.request("thread/name/set", { threadId: id, name: value }), { id: threadId, value: name });
  await page.locator(tid("conversation-header")).getByText(name).waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

async function waitFor(scope, text) {
  await scope.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

async function askSide(page, typingDelayMs = 0) {
  const input = page.locator(tid("composer-input"));
  await input.click();
  const text = `/btw ${PROMPTS.side}`;
  if (typingDelayMs === 0) await page.keyboard.insertText(text);
  else await input.pressSequentially(text, { delay: typingDelayMs });
  await input.press("Enter");
  await waitFor(page.locator(tid("side-transcript")), SETTLED.side);
}

/** The checkout session with the side chat open: the hero, plus the skills menu, activity panel and todo/goal crops. */
async function hero(theme) {
  const { app, page } = await launch({ theme });
  try {
    await newSession(page);
    if (theme === "light") {
      await page.locator(tid("composer-input")).click();
      await page.locator(tid("composer-input")).pressSequentially("/");
      await page.locator(`${tid("skill-option")}[data-skill-name="ulw-loop"]`).waitFor({ state: "visible" });
      // The empty-session line sits just above the menu; include it whole instead of cutting it at the padding.
      await shot(page, "skills-menu", [`${tid("empty-hero")} p`, tid("skill-menu"), tid("composer")], 20);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Backspace");
    }
    await send(page, PROMPTS.checkout, ["ulw-loop"]);
    await nameSession(page, NAMES.checkout);
    await waitFor(page.locator(tid("conversation")), SETTLED.checkout);
    await askSide(page);
    // The answer text lands before the side turn completes; the hero shows the settled side composer.
    await page.locator(tid("side-stop")).waitFor({ state: "detached", timeout: TIMEOUT_MS });
    await shot(page, `hero-${theme}`);
    if (theme === "dark") {
      await page.locator(tid("omo-activity-toggle")).click();
      await page.locator(tid("omo-activity")).waitFor({ state: "visible" });
      await shot(page, "activity", [tid("omo-activity")], 0);
      await page.locator(tid("omo-activity")).evaluate((panel) => {
        const scroller = [panel, ...panel.querySelectorAll("*")].find(
          (node) => node.scrollHeight > node.clientHeight + 4 && getComputedStyle(node).overflowY !== "visible",
        );
        if (scroller !== undefined) scroller.scrollTop = scroller.scrollHeight;
      });
      await shot(page, "activity-tasks", [tid("omo-activity")], 0);
      await page.keyboard.press("Escape");
      await page.locator(tid("todo-dock")).click();
      await page.locator(tid("todo-phase")).first().waitFor({ state: "visible" });
      // The composer starts 8px below the goal strip; a 6px pad keeps its border out of the crop.
      await shot(page, "todo-goal", [tid("todo-dock"), tid("goal-strip")], 6);
    }
  } finally {
    await app.close();
  }
}

/** Two skills in one message, then a migration with an approval, a question and a markdown answer. */
async function migrate() {
  const { app, page } = await launch({ theme: "dark" });
  try {
    await newSession(page, "omo-ui-macosapp");
    await send(page, PROMPTS.chips, ["ulw-loop", "mass-ulw"]);
    await nameSession(page, NAMES.chips);
    await waitFor(page.locator(tid("conversation")), SETTLED.chips);
    await shot(page, "skill-chips", [`${tid("user-message")} >> nth=-1`, `${tid("assistant-message")} >> nth=-1`], 20);
    await newSession(page, "payments-api");
    await send(page, PROMPTS.migrate);
    await nameSession(page, NAMES.migrate);
    await page.locator(tid("approval-card")).waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await shot(page, "approval", [`${tid("user-message")} >> nth=-1`, tid("approval-card")], 24);
    await page.locator(tid("approval-accept")).click();
    const question = page.locator(tid("question-card"));
    await question.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await question.locator(`${tid("question-option")}[data-label="Schedule for 02:00 UTC"]`).click();
    await shot(page, "question", [tid("question-card")], 16);
    await page.locator(tid("question-submit")).click();
    await waitFor(page.locator(tid("conversation")), SETTLED.migrate);
    await shot(page, "answer", [`${tid("assistant-message")} >> nth=-1`], 8);
  } finally {
    await app.close();
  }
}

async function korean() {
  const { app, page } = await launch({ theme: "dark", locale: "ko" });
  try {
    await newSession(page);
    await send(page, PROMPTS.korean, ["ulw-loop"]);
    await nameSession(page, NAMES.korean);
    await waitFor(page.locator(tid("conversation")), SETTLED.korean);
    await shot(page, "korean");
  } finally {
    await app.close();
  }
}

async function onboarding() {
  const { app, page } = await launch({ theme: "light", size: NARROW, omo: null });
  try {
    // The card's list of checked locations shows this machine's temp paths, so the capture ends below the actions.
    const clip = await page.evaluate((installSelector) => {
      const install = document.querySelector(installSelector);
      const card = install?.closest("main > *");
      if (!install || !card) throw new Error("onboarding card not found");
      const box = card.getBoundingClientRect();
      const actions = install.getBoundingClientRect();
      const margin = 40;
      return { x: box.left - margin, y: box.top - margin, width: box.width + 2 * margin, height: actions.bottom + 28 - (box.top - margin) };
    }, tid("onboarding-install"));
    await shot(page, "onboarding", null, 0, clip);
  } finally {
    await app.close();
  }
}

/** Records the /btw flow and encodes docs/media/side-chat.gif with an ffmpeg palette. */
async function gif() {
  const videoDir = path.join(temp, "video");
  const { app, page, startedAt } = await launch({ theme: "dark", size: NARROW, video: videoDir });
  let typingAt = 0;
  let endedAt = 0;
  try {
    await newSession(page);
    await send(page, PROMPTS.checkout, ["ulw-loop"]);
    await nameSession(page, NAMES.checkout);
    await waitFor(page.locator(tid("conversation")), SETTLED.checkout);
    await page.waitForTimeout(600);
    typingAt = Date.now();
    await askSide(page, 45);
    await page.waitForTimeout(2200);
    endedAt = Date.now();
  } finally {
    await app.close();
  }
  const [video] = readdirSync(videoDir).filter((name) => name.endsWith(".webm"));
  if (video === undefined) throw new Error(`no video in ${videoDir}`);
  const start = Math.max(0, (typingAt - startedAt) / 1000 - 1.2);
  const duration = (endedAt - typingAt) / 1000 + 1.2;
  const file = path.join(OUT, "side-chat.gif");
  for (const [fps, width] of [[12, 1024], [10, 900], [8, 800]]) {
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-ss", start.toFixed(2), "-t", duration.toFixed(2), "-i", path.join(videoDir, video),
      "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      "-loop", "0", file,
    ]);
    if (statSync(file).size <= GIF_LIMIT_BYTES) break;
  }
  console.log(`gif ${path.relative(ROOT, file)} (${(statSync(file).size / 1024 / 1024).toFixed(2)} MB)`);
}

function dimensions(file) {
  const bytes = readFileSync(file);
  if (file.endsWith(".png")) return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  return `${bytes.readUInt16LE(6)}x${bytes.readUInt16LE(8)}`;
}

async function main() {
  const only = parseOnly(process.argv.slice(2));
  const captures = { hero: async () => { await hero("dark"); await hero("light"); }, migrate, korean, onboarding, gif };
  for (const name of only ?? []) if (!(name in captures)) throw new Error(`unknown capture ${name}`);
  for (const name of WORKSPACES) mkdirSync(workspace(name), { recursive: true });
  writeFileSync(demoFile, JSON.stringify(DEMO));
  writeFileSync(seedFile, JSON.stringify(seedThreads(temp, Math.floor(Date.now() / 1000))));
  mkdirSync(OUT, { recursive: true });
  try {
    for (const [name, capture] of Object.entries(captures)) if (only === null || only.has(name)) await capture();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  for (const name of readdirSync(OUT).sort()) {
    const file = path.join(OUT, name);
    console.log(`${name}\t${dimensions(file)}\t${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  rmSync(temp, { recursive: true, force: true });
  process.exit(1);
});
