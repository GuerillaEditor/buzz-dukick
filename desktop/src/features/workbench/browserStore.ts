import * as React from "react";

import { normalizeBrowserUrl } from "./browserPresets";

export const BROWSER_STORAGE_KEY = "buzz-dukick.browser";
export const PROFILE_NAMES = [
  "default",
  "superi-chrome",
  "superi-firefox",
  "flowpix",
  "higgsfield",
  "pinterest",
] as const;
export type BrowserProfile = (typeof PROFILE_NAMES)[number];

export type BrowserTab = {
  id: string;
  profile: BrowserProfile;
  url: string;
  title?: string;
  nativeLabel?: string;
  loading?: boolean;
};
export type BrowserState = { activeTabId: string; tabs: BrowserTab[] };

export const DEFAULT_BROWSER_STATE: BrowserState = {
  activeTabId: "tab-1",
  tabs: [{ id: "tab-1", profile: "default", url: "about:blank" }],
};

function safeProfile(value: unknown): BrowserProfile {
  return PROFILE_NAMES.includes(value as BrowserProfile)
    ? (value as BrowserProfile)
    : "default";
}

function safeTab(value: unknown, fallbackId: string): BrowserTab {
  const item =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const id =
    typeof item.id === "string" && item.id.length > 0 ? item.id : fallbackId;
  return {
    id,
    profile: safeProfile(item.profile),
    url:
      typeof item.url === "string"
        ? normalizeBrowserUrl(item.url)
        : "about:blank",
    ...(typeof item.title === "string"
      ? { title: item.title.slice(0, 200) }
      : {}),
  };
}

export function loadBrowserState(
  storage?: Pick<Storage, "getItem"> | null,
): BrowserState {
  if (!storage) return DEFAULT_BROWSER_STATE;
  try {
    const parsed = JSON.parse(
      storage.getItem(BROWSER_STORAGE_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    const rawTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    const tabs = rawTabs.map((tab, index) => safeTab(tab, `tab-${index + 1}`));
    if (tabs.length === 0) return DEFAULT_BROWSER_STATE;
    const requested =
      typeof parsed?.activeTabId === "string" ? parsed.activeTabId : tabs[0].id;
    return {
      activeTabId: tabs.some((tab) => tab.id === requested)
        ? requested
        : tabs[0].id,
      tabs,
    };
  } catch {
    return DEFAULT_BROWSER_STATE;
  }
}

export function saveBrowserState(
  state: BrowserState,
  storage?: Pick<Storage, "setItem"> | null,
) {
  try {
    const persisted = {
      ...state,
      tabs: state.tabs.map(
        ({ nativeLabel: _nativeLabel, loading: _loading, ...tab }) => tab,
      ),
    };
    storage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Persistence is best effort; browser tabs remain usable for this session.
  }
}

export function createBrowserTab(
  state: BrowserState,
  input: { profile?: string; url?: string },
): BrowserState {
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tab: BrowserTab = {
    id,
    profile: safeProfile(input.profile),
    url: normalizeBrowserUrl(input.url ?? "about:blank"),
  };
  return { activeTabId: id, tabs: [...state.tabs, tab] };
}

export function activateBrowserTab(
  state: BrowserState,
  tabId: string,
): BrowserState {
  return state.tabs.some((tab) => tab.id === tabId)
    ? { ...state, activeTabId: tabId }
    : state;
}

export function setBrowserNativeLabel(
  state: BrowserState,
  tabId: string,
  nativeLabel: string,
): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, nativeLabel } : tab,
    ),
  };
}

export function closeBrowserTab(
  state: BrowserState,
  tabId: string,
): BrowserState {
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (tabs.length === 0) return DEFAULT_BROWSER_STATE;
  return {
    activeTabId:
      state.activeTabId === tabId
        ? tabs[tabs.length - 1].id
        : state.activeTabId,
    tabs,
  };
}

export function patchBrowserTab(
  state: BrowserState,
  tabId: string,
  patch: Partial<Omit<BrowserTab, "id">>,
): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, ...patch } : tab,
    ),
  };
}

/** Apply a webview-reported change (title / url / loading) to its tab. */
export function patchBrowserTabByLabel(
  state: BrowserState,
  nativeLabel: string,
  patch: { title?: string; url?: string; loading?: boolean },
): BrowserState {
  const tab = state.tabs.find((item) => item.nativeLabel === nativeLabel);
  if (!tab) return state;
  const next: Partial<BrowserTab> = {};
  if (typeof patch.title === "string") next.title = patch.title.slice(0, 200);
  if (typeof patch.url === "string") {
    const url = normalizeBrowserUrl(patch.url);
    if (url !== "about:blank") next.url = url;
  }
  if (typeof patch.loading === "boolean") next.loading = patch.loading;
  return patchBrowserTab(state, tab.id, next);
}

// Module-level store so webview labels survive the Browser pane unmounting.
let browserSnapshot: BrowserState | null = null;
const browserListeners = new Set<() => void>();

export function getBrowserState(): BrowserState {
  if (!browserSnapshot) {
    browserSnapshot = loadBrowserState(
      typeof window === "undefined" ? null : window.localStorage,
    );
  }
  return browserSnapshot;
}

export function updateBrowserState(
  apply: (state: BrowserState) => BrowserState,
) {
  const previous = getBrowserState();
  const next = apply(previous);
  if (next === previous) return;
  browserSnapshot = next;
  saveBrowserState(
    next,
    typeof window === "undefined" ? null : window.localStorage,
  );
  for (const listener of browserListeners) listener();
}

export function useBrowserState(): BrowserState {
  return React.useSyncExternalStore(
    (listener) => {
      browserListeners.add(listener);
      return () => browserListeners.delete(listener);
    },
    getBrowserState,
    getBrowserState,
  );
}
