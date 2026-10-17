import assert from "node:assert/strict";
import { test } from "node:test";

test("browser tabs keep profile, url, and active tab in local storage", async () => {
  const { createBrowserTab, loadBrowserState, saveBrowserState } = await import(
    "./browserStore.ts",
  );
  const storage = new Map();
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const state = createBrowserTab(loadBrowserState(fakeStorage), {
    profile: "flowpix",
    url: "https://flowpix.ai/share/demo",
  });
  saveBrowserState(state, fakeStorage);
  const restored = loadBrowserState(fakeStorage);
  assert.equal(restored.activeTabId, state.activeTabId);
  const active = restored.tabs.find((tab) => tab.id === restored.activeTabId);
  assert.equal(active?.profile, "flowpix");
  assert.equal(active?.url, "https://flowpix.ai/share/demo");
});

test("browser state rejects unknown profiles and falls back to a safe preset", async () => {
  const { loadBrowserState } = await import("./browserStore.ts");
  const state = loadBrowserState({
    getItem: () =>
      JSON.stringify({
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", profile: "buzz", url: "javascript:alert(1)" }],
      }),
  });
  assert.equal(state.tabs[0].profile, "default");
  assert.equal(state.tabs[0].url, "about:blank");
});
