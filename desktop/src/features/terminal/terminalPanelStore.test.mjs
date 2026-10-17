import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  resetTerminalPanelForTests,
  setTerminalPanelMode,
  setTerminalSessionChannels,
  toggleTerminalPanel,
  getTerminalPanelSnapshotForTests,
  requestTerminalSession,
} from "./terminalPanelStore.ts";

beforeEach(resetTerminalPanelForTests);

test("panel toggles between closed and the docked default", () => {
  toggleTerminalPanel();
  assert.equal(getTerminalPanelSnapshotForTests().mode, "docked");
  toggleTerminalPanel();
  assert.equal(getTerminalPanelSnapshotForTests().mode, "closed");
  setTerminalPanelMode("maximized");
  toggleTerminalPanel();
  assert.equal(getTerminalPanelSnapshotForTests().mode, "closed");
});

test("session channel identities are de-duplicated", () => {
  setTerminalSessionChannels(["one", "one", "two"]);
  // Regression guard: accepting an iterable (rather than Session objects) keeps
  // this store UI-only and prevents mutable PTYs from leaking into header state.
  setTerminalSessionChannels(new Set(["one", "two"]));
  assert.deepEqual(
    [...getTerminalPanelSnapshotForTests().sessionChannelIds],
    ["one", "two"],
  );
});

test("a UI-only session request opens the dock and publishes a monotonic signal", () => {
  assert.equal(getTerminalPanelSnapshotForTests().newSessionRequestId, 0);
  requestTerminalSession();
  assert.equal(getTerminalPanelSnapshotForTests().mode, "docked");
  assert.equal(getTerminalPanelSnapshotForTests().newSessionRequestId, 1);
  requestTerminalSession();
  assert.equal(getTerminalPanelSnapshotForTests().newSessionRequestId, 2);
});
