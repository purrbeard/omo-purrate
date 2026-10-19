import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { byTestId, launchApp, newSession, setTheme, shot, tempDir } from "./helpers.ts";
import { TESTID } from "../src/ui/testids.ts";

const PAGES: Record<string, string> = {
  "/": "<!doctype html><title>Home</title><body style=\"font:16px system-ui;padding:24px\"><h1>Local home</h1><p>Served by the browser spec.</p><a href=\"/two\">Two</a></body>",
  "/two": "<!doctype html><meta name=\"viewport\" content=\"width=device-width\"><title>Two</title><body style=\"font:16px system-ui;padding:24px\"><main><h1 id=\"hello\" style=\"padding:12px;border:1px solid #ccc\">Hello there</h1><p class=\"note\">Second page</p></main></body>",
};

function serve(): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer((request, response) => {
    const body = PAGES[request.url ?? "/"];
    response.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    response.end(body ?? "missing");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

/** Runs `work` against the browser dock's page contents in the main process. */
function inView<T, A>(app: ElectronApplication, work: string, arg?: A): Promise<T> {
  return app.evaluate(async ({ session, webContents }, { work, arg }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.session === session.fromPartition("persist:omo-ui-browser"));
    if (contents === undefined) throw new Error("no browser view");
    const run = new Function("contents", "arg", `return (${work})(contents, arg)`) as (contents: Electron.WebContents, arg: unknown) => Promise<T>;
    return run(contents, arg);
  }, { work, arg });
}

/**
 * Screenshots the window with the page view drawn in: CDP captures only the app's own contents, so a still of the
 * view is laid over the panel for the shot.
 */
async function shotWithPage(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const image = await inView<string, undefined>(app, "async (contents) => (await contents.capturePage()).toDataURL()");
  await page.evaluate(async (src) => {
    const content = document.querySelector('[data-testid="browser-content"]')!;
    const rect = content.getBoundingClientRect();
    const still = document.createElement("img");
    still.id = "e2e-page-still";
    still.src = src;
    await still.decode();
    // A device preset narrows the view and centers it in the panel.
    const width = Math.min(rect.width, still.naturalWidth / devicePixelRatio);
    Object.assign(still.style, { position: "fixed", left: `${rect.left + (rect.width - width) / 2}px`, top: `${rect.top}px`, width: `${width}px`, height: `${rect.height}px`, zIndex: "100" });
    document.body.append(still);
  }, image);
  await shot(page, name);
  await page.evaluate(() => document.getElementById("e2e-page-still")?.remove());
}

test("the browser dock loads a local page, navigates, zooms, captures and picks an element into the composer", async () => {
  const { server, origin } = await serve();
  const launched = await launchApp({ omo: "fake", pickDir: tempDir("browser-project"), size: { width: 1440, height: 900 } });
  const { app, page } = launched;
  try {
    await newSession(page);
    await setTheme(page, "dark");
    await page.keyboard.press("Control+E");
    await page.getByTestId("right-tab-browser").click();
    const panel = page.getByTestId("browser-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("browser-start")).toBeVisible();
    await expect(page.getByTestId("browser-start").getByRole("heading", { name: "Local servers" })).toBeVisible();
    await expect(page.getByText("Scanning local ports…")).toHaveCount(0, { timeout: 15_000 });
    await shot(page, "browser-local-servers");

    const address = page.getByTestId("browser-address");
    await address.fill(origin.replace("http://", ""));
    await address.press("Enter");
    await expect(panel).toHaveAttribute("data-url", `${origin}/`);
    await expect(panel).toHaveAttribute("data-page-visible", "true");
    await expect.poll(() => inView<string, undefined>(app, "(contents) => contents.getTitle()")).toBe("Home");

    await address.fill(`${origin}/two`);
    await address.press("Enter");
    await expect(panel).toHaveAttribute("data-url", `${origin}/two`);
    await page.getByTestId("browser-back").click();
    await expect(panel).toHaveAttribute("data-url", `${origin}/`);
    await page.getByTestId("browser-forward").click();
    await expect(panel).toHaveAttribute("data-url", `${origin}/two`);
    await expect(address).toHaveValue(`${origin}/two`);

    await page.getByTestId("browser-tools").click();
    await expect(page.getByTestId("browser-tools-menu")).toBeVisible();
    // The page view steps aside for the menu, leaving a still of the page under it.
    await expect(panel).toHaveAttribute("data-page-visible", "false");
    await shot(page, "browser-site-tools");
    await page.getByTestId("browser-zoom-in").click();
    await expect(panel).toHaveAttribute("data-zoom", "1.1");
    await expect.poll(() => inView<number, undefined>(app, "(contents) => contents.getZoomFactor()")).toBeCloseTo(1.1);
    await page.getByTestId("browser-tools").click();
    await page.getByTestId("browser-zoom-reset").click();
    await expect(panel).toHaveAttribute("data-zoom", "1");

    await page.getByTestId("browser-tools").click();
    await page.getByTestId("browser-device-mobile").click();
    await expect(panel).toHaveAttribute("data-device", "mobile");
    await expect.poll(() => inView<number, undefined>(app, "(contents) => contents.executeJavaScript('innerWidth')")).toBe(390);
    const viewWidth = (): Promise<number | undefined> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.at(-1)?.getBounds().width);
    await expect.poll(viewWidth).toBe(390);
    await shotWithPage(app, page, "browser-mobile-preset");
    await page.getByTestId("browser-tools").click();
    await page.getByTestId("browser-device-desktop").click();
    await expect(panel).toHaveAttribute("data-device", "desktop");

    await page.getByTestId("browser-tools").click();
    await page.getByTestId("browser-screenshot").click();
    const bar = page.getByTestId("browser-shot-bar");
    await expect(bar).toBeVisible();
    const saved = await bar.getAttribute("data-path");
    expect(saved).not.toBeNull();
    expect(path.dirname(saved!)).toBe(path.join(launched.dirs.userData, "screenshots"));
    expect(existsSync(saved!)).toBe(true);

    await page.getByTestId("browser-tools").click();
    await page.getByTestId("browser-pick").click();
    await expect(page.getByTestId("browser-pick-bar")).toBeVisible();
    await expect(panel).toHaveAttribute("data-page-visible", "true");
    // Once the picker is armed in the page, click the heading like a user would.
    await expect(page.getByTestId("browser-pick-bar")).toHaveAttribute("data-armed", "true");
    const target = await inView<{ x: number; y: number }, undefined>(app,
      "(contents) => contents.executeJavaScript(\"(() => { const r = document.getElementById('hello').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()\")");
    await inView(app, `async (contents, point) => {
      contents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      contents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
      contents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    }`, target);
    await expect(page.getByTestId("browser-pick-bar")).toHaveCount(0);
    await expect(byTestId(page, TESTID.composerInput)).toHaveValue(/\[element\] #hello - Hello there/);
    await expect(page.getByTestId("browser-notice")).toContainText("Element reference added");

    await page.getByTestId("browser-back").click();
    await expect(panel).toHaveAttribute("data-url", `${origin}/`);
    await expect.poll(() => inView<string, undefined>(app, "(contents) => contents.getTitle()")).toBe("Home");
    await shotWithPage(app, page, "browser-local-page");

    // The thread keeps its page: closing and reopening the tab shows it again, and the start page lists it as recent.
    await page.getByTestId("right-tab-files").click();
    await page.getByTestId("right-tab-browser").click();
    await expect(panel).toHaveAttribute("data-url", `${origin}/`);
    await page.getByTestId("browser-home").click();
    await expect(page.getByTestId("browser-recent-row").first()).toHaveAttribute("title", `${origin}/`);
  } finally {
    await launched.close();
    server.close();
  }
});
