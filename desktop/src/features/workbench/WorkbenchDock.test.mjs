import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost",
});
let cleanup;
let act;
let fireEvent;
let render;
let screen;
let WorkbenchDock;
let createElement;
let terminalStore;

before(async () => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
    __TAURI_INTERNALS__: {
      invoke() {
        return Promise.resolve();
      },
    },
  });
  dom.window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
    writable: true,
  });
  ({ act, cleanup, fireEvent, render, screen } = await import(
    "@testing-library/react"
  ));
  ({ createElement } = await import("react"));
  ({ WorkbenchDock } = await import("./WorkbenchDock.tsx"));
  terminalStore = await import("../terminal/terminalPanelStore.ts");
});

after(() => dom.window.close());
beforeEach(() => {
  cleanup();
  dom.window.localStorage.clear();
  terminalStore.resetTerminalPanelForTests();
});

test("renders the three workbench tabs and switches panels", () => {
  render(createElement(WorkbenchDock));

  assert.ok(screen.getByRole("tab", { name: "Browser" }));
  assert.ok(screen.getByRole("tab", { name: "Terminal" }));
  assert.ok(screen.getByRole("tab", { name: "Files" }));
  fireEvent.click(screen.getByRole("tab", { name: "Files" }));
  assert.equal(
    screen.getByRole("tabpanel").getAttribute("data-panel"),
    "files",
  );
});

test("persists active tab, open state, and dock width", () => {
  render(createElement(WorkbenchDock));
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  fireEvent.change(screen.getByRole("slider", { name: "Dock width" }), {
    target: { value: "520" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close workbench" }));

  assert.deepEqual(
    JSON.parse(
      dom.window.localStorage.getItem("buzz-dukick.workbench") ?? "{}",
    ),
    {
      activeTab: "terminal",
      isOpen: false,
      width: 520,
    },
  );

  cleanup();
  render(createElement(WorkbenchDock));
  assert.equal(
    screen
      .getByRole("complementary", { name: "Workbench" })
      .getAttribute("data-open"),
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open workbench" }));
  assert.equal(
    screen.getByRole("tabpanel").getAttribute("data-panel"),
    "terminal",
  );
  assert.equal(
    screen
      .getByRole("complementary", { name: "Workbench" })
      .getAttribute("data-width"),
    "520",
  );
});

test("toggles with Ctrl+Shift+B without claiming Ctrl+J", () => {
  render(createElement(WorkbenchDock));
  fireEvent.keyDown(dom.window, { key: "b", ctrlKey: true, shiftKey: true });
  assert.equal(
    screen
      .getByRole("complementary", { name: "Workbench" })
      .getAttribute("data-open"),
    "false",
  );
  fireEvent.keyDown(dom.window, { key: "j", ctrlKey: true });
  assert.equal(
    screen
      .getByRole("complementary", { name: "Workbench" })
      .getAttribute("data-open"),
    "false",
  );
});

test("terminal mode opens the dock on a stable portal host", async () => {
  render(createElement(WorkbenchDock));

  await act(async () => terminalStore.setTerminalPanelMode("docked"));
  assert.equal(
    screen.getByRole("tabpanel").getAttribute("data-panel"),
    "terminal",
  );
  const host = document.getElementById("buzz-terminal-dock-host");
  assert.ok(host);

  fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
  assert.equal(terminalStore.getTerminalPanelSnapshotForTests().mode, "closed");
  assert.equal(document.getElementById("buzz-terminal-dock-host"), host);

  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  assert.equal(terminalStore.getTerminalPanelSnapshotForTests().mode, "docked");
  assert.equal(document.getElementById("buzz-terminal-dock-host"), host);
});

test("V1: closing the workbench unmounts BrowserPanel so native webviews are hidden", () => {
  render(createElement(WorkbenchDock));
  assert.ok(screen.getByLabelText("Browser panel"));
  fireEvent.click(screen.getByRole("button", { name: "Close workbench" }));
  assert.equal(screen.queryByLabelText("Browser panel"), null);
});

test("V2: closing the terminal mode also closes its workbench dock", async () => {
  render(createElement(WorkbenchDock));
  await act(async () => terminalStore.setTerminalPanelMode("docked"));
  assert.equal(
    screen.getByRole("complementary", { name: "Workbench" }).dataset.open,
    "true",
  );
  await act(async () => terminalStore.setTerminalPanelMode("closed"));
  assert.equal(
    screen.getByRole("complementary", { name: "Workbench" }).dataset.open,
    "false",
  );
});
