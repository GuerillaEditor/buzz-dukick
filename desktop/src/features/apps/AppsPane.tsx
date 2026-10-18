import * as React from "react";
import {
  Bot,
  Check,
  ExternalLink,
  LayoutGrid,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { newBrowserTab } from "../workbench/BrowserPane";
import { AppIcon, hostOf } from "./AppIcon";
import { PANE_ICON_BUTTON_CLASS, PaneHeader } from "../workbench/PaneHeader";
import {
  addCustomApp,
  type AgentTarget,
  defaultTargetIds,
  filterApps,
  type HubApp,
  isAgentCapable,
  refreshApps,
  removeCustomApp,
  restartAgents,
  setAppAdded,
  setAppAgentUse,
  useApps,
} from "./appsStore";

export function openApp(app: HubApp) {
  if (app.webUrl) newBrowserTab(app.webUrl, app.browserProfile);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function AgentBadges({
  app,
  targets,
}: {
  app: HubApp;
  targets: AgentTarget[];
}) {
  const used = targets.filter((target) =>
    app.enabledTargets.includes(target.id),
  );
  if (used.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
      <Bot className="size-3" />
      {used.length === targets.length
        ? "Mọi agent"
        : used.map((target) => target.label).join(", ")}
    </span>
  );
}

function AppDetailDialog({
  app,
  targets,
  onClose,
}: {
  app: HubApp;
  targets: AgentTarget[];
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<string[]>(() =>
    app.enabledTargets.length > 0
      ? app.enabledTargets
      : defaultTargetIds(targets),
  );
  const [busy, setBusy] = React.useState(false);
  const capable = isAgentCapable(app);

  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      const ids = enabled
        ? selected
        : app.enabledTargets.filter((id) => selected.includes(id));
      const results = await setAppAgentUse(app.id, ids, enabled);
      const failed = results.filter((result) => result.error);
      if (failed.length > 0) {
        toast.error(
          failed.map((result) => `${result.label}: ${result.error}`).join("\n"),
        );
      } else {
        toast.success(
          enabled
            ? `${app.name}: đã bật cho ${results.length} agent. Bấm "Khởi động lại agent" để áp dụng ngay.`
            : `${app.name}: đã tắt cho agent.`,
        );
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AppIcon app={app} size={44} />
            <div className="min-w-0">
              <DialogTitle>{app.name}</DialogTitle>
              <DialogDescription className="line-clamp-2">
                {app.description || hostOf(app.webUrl) || app.id}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto text-[13px]">
          {app.webUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
              <span className="truncate text-muted-foreground">
                {app.webUrl} · profile {app.browserProfile}
              </span>
              <Button
                onClick={() => {
                  openApp(app);
                  onClose();
                }}
                size="sm"
              >
                <ExternalLink />
                Mở
              </Button>
            </div>
          ) : null}
          {app.mcp.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                MCP servers
              </h4>
              {app.mcp.map((server) => (
                <div
                  className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
                  key={server.name}
                >
                  <span className="font-medium">{server.name}</span>
                  <span className="rounded bg-background px-1 text-[10.5px] text-muted-foreground">
                    {server.transport}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
                    title={server.endpoint}
                  >
                    {server.endpoint}
                  </span>
                  {server.hasSecrets ? (
                    <span className="text-[10.5px] text-amber-600">
                      có khoá
                    </span>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          {app.skills.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Skills ({app.skills.length})
              </h4>
              <div className="flex flex-wrap gap-1">
                {app.skills.map((skill) => (
                  <span
                    className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[11.5px]"
                    key={skill.name}
                    title={skill.path}
                  >
                    {skill.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          {capable ? (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cho agent dùng
              </h4>
              {targets.map((target) => {
                const on = app.enabledTargets.includes(target.id);
                return (
                  <div
                    className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted/40"
                    key={target.id}
                  >
                    <Checkbox
                      checked={selected.includes(target.id)}
                      id={`target-${target.id}`}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...new Set([...current, target.id])]
                            : current.filter((id) => id !== target.id),
                        )
                      }
                    />
                    <label
                      className="cursor-pointer font-medium"
                      htmlFor={`target-${target.id}`}
                    >
                      {target.label}
                    </label>
                    {target.inUse ? (
                      <span className="text-[10.5px] text-muted-foreground">
                        agent Buzz đang dùng
                      </span>
                    ) : null}
                    <span
                      className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-muted-foreground"
                      title={target.configFile}
                    >
                      {target.dir}
                    </span>
                    {on ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : null}
                  </div>
                );
              })}
              <p className="text-[11.5px] text-muted-foreground">
                Ghi vào cấu hình MCP/skills của từng agent (có sao lưu
                .bak-apps). Chỉ gỡ những gì Buzz đã thêm.
              </p>
            </section>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {app.custom ? (
              <Button
                onClick={() =>
                  void removeCustomApp(app.id).then(onClose, (error) =>
                    toast.error(errorText(error)),
                  )
                }
                size="sm"
                variant="ghost"
              >
                <Trash2 />
                Xoá app
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void setAppAdded(app.id, !app.added).catch((error) =>
                    toast.error(errorText(error)),
                  )
                }
                size="sm"
                variant="outline"
              >
                {app.added ? "Bỏ khỏi Đã thêm" : "Thêm vào Đã thêm"}
              </Button>
            )}
          </div>
          {capable ? (
            <div className="flex gap-2">
              {app.enabledTargets.length > 0 ? (
                <Button
                  disabled={busy}
                  onClick={() => void apply(false)}
                  size="sm"
                  variant="outline"
                >
                  Tắt cho agent
                </Button>
              ) : null}
              <Button
                disabled={busy || selected.length === 0}
                onClick={() => void apply(true)}
                size="sm"
              >
                <Bot />
                Bật cho agent
              </Button>
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAppDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState("");
  const [webUrl, setWebUrl] = React.useState("");
  const [mcp, setMcp] = React.useState("");
  const [skillDir, setSkillDir] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const trimmed = mcp.trim();
      const isUrl = /^https?:\/\//i.test(trimmed);
      const [command, ...args] = trimmed.split(/\s+/).filter(Boolean);
      await addCustomApp({
        name,
        webUrl: webUrl.trim() || undefined,
        mcpUrl: isUrl ? trimmed : undefined,
        mcpCommand: !isUrl && command ? command : undefined,
        mcpArgs: !isUrl ? args : [],
        skillDir: skillDir.trim() || undefined,
      });
      toast.success(`Đã thêm ${name}`);
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm app</DialogTitle>
          <DialogDescription>
            Website để mở trong Browser, và/hoặc MCP server / skill cho agent.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex flex-col gap-1">
            <label htmlFor="add-app-name">Tên</label>
            <Input
              id="add-app-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Kling, Runway, Notion…"
              value={name}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-app-web">Website</label>
            <Input
              id="add-app-web"
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="https://…"
              value={webUrl}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-app-mcp">MCP server (URL hoặc lệnh)</label>
            <Input
              id="add-app-mcp"
              onChange={(e) => setMcp(e.target.value)}
              placeholder="https://…/mcp  hoặc  npx -y some-mcp"
              value={mcp}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-app-skill">Thư mục skill (có SKILL.md)</label>
            <Input
              id="add-app-skill"
              onChange={(e) => setSkillDir(e.target.value)}
              placeholder="C:\\…\\skills\\my-skill"
              value={skillDir}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="ghost">
            Huỷ
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void submit()}>
            Thêm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppTile({
  app,
  targets,
  onDetails,
}: {
  app: HubApp;
  targets: AgentTarget[];
  onDetails: () => void;
}) {
  return (
    <div className="group flex min-w-0 flex-col gap-2 rounded-xl border border-border/60 bg-background p-3 transition-colors hover:border-border hover:bg-muted/30">
      <button
        className="flex min-w-0 items-start gap-2.5 text-left"
        onClick={onDetails}
        type="button"
      >
        <AppIcon app={app} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium">{app.name}</span>
          <span className="line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">
            {app.description || hostOf(app.webUrl) || "MCP / skills"}
          </span>
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
        {app.mcp.length > 0 ? (
          <span className="rounded bg-muted/60 px-1.5 py-0.5">
            MCP {app.mcp.length}
          </span>
        ) : null}
        {app.skills.length > 0 ? (
          <span className="rounded bg-muted/60 px-1.5 py-0.5">
            Skills {app.skills.length}
          </span>
        ) : null}
        <AgentBadges app={app} targets={targets} />
      </div>
      <div className="mt-auto flex gap-1.5">
        {app.webUrl ? (
          <Button
            className="h-7 flex-1 text-[12px]"
            onClick={() => openApp(app)}
            size="sm"
            variant="secondary"
          >
            <ExternalLink />
            Mở
          </Button>
        ) : null}
        {isAgentCapable(app) ? (
          <Button
            className="h-7 flex-1 text-[12px]"
            onClick={onDetails}
            size="sm"
            variant={app.enabledTargets.length > 0 ? "outline" : "secondary"}
          >
            <Bot />
            Agent
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Workbench pane: launch apps in the Browser pane and switch their MCP / skills on for agents. */
export function AppsPane() {
  const { snapshot, loading, error } = useApps();
  const [scope, setScope] = React.useState<"added" | "discover">("added");
  const [query, setQuery] = React.useState("");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const apps = snapshot?.apps ?? [];
  const targets = snapshot?.targets ?? [];
  const shown = filterApps(apps, query, scope);
  const detail = apps.find((app) => app.id === detailId) ?? null;
  const addedCount = apps.filter((app) => app.added).length;

  React.useEffect(() => {
    if (snapshot && addedCount === 0) setScope("discover");
  }, [snapshot, addedCount]);

  return (
    <>
      <PaneHeader
        actions={
          <>
            <Button
              aria-label="Thêm app"
              className={PANE_ICON_BUTTON_CLASS}
              onClick={() => setAdding(true)}
              size="icon"
              variant="ghost"
            >
              <Plus />
            </Button>
            <Button
              aria-label="Làm mới danh sách"
              className={PANE_ICON_BUTTON_CLASS}
              onClick={() => void refreshApps()}
              size="icon"
              variant="ghost"
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          </>
        }
        menu={
          <DropdownMenuItem
            onSelect={() =>
              void restartAgents().then(
                (count) =>
                  toast.success(
                    `Đã khởi động lại ${count} tiến trình agent. Tin nhắn tới sẽ dùng cấu hình mới.`,
                  ),
                (reason) => toast.error(errorText(reason)),
              )
            }
          >
            <RotateCcw />
            Khởi động lại agent
          </DropdownMenuItem>
        }
        paneId="apps"
        title="Apps"
      >
        <LayoutGrid className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-medium">Apps</span>
        <div className="ml-2 flex items-center rounded-md bg-muted/50 p-0.5 text-[12px]">
          {(
            [
              ["added", `Đã thêm (${addedCount})`],
              ["discover", "Khám phá"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={cn(
                "rounded px-2 py-0.5",
                scope === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => setScope(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </PaneHeader>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-md bg-muted/50 px-2.5 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label="Tìm app"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm app, MCP, skill…"
            value={query}
          />
        </label>
        <Button
          className="h-8 text-[12px]"
          onClick={() =>
            void restartAgents().then(
              (count) =>
                toast.success(`Đã khởi động lại ${count} tiến trình agent.`),
              (reason) => toast.error(errorText(reason)),
            )
          }
          size="sm"
          variant="outline"
        >
          <RotateCcw />
          Khởi động lại agent
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="text-[12.5px] text-destructive">{error}</p>
        ) : null}
        {!snapshot && loading ? (
          <p className="text-[12.5px] text-muted-foreground">Đang quét…</p>
        ) : null}
        {snapshot && shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-[12.5px] text-muted-foreground">
            <LayoutGrid className="size-6 opacity-60" />
            {scope === "added"
              ? "Chưa thêm app nào. Mở tab Khám phá hoặc bấm +."
              : "Không có app khớp."}
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
          {shown.map((app) => (
            <AppTile
              app={app}
              key={app.id}
              onDetails={() => setDetailId(app.id)}
              targets={targets}
            />
          ))}
        </div>
      </div>
      {detail ? (
        <AppDetailDialog
          app={detail}
          key={detail.id}
          onClose={() => setDetailId(null)}
          targets={targets}
        />
      ) : null}
      {adding ? <AddAppDialog onClose={() => setAdding(false)} /> : null}
    </>
  );
}
