import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import JSON5 from "json5";
import { readModelRouting, saveModelRouting } from "../../electron/omo/model-routing";

describe("native model routing", () => {
  it("preserves JSONC comments outside model chains while retaining the native routing block", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "omo-routes-comments-"));
    await mkdir(path.join(home, ".omo"));
    const file = path.join(home, ".omo", "omo.jsonc");
    await writeFile(file, '{\n // keep profile guidance\n "model_profile": "daily-normal",\n "[senpi]": {\n // keep tool configuration\n "tools": {"enabled": true},\n "agents": {"librarian": {"models": ["old"]}}\n }\n}\n');
    const current = await readModelRouting(home);
    await saveModelRouting(home, { ...current, agents: current.agents.map((row) => row.name === "librarian" ? { ...row, models: ["new", "fallback:high"] } : row) });
    const saved = await readFile(file, "utf8");
    expect(saved).toContain("// keep profile guidance");
    expect(saved).toContain("// keep tool configuration");
    expect(saved).not.toContain('"[native]"');
    expect((await readModelRouting(home)).agents.find((row) => row.name === "librarian")?.models).toEqual(["new", "fallback:high"]);
  });
  it("reads JSONC native overrides and preserves root fields, other harnesses and reasoning objects", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "omo-ui-routing-"));
    await mkdir(path.join(home, ".omo"));
    const file = path.join(home, ".omo", "omo.jsonc");
    const original = '// user notes\n{"model_profile":"daily-normal","[codex]":{"task":{"concurrency":2}},"categories":{"quick":{"description":"keep","models":[{"model":"openai/gpt-6.1-sol","reasoning":"high"}]}},"[senpi]":{"agents":{"librarian":{"models":["opencodex/openai/gpt-6.1-sol:high"],"prompt_append":"keep"}}},}';
    await writeFile(file, original);
    const settings = await readModelRouting(home);
    expect(settings.agents[0]?.models).toEqual(["opencodex/openai/gpt-6.1-sol:high"]);
    await saveModelRouting(home, { categories: [{ name: "quick", models: ["openai/gpt-6.1-sol:high", "openai/other:low"] }], agents: [{ name: "librarian", models: ["openai/other:high"] }], mappings: [{ name: "research", models: ["openai/other:high"] }] });
    const result = JSON5.parse(await readFile(file, "utf8"));
    expect(result["model_profile"]).toBe("daily-normal");
    expect(result["[codex]"]).toEqual({ task: { concurrency: 2 } });
    expect(result["[senpi]"].categories.quick).toEqual({ description: "keep", models: [{ model: "openai/gpt-6.1-sol", reasoning: "high" }, "openai/other:low"] });
    expect(result["[senpi]"].agents.librarian).toEqual({ prompt_append: "keep", models: ["openai/other:high"] });
    expect(result["[senpi]"].models.research.model).toBe("openai/other:high");
    expect(await readFile(`${file}.models.bak`, "utf8")).toBe(original);
  });
  it("rejects invalid references without changing the original configuration", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "omo-ui-routing-invalid-"));
    await mkdir(path.join(home, ".omo"));
    const file = path.join(home, ".omo", "omo.json");
    await writeFile(file, '{"model_profile":"daily-normal"}');
    await expect(saveModelRouting(home, { categories: [], agents: [], mappings: [{ name: "unsafe", models: ["a\nb"] }] })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe('{"model_profile":"daily-normal"}');
  });
  it("persists empty chains over root defaults without losing route metadata or unrelated configuration", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "omo-routes-clear-"));
    await mkdir(path.join(home, ".omo"));
    const file = path.join(home, ".omo", "omo.json");
    const original = {
      categories: { quick: { models: ["root-model"], description: "root metadata" } },
      "[codex]": { categories: { quick: { models: ["other-harness"] } } },
      "[senpi]": {
        tools: { enabled: true },
        agents: { librarian: { model: "native-model", prompt_append: "keep prompt" } },
        categories: { quick: { models: ["native-model"], description: "native metadata" } },
      },
    };
    await writeFile(file, JSON.stringify(original));
    const current = await readModelRouting(home);
    expect(current.categories).toEqual([{ name: "quick", models: ["native-model"] }]);
    const saved = await saveModelRouting(home, { ...current, categories: [{ name: "quick", models: [] }], agents: [{ name: "librarian", models: [] }] });
    expect(await readModelRouting(home)).toEqual(saved);
    const result = JSON5.parse(await readFile(file, "utf8"));
    expect(result.categories).toEqual(original.categories);
    expect(result["[codex]"]).toEqual(original["[codex]"]);
    expect(result["[senpi]"].tools).toEqual({ enabled: true });
    expect(result["[senpi]"].categories.quick).toEqual({ models: [], description: "native metadata" });
    expect(result["[senpi]"].agents.librarian).toEqual({ models: [], prompt_append: "keep prompt" });
    await saveModelRouting(home, saved);
    expect(await readModelRouting(home)).toEqual(saved);
  });
  it("deletes mappings from both scopes without resurrecting root targets or removing metadata", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "omo-routes-remove-mapping-"));
    await mkdir(path.join(home, ".omo"));
    const file = path.join(home, ".omo", "omo.jsonc");
    const original = {
      model_profile: "daily-normal",
      models: {
        removed: { model: "root-model", reasoning: "high", description: "keep root metadata" },
        "root-only": { model: "root-only-model" },
        kept: { model: "root-kept" },
      },
      "[codex]": { models: { removed: { model: "other-harness" } } },
      "[senpi]": {
        models: {
          removed: { model: "native-model", reasoning: "low", description: "keep native metadata" },
          "native-only": { model: "native-only-model" },
          kept: { model: "native-kept", description: "keep mapping metadata" },
        },
      },
    };
    await writeFile(file, JSON.stringify(original));
    const current = await readModelRouting(home);
    expect(current.mappings.find((row) => row.name === "kept")?.models).toEqual(["native-kept"]);
    const saved = await saveModelRouting(home, { ...current, mappings: current.mappings.filter((row) => row.name === "kept") });
    expect(await readModelRouting(home)).toEqual(saved);
    const result = JSON5.parse(await readFile(file, "utf8"));
    expect(result.model_profile).toBe(original.model_profile);
    expect(result["[codex]"]).toEqual(original["[codex]"]);
    expect(result.models).toEqual({ removed: { description: "keep root metadata" }, kept: { model: "root-kept" } });
    expect(result["[senpi]"].models).toEqual({ removed: { description: "keep native metadata" }, kept: { model: "native-kept", description: "keep mapping metadata" } });
    await saveModelRouting(home, { ...saved, mappings: [] });
    expect((await readModelRouting(home)).mappings).toEqual([]);
  });
});
