export type BrowserPresetId = "comfyui" | "penpot" | "flowpix" | "superi";

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
    url: "https://flowpix.ai",
    profile: "flowpix",
  },
  {
    id: "superi",
    label: "Super-i",
    url: "https://superi.ai",
    profile: "superi-chrome",
  },
];

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
