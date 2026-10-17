import type * as React from "react";
import { Maximize2, Minimize2, MoreVertical, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  closePane,
  type PaneId,
  togglePaneMaximized,
  usePaneLayout,
} from "./paneLayoutStore";

export const PANE_ICON_BUTTON_CLASS =
  "h-7 w-7 rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground [&_svg]:size-[15px]";

/** Header row shared by every workbench pane: content left, window actions right. */
export function PaneHeader({
  paneId,
  title,
  children,
  actions,
  menu,
  className,
}: {
  paneId: PaneId;
  title: string;
  /** Tabs or other header content; defaults to the pane title. */
  children?: React.ReactNode;
  /** Extra icon buttons shown before the ⋮ menu. */
  actions?: React.ReactNode;
  /** Extra dropdown items placed above the standard window items. */
  menu?: React.ReactNode;
  className?: string;
}) {
  const layout = usePaneLayout();
  const maximized = layout.maximized === paneId;

  return (
    <header
      className={cn(
        "flex h-10 shrink-0 select-none items-center gap-1 border-b border-border/60 pl-3 pr-1.5",
        className,
      )}
      data-workbench-pane-header={paneId}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {children ?? (
          <span className="truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`${title} options`}
              className={PANE_ICON_BUTTON_CLASS}
              size="icon"
              variant="ghost"
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {menu}
            {menu ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => togglePaneMaximized(paneId)}>
              {maximized ? <Minimize2 /> : <Maximize2 />}
              {maximized ? "Restore" : "Maximize"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => closePane(paneId)}>
              <X />
              Close {title}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}
          className={PANE_ICON_BUTTON_CLASS}
          onClick={() => togglePaneMaximized(paneId)}
          size="icon"
          variant="ghost"
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          aria-label={`Close ${title}`}
          className={PANE_ICON_BUTTON_CLASS}
          onClick={() => closePane(paneId)}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
    </header>
  );
}
