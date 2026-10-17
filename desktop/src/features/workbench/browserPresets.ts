export type BrowserPresetId = "comfyui" | "penpot" | "flowpix" | "superi";

export type BrowserPreset = {
  id: BrowserPresetId;
  label: string;
  url: string;
  profile: string;
};

export const BROWSER_PRESETS: readonly BrowserPreset[] = [
  { id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", profile: "default" },
  { id: "penpot", label: "Penpot", url: "http://127.0.0.1:4401", profile: "default" },
  { id: "flowpix", label: "FlowPix", url: "https://flowpix.ai", profile: "flowpix" },
  { id: "superi", label: "Super-i", url: "https://superi.ai", profile: "superi-chrome" },
];

export function normalizeBrowserUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "about:blank";
  } catch {
    return "about:blank";
  }
}
