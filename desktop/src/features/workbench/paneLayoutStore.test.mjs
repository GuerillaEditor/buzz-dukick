import assert from "node:assert/strict";
import { test } from "node:test";

const {
  DEFAULT_PANE_LAYOUT,
  clampWorkbenchWidth,
  closePaneIn,
  normalizePaneLayout,
  openPaneIn,
  resizePanePairIn,
  toggleMaximizeIn,
  togglePaneIn,
} = await import("./paneLayoutStore.ts");

test("panes open in click order and close cleanly", () => {
  let layout = openPaneIn(DEFAULT_PANE_LAYOUT, "browser");
  layout = openPaneIn(layout, "terminal");
  layout = openPaneIn(layout, "browser");
  assert.deepEqual(layout.open, ["browser", "terminal"]);
  layout = toggleMaximizeIn(layout, "terminal");
  assert.equal(layout.maximized, "terminal");
  layout = closePaneIn(layout, "terminal");
  assert.deepEqual(layout.open, ["browser"]);
  assert.equal(layout.maximized, null);
  layout = togglePaneIn(layout, "browser");
  assert.deepEqual(layout.open, []);
});

test("maximize only applies to open panes", () => {
  assert.equal(toggleMaximizeIn(DEFAULT_PANE_LAYOUT, "files").maximized, null);
});

test("stored layout is sanitised", () => {
  const layout = normalizePaneLayout({
    open: ["files", "bogus", "files", "terminal"],
    maximized: "browser",
    width: 12,
    weights: { files: -1, terminal: 2 },
  });
  assert.deepEqual(layout.open, ["files", "terminal"]);
  assert.equal(layout.maximized, null);
  assert.equal(layout.width, 340);
  assert.equal(layout.weights.files, 1);
  assert.equal(layout.weights.terminal, 2);
  assert.deepEqual(normalizePaneLayout("nope"), DEFAULT_PANE_LAYOUT);
});

test("workbench width leaves room for chat", () => {
  assert.equal(clampWorkbenchWidth(5000, 1600), 1220);
  assert.equal(clampWorkbenchWidth(100, 1600), 340);
  assert.equal(clampWorkbenchWidth(600, 1600), 600);
});

test("pane splitter keeps both panes above the minimum", () => {
  const layout = resizePanePairIn(
    DEFAULT_PANE_LAYOUT,
    "browser",
    "terminal",
    5,
  );
  const total = layout.weights.browser + layout.weights.terminal;
  assert.ok(Math.abs(total - 2) < 1e-9);
  assert.ok(layout.weights.terminal >= 0.15 * 2 - 1e-9);
  const back = resizePanePairIn(layout, "browser", "terminal", -0.25);
  assert.ok(back.weights.browser < layout.weights.browser);
});
