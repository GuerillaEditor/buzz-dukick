import assert from "node:assert/strict";
import test from "node:test";

import { terminalFrameToText } from "./terminalMcpBridge.ts";

test("terminalFrameToText preserves row and cluster order", () => {
  const frame = {
    rows: [
      {
        line: 2,
        spans: [{ clusters: [{ column: 0, text: "world" }] }],
      },
      {
        line: 1,
        spans: [
          { clusters: [{ column: 5, text: "!" }] },
          { clusters: [{ column: 0, text: "hello" }] },
        ],
      },
    ],
  };
  assert.equal(terminalFrameToText(frame), "hello!\nworld");
});

test("terminalFrameToText handles an empty or missing frame", () => {
  assert.equal(terminalFrameToText(undefined), "");
  assert.equal(terminalFrameToText({ rows: [] }), "");
});
