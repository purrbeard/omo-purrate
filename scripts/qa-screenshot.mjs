#!/usr/bin/env node
// Visual QA driver: launches the built app through Playwright's Electron support, runs
// optional steps, and writes a screenshot. See --help.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_OMO = path.join(ROOT, "tests", "fixtures", "fake-omo.mjs");
// App.tsx mirrors the bridge state onto <html data-bridge-state>. Waiting for a non-transient state
// keeps a missing omo from being captured as the frame that renders while the bridge is locating.
const SETTLED_ROOT =
  'html[data-bridge-state]:not([data-bridge-state="locating"]):not([data-bridge-state="starting"]):not([data-bridge-state="restarting"])';
const READY_SELECTOR = `${SETTLED_ROOT} :is([data-testid="app-frame"], [data-testid="onboarding"])`;
const READY_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 15_000;

const USAGE = `usage: node scripts/qa-screenshot.mjs --out <png> [options]

  --out <png>          final screenshot path (required)
  --fake               use tests/fixtures/fake-omo.mjs with a fresh FAKE_OMO_HOME (prints FAKE_OMO_LOG)
  --omo <path>         omo binary (OMO_UI_OMO_BIN); overrides --fake
  --home <dir>         reuse an existing FAKE_OMO_HOME instead of a fresh one
  --seed <json>        FAKE_OMO_SEED_THREADS file for the fake
  --pick-dir <dir>     directory pickDirectory returns without a dialog (OMO_UI_QA_PICK_DIR)
  --theme <pref>       light | dark | system: pre-seeds preferences.json in a fresh OMO_UI_USER_DATA
  --size WxH           window size (default 1280x820)
  --steps <json>       array of steps run before the final screenshot:
                         {"click": selector} | {"fill": [selector, text]} | {"press": key}
                         | {"waitFor": selector, "timeout"?: ms}
                         | {"waitForText": text, "exact"?: boolean, "timeout"?: ms}
                         | {"shot": png}
  --help               print this text

The driver launches \`electron .\` from the repository root, so run \`npm run build\` first. It waits
until the bridge leaves locating/starting/restarting and app-frame or onboarding is visible, then
runs the steps. Every capture waits for finite animations to finish and is flattened over the
theme's opaque --dsw-specific-sidebar-fill, because CDP screenshots do not include the native
vibrancy layer behind the transparent page. Electron 44 has no install script: the first launch
downloads its binary, and \`node node_modules/electron/install.js\` does that ahead of time.
`;

function parseArgs(argv) {
  const options = { size: { width: 1280, height: 820 } };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--out":
        options.out = path.resolve(next());
        break;
      case "--fake":
        options.fake = true;
        break;
      case "--omo":
        options.omo = path.resolve(next());
        break;
      case "--home":
        options.home = path.resolve(next());
        break;
      case "--seed":
        options.seed = path.resolve(next());
        break;
      case "--pick-dir":
        options.pickDir = path.resolve(next());
        break;
      case "--theme": {
        const theme = next();
        if (!["light", "dark", "system"].includes(theme)) throw new Error(`--theme must be light, dark or system (got ${theme})`);
        options.theme = theme;
        break;
      }
      case "--size": {
        const match = /^(\d+)x(\d+)$/.exec(next());
        if (match === null) throw new Error("--size expects WxH");
        options.size = { width: Number(match[1]), height: Number(match[2]) };
        break;
      }
      case "--steps":
        options.steps = JSON.parse(readFileSync(path.resolve(next()), "utf8"));
        if (!Array.isArray(options.steps)) throw new Error("--steps file must contain a JSON array");
        break;
      default:
        throw new Error(`unknown argument ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

async function screenshot(page, file) {
  const fill = await page.evaluate(async () => {
    const settling = document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(settling.map((animation) => animation.finished.catch(() => undefined)));
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--dsw-specific-sidebar-fill)";
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  const backdrop = await page.addStyleTag({ content: `html { background: ${fill} !important; }` });
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  await backdrop.evaluate((node) => node.remove());
  await backdrop.dispose();
  console.log(`shot ${file}`);
}

async function runStep(page, step) {
  const timeout = step.timeout ?? STEP_TIMEOUT_MS;
  if ("click" in step) return page.locator(step.click).first().click({ timeout });
  if ("fill" in step) {
    const [selector, text] = step.fill;
    return page.locator(selector).first().fill(text, { timeout });
  }
  if ("press" in step) return page.keyboard.press(step.press);
  if ("waitFor" in step) return page.locator(step.waitFor).first().waitFor({ state: "visible", timeout });
  if ("waitForText" in step) {
    return page.getByText(step.waitForText, { exact: step.exact === true }).first().waitFor({ state: "visible", timeout });
  }
  if ("shot" in step) return screenshot(page, path.resolve(step.shot));
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (options.out === undefined) throw new Error(`--out is required\n\n${USAGE}`);

  const tempDirs = [];
  const fresh = (label) => {
    const dir = mkdtempSync(path.join(tmpdir(), `omo-ui-qa-${label}-`));
    tempDirs.push(dir);
    return dir;
  };
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (options.omo !== undefined) env.OMO_UI_OMO_BIN = options.omo;
  else if (options.fake) {
    env.OMO_UI_OMO_BIN = FAKE_OMO;
    env.FAKE_OMO_HOME = options.home ?? fresh("fake-home");
    env.FAKE_OMO_LOG = path.join(env.FAKE_OMO_HOME, "fake-omo.log");
    console.log(`FAKE_OMO_HOME=${env.FAKE_OMO_HOME}`);
    console.log(`FAKE_OMO_LOG=${env.FAKE_OMO_LOG}`);
    if (options.seed !== undefined) env.FAKE_OMO_SEED_THREADS = options.seed;
  }
  if (options.pickDir !== undefined) env.OMO_UI_QA_PICK_DIR = options.pickDir;

  env.OMO_UI_USER_DATA = fresh("user-data");
  if (options.theme !== undefined) {
    writeFileSync(path.join(env.OMO_UI_USER_DATA, "preferences.json"), `${JSON.stringify({ theme: options.theme }, null, 2)}\n`);
  }

  let app;
  try {
    app = await electron.launch({ args: ["."], cwd: ROOT, env, timeout: READY_TIMEOUT_MS });
    const page = await app.firstWindow({ timeout: READY_TIMEOUT_MS });
    const { width, height } = options.size;
    await app.evaluate(({ BrowserWindow }, size) => {
      const [window] = BrowserWindow.getAllWindows();
      if (window) window.setContentSize(size.width, size.height);
    }, { width, height });
    await page.locator(READY_SELECTOR).first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    for (const step of options.steps ?? []) await runStep(page, step);
    await screenshot(page, options.out);
  } finally {
    if (app) await app.close();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
