export type BrowserPresetId =
  | "comfyui"
  | "penpot"
  | "flowpix"
  | "superi"
  | "higgsfield"
  | "pinterest";

export type BrowserPreset = {
  id: BrowserPresetId;
  label: string;
  url: string;
  profile: string;
};

export const BROWSER_PRESETS_STORAGE_KEY = "buzz-dukick.browser-presets";
export const BROWSER_PRESETS_UPDATED_EVENT =
  "buzz-dukick:browser-presets-updated";

export const BROWSER_PRESETS: readonly BrowserPreset[] = [
  {
    id: "comfyui",
    label: "ComfyUI",
    url: "http://127.0.0.1:8188",
    profile: "default",
  },
  {
    id: "penpot",
    label: "Penpot",
    url: "http://localhost:9011",
    profile: "default",
  },
  {
    id: "flowpix",
    label: "FlowPix",
    url: "https://flowpix.club",
    profile: "flowpix",
  },
  {
    id: "superi",
    label: "Super-i",
    url: "https://www.super-i.cn",
    profile: "superi-chrome",
  },
  {
    id: "higgsfield",
    label: "Higgsfield",
    url: "https://higgsfield.ai",
    profile: "higgsfield",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    url: "https://www.pinterest.com",
    profile: "pinterest",
  },
];

const LOCAL_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
const BARE_HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/;

/**
 * Turn what the user typed in the address bar into a URL: full http(s) URLs
 * pass through, local hosts get http://, bare domains get https://, and
 * anything else becomes a Google search.
 */
export function resolveAddressInput(input: string): string {
  const value = input.trim();
  if (!value) return "about:blank";
  if (/^https?:\/\//i.test(value)) return normalizeBrowserUrl(value);
  if (!/\s/.test(value)) {
    if (LOCAL_HOST.test(value)) return normalizeBrowserUrl(`http://${value}`);
    if (BARE_HOST.test(value)) return normalizeBrowserUrl(`https://${value}`);
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

/** Text shown in the address bar: empty for the start page. */
export function addressBarText(url: string): string {
  return url === "about:blank" ? "" : url;
}

export function normalizeBrowserUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "about:blank";
  } catch {
    return "about:blank";
  }
}

export function loadBrowserPresets(
  storage?: Pick<Storage, "getItem"> | null,
): BrowserPreset[] {
  if (!storage) return [...BROWSER_PRESETS];
  try {
    const parsed = JSON.parse(
      storage.getItem(BROWSER_PRESETS_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!Array.isArray(parsed)) return [...BROWSER_PRESETS];
    return BROWSER_PRESETS.map((fallback) => {
      const saved = parsed.find(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).id === fallback.id,
      ) as Record<string, unknown> | undefined;
      if (!saved || typeof saved.url !== "string") return fallback;
      const url = normalizeBrowserUrl(saved.url);
      return url === "about:blank" ? fallback : { ...fallback, url };
    });
  } catch {
    return [...BROWSER_PRESETS];
  }
}

export function saveBrowserPresets(
  presets: readonly BrowserPreset[],
  storage?: Pick<Storage, "setItem"> | null,
) {
  storage?.setItem(BROWSER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BROWSER_PRESETS_UPDATED_EVENT));
  }
}
