import assert from "node:assert/strict";
import { test } from "node:test";

test("browser presets are local and editable without remote credentials", async () => {
  const {
    BROWSER_PRESETS,
    BROWSER_PRESETS_STORAGE_KEY,
    loadBrowserPresets,
    normalizeBrowserUrl,
    saveBrowserPresets,
  } = await import("./browserPresets.ts");
  assert.equal(
    BROWSER_PRESETS.find((item) => item.id === "comfyui")?.url,
    "http://127.0.0.1:8188",
  );
  assert.equal(
    BROWSER_PRESETS.find((item) => item.id === "penpot")?.url,
    "http://localhost:9011",
  );
  assert.equal(
    normalizeBrowserUrl("https://example.com/path"),
    "https://example.com/path",
  );
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), "about:blank");
  let saved = "";
  const storage = {
    getItem(key) {
      assert.equal(key, BROWSER_PRESETS_STORAGE_KEY);
      return saved || null;
    },
    setItem(key, value) {
      assert.equal(key, BROWSER_PRESETS_STORAGE_KEY);
      saved = value;
    },
  };
  const edited = BROWSER_PRESETS.map((preset) =>
    preset.id === "flowpix"
      ? { ...preset, url: "https://flowpix.ai/share/abc" }
      : preset,
  );
  saveBrowserPresets(edited, storage);
  assert.equal(
    loadBrowserPresets(storage).find((item) => item.id === "flowpix")?.url,
    "https://flowpix.ai/share/abc",
  );
});

test("address bar input becomes a URL or a Google search", async () => {
  const { resolveAddressInput, addressBarText } = await import(
    "./browserPresets.ts"
  );
  assert.equal(resolveAddressInput("flowpix.club"), "https://flowpix.club/");
  assert.equal(resolveAddressInput("localhost:8188"), "http://localhost:8188/");
  assert.equal(
    resolveAddressInput("127.0.0.1:9011/x"),
    "http://127.0.0.1:9011/x",
  );
  assert.equal(
    resolveAddressInput("https://higgsfield.ai/create"),
    "https://higgsfield.ai/create",
  );
  assert.equal(
    resolveAddressInput("seedance 2.5 one take"),
    "https://www.google.com/search?q=seedance%202.5%20one%20take",
  );
  assert.equal(resolveAddressInput("  "), "about:blank");
  assert.equal(addressBarText("about:blank"), "");
});
