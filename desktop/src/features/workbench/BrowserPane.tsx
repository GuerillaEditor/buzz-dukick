import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import {
  addressBarText,
  BROWSER_PRESETS_UPDATED_EVENT,
  type BrowserPreset,
  loadBrowserPresets,
  resolveAddressInput,
} from "./browserPresets";
import {
  activateBrowserTab,
  closeBrowserTab,
  createBrowserTab,
  getBrowserState,
  patchBrowserTab,
  patchBrowserTabByLabel,
  PROFILE_NAMES,
  setBrowserNativeLabel,
  type BrowserProfile,
  type BrowserTab,
  updateBrowserState,
  useBrowserState,
} from "./browserStore";
import { PANE_ICON_BUTTON_CLASS, PaneHeader } from "./PaneHeader";
import { openPane } from "./paneLayoutStore";

type BrowserOpenResult = { label: string; profile: string; url: string };

const opening = new Set<string>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function tabTitle(tab: BrowserTab): string {
  if (tab.url === "about:blank") return "New tab";
  return tab.title?.trim() || hostOf(tab.url) || tab.url;
}

function safeProfile(value: string | undefined): BrowserProfile {
  return PROFILE_NAMES.includes(value as BrowserProfile)
    ? (value as BrowserProfile)
    : "default";
}

/** Load `input` (URL or search text) in a tab, creating its webview if needed. */
export async function openInBrowserTab(
  tabId: string,
  input: string,
  profileOverride?: BrowserProfile,
) {
  const tab = getBrowserState().tabs.find((item) => item.id === tabId);
  if (!tab) return;
  const url = resolveAddressInput(input);
  const profile = profileOverride ?? tab.profile;
  if (url === "about:blank") {
    if (tab.nativeLabel) {
      await invoke("workbench_browser_close", { label: tab.nativeLabel }).catch(
        () => undefined,
      );
    }
    updateBrowserState((state) =>
      patchBrowserTab(state, tabId, {
        url,
        profile,
        title: undefined,
        nativeLabel: undefined,
        loading: false,
      }),
    );
    return;
  }
  updateBrowserState((state) =>
    patchBrowserTab(state, tabId, { url, profile, loading: true }),
  );
  if (!isTauri()) return;
  try {
    if (tab.nativeLabel && tab.profile === profile) {
      await invoke("workbench_browser_navigate", {
        label: tab.nativeLabel,
        url,
      });
      return;
    }
    if (tab.nativeLabel) {
      await invoke("workbench_browser_close", { label: tab.nativeLabel }).catch(
        () => undefined,
      );
      updateBrowserState((state) =>
        patchBrowserTab(state, tabId, { nativeLabel: undefined }),
      );
    }
    opening.add(tabId);
    const result = await invoke<BrowserOpenResult>("workbench_browser_open", {
      profile,
      url,
      tabId,
    });
    updateBrowserState((state) =>
      setBrowserNativeLabel(state, tabId, result.label),
    );
  } catch (error) {
    console.warn("workbench browser failed", error);
    updateBrowserState((state) =>
      patchBrowserTab(state, tabId, { loading: false }),
    );
  } finally {
    opening.delete(tabId);
  }
}

export function newBrowserTab(input?: string, profile?: BrowserProfile) {
  updateBrowserState((state) =>
    createBrowserTab(state, { profile: profile ?? "default" }),
  );
  openPane("browser");
  const { activeTabId } = getBrowserState();
  if (input) void openInBrowserTab(activeTabId, input, profile);
  return activeTabId;
}

async function closeTab(tabId: string) {
  const tab = getBrowserState().tabs.find((item) => item.id === tabId);
  if (tab?.nativeLabel) {
    await invoke("workbench_browser_close", { label: tab.nativeLabel }).catch(
      () => undefined,
    );
  }
  updateBrowserState((state) => closeBrowserTab(state, tabId));
}

/**
 * Webview → UI events. Mounted by the workbench shell so agent-opened tabs
 * show up even while the Browser pane is closed.
 */
export function useBrowserEvents() {
  React.useEffect(() => {
    if (!isTauri()) return;
    const stops = Promise.all([
      listen<{
        label?: string;
        url?: string;
        title?: string;
        loading?: boolean;
      }>("workbench-browser-state", (event) => {
        const { label, ...patch } = event.payload ?? {};
        if (!label) return;
        updateBrowserState((state) =>
          patchBrowserTabByLabel(state, label, patch),
        );
      }),
      listen<{
        label?: string;
        profile?: string;
        url?: string;
        tabId?: string;
      }>("workbench-browser-opened", (event) => {
        const { label, profile, url, tabId } = event.payload ?? {};
        if (!label || tabId) return;
        if (getBrowserState().tabs.some((tab) => tab.nativeLabel === label))
          return;
        // Opened by an agent through the Workbench MCP: adopt it as a tab.
        updateBrowserState((state) => {
          const next = createBrowserTab(state, {
            profile: safeProfile(profile),
            url,
          });
          return setBrowserNativeLabel(next, next.activeTabId, label);
        });
        openPane("browser");
      }),
      listen<{ url?: string; profile?: string }>(
        "workbench-browser-new-tab",
        (event) => {
          const { url, profile } = event.payload ?? {};
          if (url) newBrowserTab(url, safeProfile(profile));
        },
      ),
    ]);
    return () => {
      void stops.then((list) => {
        for (const stop of list) stop();
      });
    };
  }, []);
}

function hasBlockingOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[data-radix-popper-content-wrapper]:not(:has([role="tooltip"])), [role="dialog"], [role="alertdialog"]',
    ),
  );
}

/** Keep the native webview glued to `placeholder` every frame. */
function useNativeViewport(
  placeholderRef: React.RefObject<HTMLDivElement | null>,
) {
  React.useEffect(() => {
    if (!isTauri()) return;
    let frame = 0;
    let last = "";
    const tick = () => {
      const element = placeholderRef.current;
      let viewport = { x: 0, y: 0, width: 0, height: 0, visible: false };
      if (
        element &&
        document.visibilityState === "visible" &&
        !hasBlockingOverlay()
      ) {
        const rect = element.getBoundingClientRect();
        viewport = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: rect.width > 1 && rect.height > 1,
        };
      }
      const key = `${viewport.x},${viewport.y},${viewport.width},${viewport.height},${viewport.visible}`;
      if (key !== last) {
        last = key;
        void invoke("workbench_browser_set_viewport", { viewport }).catch(
          () => undefined,
        );
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      void invoke("workbench_browser_set_viewport", {
        viewport: { x: 0, y: 0, width: 0, height: 0, visible: false },
      }).catch(() => undefined);
    };
  }, [placeholderRef]);
}

function Favicon({ url, className }: { url: string; className?: string }) {
  const host = hostOf(url);
  const [failedHost, setFailedHost] = React.useState<string | null>(null);
  if (!host || failedHost === host) {
    return <Globe className={cn("size-3.5 shrink-0 opacity-70", className)} />;
  }
  return (
    <img
      alt=""
      className={cn("size-3.5 shrink-0 rounded-sm", className)}
      onError={() => setFailedHost(host)}
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
    />
  );
}

function BrowserTabs({
  tabs,
  activeTabId,
}: {
  tabs: BrowserTab[];
  activeTabId: string;
}) {
  return (
    <div
      aria-label="Browser tabs"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const title = tabTitle(tab);
        return (
          <div
            className={cn(
              "group flex h-7 min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[12.5px]",
              active
                ? "bg-foreground/[0.07] text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
            key={tab.id}
          >
            <button
              aria-selected={active}
              className="flex min-w-0 flex-1 items-center gap-1.5"
              onClick={() =>
                updateBrowserState((state) => activateBrowserTab(state, tab.id))
              }
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void closeTab(tab.id);
                }
              }}
              role="tab"
              title={title}
              type="button"
            >
              {tab.loading ? (
                <RotateCw className="size-3.5 shrink-0 animate-spin opacity-70" />
              ) : (
                <Favicon url={tab.url} />
              )}
              <span className="truncate">{title}</span>
            </button>
            <button
              aria-label={`Close ${title}`}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              onClick={() => void closeTab(tab.id)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Button
        aria-label="New browser tab"
        className={PANE_ICON_BUTTON_CLASS}
        onClick={() => newBrowserTab()}
        size="icon"
        variant="ghost"
      >
        <Plus />
      </Button>
    </div>
  );
}

function StartPage({
  presets,
  onOpen,
}: {
  presets: BrowserPreset[];
  onOpen: (input: string, profile?: BrowserProfile) => void;
}) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-8 pt-[12%]">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Globe className="size-7 text-muted-foreground/70" />
          <h2 className="text-lg font-semibold text-foreground">New tab</h2>
          <p className="text-[13px] text-muted-foreground">
            Browse here — Claude Thái and Codex Thái can drive this tab too.
          </p>
        </div>
        <form
          className="flex h-11 w-full items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-4 focus-within:border-primary/50 focus-within:bg-background"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) onOpen(query);
          }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search or enter address"
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Google or type a URL"
            value={query}
          />
        </form>
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {presets.map((preset) => (
            <button
              className="flex flex-col items-start gap-2 rounded-xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-border hover:bg-muted/40"
              key={preset.id}
              onClick={() => onOpen(preset.url, safeProfile(preset.profile))}
              type="button"
            >
              <Favicon className="size-5" url={preset.url} />
              <span className="flex w-full min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium">
                  {preset.label}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {hostOf(preset.url)}
                  {preset.profile !== "default" ? ` · ${preset.profile}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BrowserPane() {
  const state = useBrowserState();
  const active =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const isStartPage = active.url === "about:blank";
  const [presets, setPresets] = React.useState(() =>
    loadBrowserPresets(
      typeof window === "undefined" ? null : window.localStorage,
    ),
  );
  const [address, setAddress] = React.useState(addressBarText(active.url));
  const [editing, setEditing] = React.useState(false);
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  useNativeViewport(placeholderRef);

  React.useEffect(() => {
    if (!editing) setAddress(addressBarText(active.url));
  }, [active.url, editing]);

  React.useEffect(() => {
    const reload = () => setPresets(loadBrowserPresets(window.localStorage));
    window.addEventListener(BROWSER_PRESETS_UPDATED_EVENT, reload);
    return () =>
      window.removeEventListener(BROWSER_PRESETS_UPDATED_EVENT, reload);
  }, []);

  // Show only the active tab's webview (none on the start page).
  React.useEffect(() => {
    if (!isTauri()) return;
    void invoke("workbench_browser_activate", {
      label: isStartPage ? null : (active.nativeLabel ?? null),
    }).catch(() => undefined);
  }, [active.nativeLabel, isStartPage]);

  // Tabs restored from a previous session get their webview lazily.
  React.useEffect(() => {
    if (isStartPage || active.nativeLabel || opening.has(active.id)) return;
    void openInBrowserTab(active.id, active.url);
  }, [active.id, active.nativeLabel, active.url, isStartPage]);

  const navigateHistory = (direction: "back" | "forward") => {
    if (active.nativeLabel)
      void invoke("workbench_browser_history", {
        label: active.nativeLabel,
        direction,
      }).catch(() => undefined);
  };

  return (
    <>
      <PaneHeader
        menu={
          <>
            <DropdownMenuItem
              disabled={isStartPage}
              onSelect={() => void openUrl(active.url)}
            >
              <ExternalLink />
              Open in system browser
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => newBrowserTab()}>
              <Plus />
              New tab
            </DropdownMenuItem>
          </>
        }
        paneId="browser"
        title="Browser"
      >
        <BrowserTabs activeTabId={active.id} tabs={state.tabs} />
      </PaneHeader>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <Button
          aria-label="Back"
          className={PANE_ICON_BUTTON_CLASS}
          disabled={!active.nativeLabel}
          onClick={() => navigateHistory("back")}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <Button
          aria-label="Forward"
          className={PANE_ICON_BUTTON_CLASS}
          disabled={!active.nativeLabel}
          onClick={() => navigateHistory("forward")}
          size="icon"
          variant="ghost"
        >
          <ArrowRight />
        </Button>
        <Button
          aria-label="Reload"
          className={PANE_ICON_BUTTON_CLASS}
          disabled={!active.nativeLabel}
          onClick={() =>
            active.nativeLabel &&
            void invoke("workbench_browser_reload", {
              label: active.nativeLabel,
            }).catch(() => undefined)
          }
          size="icon"
          variant="ghost"
        >
          <RotateCw className={active.loading ? "animate-spin" : undefined} />
        </Button>
        <form
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted/60 px-3 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/40"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            (document.activeElement as HTMLElement | null)?.blur();
            void openInBrowserTab(active.id, address);
          }}
        >
          {isStartPage ? (
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Favicon url={active.url} />
          )}
          <input
            aria-label="Browser URL"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
            onBlur={() => setEditing(false)}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true);
              event.currentTarget.select();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAddress(addressBarText(active.url));
                event.currentTarget.blur();
              }
            }}
            placeholder="Search or enter address"
            spellCheck={false}
            value={address}
          />
        </form>
        <select
          aria-label="Browser profile"
          className="h-8 max-w-28 shrink-0 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground"
          onChange={(event) => {
            const profile = safeProfile(event.target.value);
            if (isStartPage) {
              updateBrowserState((current) =>
                patchBrowserTab(current, active.id, { profile }),
              );
            } else {
              void openInBrowserTab(active.id, active.url, profile);
            }
          }}
          title="Browser profile (separate cookies / logins)"
          value={active.profile}
        >
          {PROFILE_NAMES.map((profile) => (
            <option key={profile} value={profile}>
              {profile}
            </option>
          ))}
        </select>
        <Button
          aria-label="Open in system browser"
          className={PANE_ICON_BUTTON_CLASS}
          disabled={isStartPage}
          onClick={() => void openUrl(active.url)}
          size="icon"
          variant="ghost"
        >
          <ExternalLink />
        </Button>
      </div>
      {isStartPage ? (
        <StartPage
          onOpen={(input, profile) =>
            void openInBrowserTab(active.id, input, profile)
          }
          presets={presets}
        />
      ) : (
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center bg-background"
          data-workbench-browser-viewport
          ref={placeholderRef}
        >
          <span className="text-[12px] text-muted-foreground">
            {isTauri() ? "Loading…" : "Native browser needs the desktop app"}
          </span>
        </div>
      )}
    </>
  );
}
