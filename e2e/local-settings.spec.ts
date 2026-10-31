import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, newSession, tempDir } from "./helpers.ts";

test("local settings persist and excluded MCP entries leave the configuration", async () => {
  const root = tempDir("local-settings-agent");
  const project = tempDir("local-settings-project");
  mkdirSync(path.join(project, ".omo"));
  const projectConfig = JSON.stringify({ mcpServers: { "owned-disabled": { command: "project-kept", enabled: true } } });
  writeFileSync(path.join(project, ".omo", "mcp.json"), projectConfig);
  const launched = await launchApp({ omo: "fake", fakeHome: root, pickDir: project });
  try {
    const { page } = launched;
    await newSession(page); await page.getByTestId("open-settings").click();
    await page.locator('[data-section="omo"]').click();
    const native = page.getByTestId("native-settings");
    await native.getByLabel("Reserve tokens", { exact: true }).fill("12345");
    await native.getByRole("button", { name: "Save", exact: true }).click();
    await expect(native.getByRole("status")).toBeVisible();
    expect(JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8")).compaction.reserveTokens).toBe(12345);
    await page.locator('[data-section="mcp"]').click();
    const mcp = page.getByTestId("mcp-editor");
    await mcp.getByTestId("mcp-editor-name").fill("owned-disabled");
    await mcp.getByTestId("mcp-editor-command").fill("node");
    await mcp.getByTestId("mcp-editor-save").click();
    await expect(mcp).toContainText("owned-disabled");
    expect(JSON.parse(readFileSync(path.join(root, "mcp.json"), "utf8")).mcpServers["owned-disabled"].enabled).toBe(false);
    await mcp.getByRole("button", { name: "Edit", exact: true }).click();
    await mcp.getByTestId("mcp-editor-command").fill("must-not-leak");
    await mcp.getByTestId("mcp-editor-enabled").check();
    await mcp.getByTestId("mcp-editor-scope").selectOption("project");
    await expect(mcp.getByTestId("mcp-editor-name")).toHaveValue("");
    await expect(mcp.getByTestId("mcp-editor-command")).toHaveValue("");
    await expect(mcp.getByTestId("mcp-editor-enabled")).not.toBeChecked();
    expect(readFileSync(path.join(project, ".omo", "mcp.json"), "utf8")).toBe(projectConfig);
    await mcp.getByTestId("mcp-editor-scope").selectOption("global");
    await expect(mcp.getByTestId("mcp-editor-name")).toBeEnabled();
    await mcp.getByRole("button", { name: "Back up and remove from config", exact: true }).click();
    await expect(mcp.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    expect(JSON.parse(readFileSync(path.join(root, "mcp.json"), "utf8")).mcpServers).toEqual({});
    await page.locator('[data-section="about"]').click();
    await page.getByTestId("settings-licenses").locator("summary").first().click();
    await expect(page.locator('[data-license="LICENSE"]')).toHaveText(readFileSync(path.join(process.cwd(), "LICENSE"), "utf8"));
  } finally { await launched.close(); }
});
