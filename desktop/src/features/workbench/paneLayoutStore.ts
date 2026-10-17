import * as React from "react";

import { setTerminalPanelMode } from "../terminal/terminalPanelStore";

export type PaneId = "browser" | "terminal" | "files";

export const PANE_IDS: readonly PaneId[] = ["browser", "terminal", "files"];
export const PANE_LAYOUT_STORAGE_KEY = "buzz-dukick.workbench-panes";
export const WORKBENCH_MIN_WIDTH = 340;
export const WORKBENCH_DEFAULT_WIDTH = 560;
/** Chat keeps at least this much room beside the workbench column. */
export const CHAT_MIN_WIDTH = 380;
export const PANE_MIN_WEIGHT = 0.15;

export type PaneLayout = {
  /** Open panes, top to bottom. */
  open: PaneId[];
  maximized: PaneId | null;
  width: number;
  /** Relative heights (flex-grow) of open panes. */
  weights: Record<PaneId, number>;
};

export const DEFAULT_PANE_LAYOUT: PaneLayout = {
  open: [],
  maximized: null,
  width: WORKBENCH_DEFAULT_WIDTH,
  weights: { browser: 1, terminal: 1, files: 1 },
};

function isPaneId(value: unknown): value is PaneId {
  return PANE_IDS.includes(value as PaneId);
}

export function clampWorkbenchWidth(width: number, windowWidth: number) {
  const max = Math.max(WORKBENCH_MIN_WIDTH, windowWidth - CHAT_MIN_WIDTH);
  if (!Number.isFinite(width)) return Math.min(WORKBENCH_DEFAULT_WIDTH, max);
  return Math.round(Math.min(max, Math.max(WORKBENCH_MIN_WIDTH, width)));
}

export function normalizePaneLayout(raw: unknown): PaneLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_PANE_LAYOUT;
  const value = raw as Record<string, unknown>;
  const open = Array.isArray(value.open)
    ? value.open.filter(isPaneId).filter((id, i, all) => all.indexOf(id) === i)
    : [];
  const maximized =
    isPaneId(value.maximized) && open.includes(value.maximized)
      ? value.maximized
      : null;
  const width =
    typeof value.width === "number" && Number.isFinite(value.width)
      ? Math.max(WORKBENCH_MIN_WIDTH, value.width)
      : WORKBENCH_DEFAULT_WIDTH;
  const rawWeights =
    value.weights && typeof value.weights === "object"
      ? (value.weights as Record<string, unknown>)
      : {};
  const weights = { ...DEFAULT_PANE_LAYOUT.weights };
  for (const id of PANE_IDS) {
    const weight = rawWeights[id];
    if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
      weights[id] = Math.max(PANE_MIN_WEIGHT, weight);
    }
  }
  return { open, maximized, width, weights };
}

export function openPaneIn(layout: PaneLayout, id: PaneId): PaneLayout {
  if (layout.open.includes(id)) return layout;
  return { ...layout, open: [...layout.open, id] };
}

export function closePaneIn(layout: PaneLayout, id: PaneId): PaneLayout {
  if (!layout.open.includes(id)) return layout;
  return {
    ...layout,
    open: layout.open.filter((pane) => pane !== id),
    maximized: layout.maximized === id ? null : layout.maximized,
  };
}

export function togglePaneIn(layout: PaneLayout, id: PaneId): PaneLayout {
  return layout.open.includes(id)
    ? closePaneIn(layout, id)
    : openPaneIn(layout, id);
}

export function toggleMaximizeIn(layout: PaneLayout, id: PaneId): PaneLayout {
  if (!layout.open.includes(id)) return layout;
  return { ...layout, maximized: layout.maximized === id ? null : id };
}

/**
 * Move the boundary between two neighbouring panes by `fraction` of the
 * pair's combined height, keeping both above the minimum weight.
 */
export function resizePanePairIn(
  layout: PaneLayout,
  upper: PaneId,
  lower: PaneId,
  fraction: number,
): PaneLayout {
  const total = layout.weights[upper] + layout.weights[lower];
  const min = PANE_MIN_WEIGHT * total;
  const nextUpper = Math.min(
    total - min,
    Math.max(min, layout.weights[upper] + fraction * total),
  );
  return {
    ...layout,
    weights: {
      ...layout.weights,
      [upper]: nextUpper,
      [lower]: total - nextUpper,
    },
  };
}

function readStorage(): PaneLayout {
  try {
    return normalizePaneLayout(
      JSON.parse(
        globalThis.localStorage?.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null",
      ),
    );
  } catch {
    return DEFAULT_PANE_LAYOUT;
  }
}

let snapshot: PaneLayout | null = null;
const listeners = new Set<() => void>();

function current(): PaneLayout {
  if (!snapshot) snapshot = readStorage();
  return snapshot;
}

function publish(next: PaneLayout) {
  const previous = current();
  if (next === previous) return;
  snapshot = next;
  try {
    globalThis.localStorage?.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Layout persistence is best effort.
  }
  const terminalWasOpen = previous.open.includes("terminal");
  const terminalIsOpen = next.open.includes("terminal");
  if (terminalWasOpen !== terminalIsOpen) {
    setTerminalPanelMode(terminalIsOpen ? "docked" : "closed");
  }
  for (const listener of listeners) listener();
}

export function getPaneLayout(): PaneLayout {
  return current();
}

export function openPane(id: PaneId) {
  publish(openPaneIn(current(), id));
}

export function closePane(id: PaneId) {
  publish(closePaneIn(current(), id));
}

export function togglePane(id: PaneId) {
  publish(togglePaneIn(current(), id));
}

export function togglePaneMaximized(id: PaneId) {
  publish(toggleMaximizeIn(current(), id));
}

export function setWorkbenchWidth(width: number) {
  const layout = current();
  if (layout.width === width) return;
  publish({ ...layout, width });
}

export function resizePanePair(upper: PaneId, lower: PaneId, fraction: number) {
  publish(resizePanePairIn(current(), upper, lower, fraction));
}

export function usePaneLayout(): PaneLayout {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    current,
  );
}

export function resetPaneLayoutForTests(
  next: PaneLayout = DEFAULT_PANE_LAYOUT,
) {
  snapshot = next;
}
