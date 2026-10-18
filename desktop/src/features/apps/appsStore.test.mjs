import assert from "node:assert/strict";
import { test } from "node:test";

const { defaultTargetIds, filterApps, isAgentCapable } = await import(
  "./appsStore.ts"
);

const app = (over) => ({
  id: "x",
  name: "X",
  description: "",
  icon: null,
  webUrl: null,
  browserProfile: "x",
  mcp: [],
  skills: [],
  sources: [],
  added: false,
  custom: false,
  enabledTargets: [],
  ...over,
});

test("agent capability needs MCP servers or skills", () => {
  assert.equal(isAgentCapable(app({})), false);
  assert.equal(
    isAgentCapable(
      app({
        mcp: [
          { name: "m", transport: "http", endpoint: "u", hasSecrets: false },
        ],
      }),
    ),
    true,
  );
  assert.equal(
    isAgentCapable(app({ skills: [{ name: "s", path: "p" }] })),
    true,
  );
});

test("default targets are the homes Buzz agents use, else all", () => {
  const targets = [
    { id: "claude:a", inUse: false },
    { id: "claude:thai4", inUse: true },
    { id: "codex:media", inUse: true },
  ];
  assert.deepEqual(defaultTargetIds(targets), ["claude:thai4", "codex:media"]);
  assert.deepEqual(defaultTargetIds([{ id: "a", inUse: false }]), ["a"]);
});

test("filter splits added / discover, searches MCP and skills, presets first", () => {
  const apps = [
    app({ id: "zeta", name: "Zeta", added: true, sources: ["claude"] }),
    app({
      id: "higgsfield",
      name: "Higgsfield",
      added: true,
      webUrl: "https://higgsfield.ai",
      sources: ["preset"],
    }),
    app({
      id: "hyper",
      name: "hyperframes",
      skills: [{ name: "hyperframes-cli", path: "p" }],
    }),
  ];
  assert.deepEqual(
    filterApps(apps, "", "added").map((a) => a.id),
    ["higgsfield", "zeta"],
  );
  assert.deepEqual(
    filterApps(apps, "frames-cli", "discover").map((a) => a.id),
    ["hyper"],
  );
  assert.deepEqual(filterApps(apps, "nope", "added"), []);
});
