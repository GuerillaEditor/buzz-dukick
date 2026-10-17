import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Globe, SquareTerminal } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  setTerminalPanelMode,
  useTerminalPanel,
} from "../terminal/terminalPanelStore";
import { BrowserPane, useBrowserEvents } from "./BrowserPane";
import { FilesPane } from "./FilesPane";
import {
  clampWorkbenchWidth,
  closePane,
  getPaneLayout,
  openPane,
  type PaneId,
  resizePanePair,
  setWorkbenchWidth,
  togglePane,
  usePaneLayout,
  WORKBENCH_DEFAULT_WIDTH,
} from "./paneLayoutStore";

/** Fired whenever the Terminal pane's portal host mounts or unmounts. */
export const TERMINAL_HOST_EVENT = "buzz-dukick:terminal-host";

const PANE_TOGGLES: ReadonlyArray<{
  id: PaneId;
  label: string;
  shortcut: string;
  Icon: typeof Globe;
}> = [
  {
    id: "terminal",
    label: "Terminal",
    shortcut: "Ctrl+J",
    Icon: SquareTerminal,
  },
  { id: "browser", label: "Browser", shortcut: "Ctrl+Shift+B", Icon: Globe },
  { id: "files", label: "Files", shortcut: "Ctrl+Shift+E", Icon: FolderOpen },
];

function useAgentActivity() {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    if (!isTauri()) return;
    let timeout: number | undefined;
    const unlisten = listen("workbench-agent-activity", () => {
      setActive(true);
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setActive(false), 1500);
    });
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      void unlisten.then((stop) => stop());
    };
  }, []);
  return active;
}

/** Top-right pane toggles, like the Claude desktop app's header icons. */
export function WorkbenchToggles() {
  const layout = usePaneLayout();
  const agentActive = useAgentActivity();

  return (
    <div className="flex items-center gap-0.5" data-testid="workbench-toggles">
      {agentActive ? (
        <span
          className="mr-1 size-1.5 animate-pulse rounded-full bg-primary"
          role="status"
          title="Agent using workbench"
        />
      ) : null}
      {PANE_TOGGLES.map(({ id, label, shortcut, Icon }) => {
        const open = layout.open.includes(id);
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                aria-label={`${open ? "Hide" : "Show"} ${label}`}
                aria-pressed={open}
                className={cn(
                  "h-[28px] w-[28px] rounded-[6px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[16px]",
                  open && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                onClick={() => togglePane(id)}
                size="icon"
                variant="ghost"
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {label} <span className="opacity-60">{shortcut}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function TerminalPane() {
  const hostRef = React.useCallback((_node: HTMLDivElement | null) => {
    window.dispatchEvent(new Event(TERMINAL_HOST_EVENT));
  }, []);
  return (
    <div
      className="buzz-workbench-terminal-host"
      data-terminal-dock
      id="buzz-terminal-dock-host"
      ref={hostRef}
    />
  );
}

function PaneBody({ id }: { id: PaneId }) {
  if (id === "browser") return <BrowserPane />;
  if (id === "files") return <FilesPane />;
  return <TerminalPane />;
}

function useWorkbenchShortcuts() {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey)
        return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        togglePane("browser");
      } else if (key === "e") {
        event.preventDefault();
        togglePane("files");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Keep the Terminal pane and Buzz's terminal panel mode in step. */
function useTerminalPaneSync() {
  const terminal = useTerminalPanel();
  const previousModeRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = terminal.mode;
    if (previous === null) {
      // First render: restore a terminal pane persisted from last session.
      if (getPaneLayout().open.includes("terminal")) {
        setTerminalPanelMode("docked");
      } else if (terminal.mode !== "closed") {
        openPane("terminal");
      }
      return;
    }
    if (previous === terminal.mode) return;
    if (terminal.mode === "closed") closePane("terminal");
    else openPane("terminal");
  }, [terminal.mode]);
}

function PaneSplitter({ upper, lower }: { upper: PaneId; lower: PaneId }) {
  return (
    <div
      aria-hidden
      className="group relative z-10 -my-1 h-2 shrink-0 cursor-row-resize"
      onPointerDown={(event) => {
        const column = event.currentTarget.parentElement;
        if (!column) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const height = column.getBoundingClientRect().height || 1;
        let lastY = event.clientY;
        const move = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientY - lastY;
          lastY = moveEvent.clientY;
          resizePanePair(upper, lower, delta / (height / 2));
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      }}
    >
      <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary/0 transition-colors group-hover:bg-primary/50" />
    </div>
  );
}

function WidthSplitter({ width }: { width: number }) {
  return (
    <div
      aria-hidden
      className="group relative z-10 -mr-1 w-2 shrink-0 cursor-col-resize"
      onDoubleClick={() => setWorkbenchWidth(WORKBENCH_DEFAULT_WIDTH)}
      onPointerDown={(event) => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = width;
        const move = (moveEvent: PointerEvent) => {
          setWorkbenchWidth(
            clampWorkbenchWidth(
              startWidth + (startX - moveEvent.clientX),
              window.innerWidth,
            ),
          );
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      }}
    >
      <div className="absolute inset-y-6 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-primary/0 transition-colors group-hover:bg-primary/50" />
    </div>
  );
}

function useWindowWidth() {
  const [width, setWidth] = React.useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const PANE_CARD_CLASS =
  "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge";

/**
 * Right-hand workbench column: Browser · Terminal · Files panes stacked as
 * resizable cards beside the chat surface (Claude desktop style).
 */
export function WorkbenchPanes() {
  const layout = usePaneLayout();
  const windowWidth = useWindowWidth();
  useWorkbenchShortcuts();
  useTerminalPaneSync();
  useBrowserEvents();

  if (layout.open.length === 0) return null;
  const width = clampWorkbenchWidth(layout.width, windowWidth);
  const maximized = layout.maximized;
  const visible = maximized ? [maximized] : layout.open;

  return (
    <aside
      aria-label="Workbench"
      className={cn(
        "flex min-h-0 shrink-0",
        maximized
          ? "absolute inset-0 z-40 bg-sidebar pb-2 pl-2 pr-2 pt-px"
          : "relative pb-2 pr-2 pt-px",
      )}
      data-testid="workbench-panes"
      style={maximized ? undefined : { width }}
    >
      {maximized ? null : <WidthSplitter width={width} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {visible.map((id, index) => (
          <React.Fragment key={id}>
            {index > 0 && !maximized ? (
              <PaneSplitter lower={id} upper={visible[index - 1]} />
            ) : null}
            <section
              aria-label={`${id} pane`}
              className={PANE_CARD_CLASS}
              data-workbench-pane={id}
              style={{ flex: `${maximized ? 1 : layout.weights[id]} 1 0%` }}
            >
              <PaneBody id={id} />
            </section>
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}
