import assert from "node:assert/strict";
import { test } from "node:test";

test("browser presets are local and editable without remote credentials", async () => {
  const { BROWSER_PRESETS, normalizeBrowserUrl } = await import(
    "./browserPresets.ts",
  );
  assert.equal(BROWSER_PRESETS.find((item) => item.id === "comfyui")?.url, "http://127.0.0.1:8188");
  assert.equal(normalizeBrowserUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), "about:blank");
});
