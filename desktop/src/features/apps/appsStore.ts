import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type AppMcpServer = {
  name: string;
  transport: "http" | "stdio";
  endpoint: string;
  hasSecrets: boolean;
};

export type AppSkill = { name: string; path: string };

export type HubApp = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  webUrl: string | null;
  browserProfile: string;
  mcp: AppMcpServer[];
  skills: AppSkill[];
  sources: string[];
  added: boolean;
  custom: boolean;
  enabledTargets: string[];
};

export type AgentTarget = {
  id: string;
  kind: "claude" | "codex";
  label: string;
  dir: string;
  configFile: string;
  skillsDir: string;
  inUse: boolean;
};

export type AppsSnapshot = { apps: HubApp[]; targets: AgentTarget[] };

export type TargetSyncResult = {
  targetId: string;
  label: string;
  added: string[];
  alreadyPresent: string[];
  removed: string[];
  error: string | null;
};

export type CustomAppInput = {
  name: string;
  webUrl?: string;
  mcpUrl?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  skillDir?: string;
};

/** Agent-usable means the app brings MCP servers or skills. */
export function isAgentCapable(app: HubApp): boolean {
  return app.mcp.length > 0 || app.skills.length > 0;
}

/** Targets an app should be switched on for by default: the homes Buzz agents use. */
export function defaultTargetIds(targets: AgentTarget[]): string[] {
  const used = targets.filter((target) => target.inUse);
  return (used.length > 0 ? used : targets).map((target) => target.id);
}

export function filterApps(
  apps: HubApp[],
  query: string,
  scope: "added" | "discover",
): HubApp[] {
  const needle = query.trim().toLowerCase();
  return apps
    .filter((app) => (scope === "added" ? app.added : !app.added))
    .filter(
      (app) =>
        !needle ||
        app.name.toLowerCase().includes(needle) ||
        app.id.includes(needle) ||
        app.description.toLowerCase().includes(needle) ||
        app.mcp.some((server) => server.name.toLowerCase().includes(needle)) ||
        app.skills.some((skill) => skill.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      const rank = (app: HubApp) =>
        (app.sources.includes("preset") ? 0 : 2) + (app.webUrl ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}

let snapshot: AppsSnapshot | null = null;
let loading: Promise<void> | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function refreshApps(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  loading = invoke<AppsSnapshot>("apps_list")
    .then((next) => {
      snapshot = next;
      error = null;
    })
    .catch((reason: unknown) => {
      error = reason instanceof Error ? reason.message : String(reason);
    })
    .finally(() => {
      loading = null;
      emit();
    });
  emit();
  return loading;
}

type AppsState = {
  snapshot: AppsSnapshot | null;
  loading: boolean;
  error: string | null;
};

let state: AppsState = { snapshot: null, loading: false, error: null };

function currentState(): AppsState {
  const loadingNow = loading !== null;
  if (
    state.snapshot !== snapshot ||
    state.loading !== loadingNow ||
    state.error !== error
  ) {
    state = { snapshot, loading: loadingNow, error };
  }
  return state;
}

export function useApps(): AppsState {
  const value = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentState,
    currentState,
  );
  React.useEffect(() => {
    if (!snapshot && !loading) void refreshApps();
  }, []);
  return value;
}

export async function setAppAdded(appId: string, added: boolean) {
  await invoke("apps_set_added", { appId, added });
  await refreshApps();
}

export async function addCustomApp(input: CustomAppInput): Promise<string> {
  const id = await invoke<string>("apps_add_custom", { input });
  await refreshApps();
  return id;
}

export async function removeCustomApp(appId: string) {
  await invoke("apps_remove_custom", { appId });
  await refreshApps();
}

export async function setAppAgentUse(
  appId: string,
  targetIds: string[],
  enabled: boolean,
): Promise<TargetSyncResult[]> {
  const results = await invoke<TargetSyncResult[]>("apps_set_agent_use", {
    appId,
    targetIds,
    enabled,
  });
  await refreshApps();
  return results;
}

export function restartAgents(): Promise<number> {
  return invoke<number>("apps_restart_agents");
}
