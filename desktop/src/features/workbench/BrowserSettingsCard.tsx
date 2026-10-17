import * as React from "react";

import {
  BROWSER_PRESETS,
  type BrowserPreset,
  loadBrowserPresets,
  normalizeBrowserUrl,
  saveBrowserPresets,
} from "./browserPresets";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";

export function BrowserSettingsCard() {
  const [presets, setPresets] = React.useState<BrowserPreset[]>(() =>
    loadBrowserPresets(window.localStorage),
  );

  const updatePreset = (id: BrowserPreset["id"], value: string) => {
    setPresets((current) =>
      current.map((preset) =>
        preset.id === id ? { ...preset, url: value } : preset,
      ),
    );
  };

  const persist = () => {
    const safe = presets.map((preset) => {
      const fallback = BROWSER_PRESETS.find((item) => item.id === preset.id);
      const url = normalizeBrowserUrl(preset.url);
      return url === "about:blank" && fallback ? fallback : { ...preset, url };
    });
    setPresets(safe);
    saveBrowserPresets(safe, window.localStorage);
  };

  return (
    <section>
      <SettingsSectionHeader
        title="Workbench browser"
        description="Edit local browser presets used by the Dukick right dock. No credentials or existing browser profiles are imported."
      />
      <SettingsOptionGroupList>
        <SettingsOptionGroup title="Preset URLs">
          {presets.map((preset) => (
            <SettingsOptionRow key={preset.id}>
              <label className="w-full space-y-1">
                <span className="font-medium">{preset.label}</span>
                <input
                  aria-label={`${preset.label} URL`}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  onChange={(event) =>
                    updatePreset(preset.id, event.target.value)
                  }
                  onBlur={persist}
                  value={preset.url}
                />
              </label>
            </SettingsOptionRow>
          ))}
        </SettingsOptionGroup>
      </SettingsOptionGroupList>
    </section>
  );
}
