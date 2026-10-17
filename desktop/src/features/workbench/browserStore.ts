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

export type BrowserTab = { id: string; profile: BrowserProfile; url: string; title?: string; nativeLabel?: string };
export type BrowserState = { activeTabId: string; tabs: BrowserTab[] };

export const DEFAULT_BROWSER_STATE: BrowserState = {
  activeTabId: "tab-1",
  tabs: [{ id: "tab-1", profile: "default", url: "about:blank" }],
};

function safeProfile(value: unknown): BrowserProfile {
  return PROFILE_NAMES.includes(value as BrowserProfile) ? (value as BrowserProfile) : "default";
}

function safeTab(value: unknown, fallbackId: string): BrowserTab {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = typeof item.id === "string" && item.id.length > 0 ? item.id : fallbackId;
  return {
    id,
    profile: safeProfile(item.profile),
    url: typeof item.url === "string" ? normalizeBrowserUrl(item.url) : "about:blank",
    ...(typeof item.title === "string" ? { title: item.title.slice(0, 200) } : {}),
    ...(typeof item.nativeLabel === "string" ? { nativeLabel: item.nativeLabel } : {}),
  };
}

export function loadBrowserState(storage?: Pick<Storage, "getItem"> | null): BrowserState {
  if (!storage) return DEFAULT_BROWSER_STATE;
  try {
    const parsed = JSON.parse(storage.getItem(BROWSER_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    const rawTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    const tabs = rawTabs.map((tab, index) => safeTab(tab, `tab-${index + 1}`));
    if (tabs.length === 0) return DEFAULT_BROWSER_STATE;
    const requested = typeof parsed?.activeTabId === "string" ? parsed.activeTabId : tabs[0].id;
    return { activeTabId: tabs.some((tab) => tab.id === requested) ? requested : tabs[0].id, tabs };
  } catch {
    return DEFAULT_BROWSER_STATE;
  }
}

export function saveBrowserState(state: BrowserState, storage?: Pick<Storage, "setItem"> | null) {
  try {
    storage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best effort; browser tabs remain usable for this session.
  }
}

export function createBrowserTab(state: BrowserState, input: { profile?: string; url?: string }): BrowserState {
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tab: BrowserTab = { id, profile: safeProfile(input.profile), url: normalizeBrowserUrl(input.url ?? "about:blank") };
  return { activeTabId: id, tabs: [...state.tabs, tab] };
}
