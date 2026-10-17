import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderSearch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Markdown, SyntaxHighlightedCode } from "@/shared/ui/markdown";
import { encodeWorkbenchFileDrag, WORKBENCH_FILE_DRAG_TYPE } from "./filesDrag";
import {
  codeLanguageForPath,
  fileExtension,
  formatFileSize,
  isMarkdownPath,
  normalizeFileEntries,
  normalizeFileRootEntries,
  previewDataUrl,
  visiblePathsForFilter,
  type WorkbenchFileEntry,
  type WorkbenchFilePreview,
  type WorkbenchFileRoot,
} from "./filesStore";
import { PANE_ICON_BUTTON_CLASS, PaneHeader } from "./PaneHeader";

const ROOT_STORAGE_KEY = "buzz-dukick.files-root";
const MAX_ROWS_PER_DIR = 2000;
const MAX_OPEN_FILES = 8;

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "avif",
]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac"]);
const TEXT_EXT = new Set(["md", "markdown", "txt", "log", "csv", "srt", "vtt"]);

function FileIcon({
  entry,
  open,
}: {
  entry: WorkbenchFileEntry;
  open?: boolean;
}) {
  const className = "size-4 shrink-0";
  if (entry.isDir) {
    return open ? (
      <FolderOpen className={cn(className, "text-sky-500/90")} />
    ) : (
      <Folder className={cn(className, "text-sky-500/90")} />
    );
  }
  const ext = fileExtension(entry.path);
  if (IMAGE_EXT.has(ext))
    return <FileImage className={cn(className, "text-emerald-500/90")} />;
  if (VIDEO_EXT.has(ext))
    return <FileVideo className={cn(className, "text-violet-500/90")} />;
  if (AUDIO_EXT.has(ext))
    return <FileAudio className={cn(className, "text-amber-500/90")} />;
  if (TEXT_EXT.has(ext))
    return <FileText className={cn(className, "text-muted-foreground")} />;
  if (codeLanguageForPath(entry.path))
    return <FileCode className={cn(className, "text-orange-500/80")} />;
  return <File className={cn(className, "text-muted-foreground/80")} />;
}

function openFileExternally(path: string) {
  void invoke("workbench_files_open", { path }).catch((error) =>
    console.warn("open file failed", error),
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type OpenFile = {
  path: string;
  name: string;
  preview: WorkbenchFilePreview | null;
  error: string | null;
};

function PreviewBody({ file }: { file: OpenFile }) {
  if (file.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <File className="size-8 text-muted-foreground/60" />
        <p className="max-w-xs text-[13px] text-muted-foreground">
          {file.error}
        </p>
        <Button
          onClick={() => openFileExternally(file.path)}
          size="sm"
          variant="outline"
        >
          <ExternalLink />
          Open with default app
        </Button>
      </div>
    );
  }
  const preview = file.preview;
  if (!preview) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }
  const dataUrl = previewDataUrl(preview);
  if (preview.kind === "image" && dataUrl) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img
          alt={preview.name}
          className="max-h-full max-w-full object-contain"
          src={dataUrl}
        />
      </div>
    );
  }
  if (preview.kind === "video" && dataUrl) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: local preview of the user's own file */}
        <video className="max-h-full max-w-full" controls src={dataUrl} />
      </div>
    );
  }
  if (preview.kind === "audio" && dataUrl) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        {/* biome-ignore lint/a11y/useMediaCaption: local preview of the user's own file */}
        <audio className="w-full max-w-md" controls src={dataUrl} />
      </div>
    );
  }
  const text = preview.text ?? "";
  if (isMarkdownPath(preview.path)) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
        <Markdown content={text} />
      </div>
    );
  }
  const language = codeLanguageForPath(preview.path);
  if (language && text.length < 200_000) {
    return (
      <div className="min-h-0 flex-1 overflow-auto text-[12px] [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!bg-transparent [&_pre]:p-4">
        <pre>
          <SyntaxHighlightedCode code={text} language={language} />
        </pre>
      </div>
    );
  }
  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-5 text-foreground/90">
      {text}
    </pre>
  );
}

export function FilesPane() {
  const [roots, setRoots] = React.useState<WorkbenchFileRoot[]>([]);
  const [rootPath, setRootPath] = React.useState<string | null>(() => {
    try {
      return window.localStorage.getItem(ROOT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [children, setChildren] = React.useState<
    Map<string, WorkbenchFileEntry[]>
  >(() => new Map());
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [loadingDirs, setLoadingDirs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [dirErrors, setDirErrors] = React.useState<Map<string, string>>(
    () => new Map(),
  );
  const [filter, setFilter] = React.useState("");
  const [openFiles, setOpenFiles] = React.useState<OpenFile[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [narrow, setNarrow] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 460),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loadDir = React.useCallback(async (path: string) => {
    setLoadingDirs((current) => new Set(current).add(path));
    try {
      const raw = await invoke<Parameters<typeof normalizeFileEntries>[0]>(
        "workbench_files_list",
        { path },
      );
      setChildren((current) =>
        new Map(current).set(path, normalizeFileEntries(raw)),
      );
      setDirErrors((current) => {
        const next = new Map(current);
        next.delete(path);
        return next;
      });
    } catch (error) {
      setDirErrors((current) => new Map(current).set(path, errorText(error)));
    } finally {
      setLoadingDirs((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, []);

  React.useEffect(() => {
    void invoke<Parameters<typeof normalizeFileRootEntries>[0]>(
      "workbench_files_roots",
    )
      .then((raw) => {
        const list = normalizeFileRootEntries(raw);
        setRoots(list);
        setRootPath((current) =>
          current && list.some((root) => root.path === current)
            ? current
            : (list[0]?.path ?? null),
        );
      })
      .catch(() => setRoots([]));
  }, []);

  React.useEffect(() => {
    if (!rootPath) return;
    try {
      window.localStorage.setItem(ROOT_STORAGE_KEY, rootPath);
    } catch {
      // best effort
    }
    if (!children.has(rootPath)) void loadDir(rootPath);
  }, [children, loadDir, rootPath]);

  const toggleDir = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children.has(path)) void loadDir(path);
      }
      return next;
    });
  };

  const openFile = async (entry: WorkbenchFileEntry) => {
    setActivePath(entry.path);
    setOpenFiles((current) => {
      if (current.some((file) => file.path === entry.path)) return current;
      const next = [
        ...current,
        { path: entry.path, name: entry.name, preview: null, error: null },
      ];
      return next.slice(-MAX_OPEN_FILES);
    });
    try {
      const preview = await invoke<WorkbenchFilePreview>(
        "workbench_files_preview",
        {
          path: entry.path,
        },
      );
      setOpenFiles((current) =>
        current.map((file) =>
          file.path === entry.path ? { ...file, preview, error: null } : file,
        ),
      );
    } catch (error) {
      setOpenFiles((current) =>
        current.map((file) =>
          file.path === entry.path
            ? { ...file, error: errorText(error) }
            : file,
        ),
      );
    }
  };

  const closeFile = (path: string) => {
    setOpenFiles((current) => {
      const next = current.filter((file) => file.path !== path);
      if (activePath === path) setActivePath(next.at(-1)?.path ?? null);
      return next;
    });
  };

  const refresh = () => {
    const dirs = [rootPath, ...expanded].filter(Boolean) as string[];
    for (const dir of dirs) void loadDir(dir);
  };

  const visible = React.useMemo(
    () => (rootPath ? visiblePathsForFilter(children, rootPath, filter) : null),
    [children, filter, rootPath],
  );
  const activeFile = openFiles.find((file) => file.path === activePath) ?? null;

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const entries = children.get(dir);
    const error = dirErrors.get(dir);
    if (error) {
      return (
        <div
          className="truncate py-1 text-[12px] text-destructive/80"
          style={{ paddingLeft: 12 + depth * 14 }}
          title={error}
        >
          {error}
        </div>
      );
    }
    if (!entries) {
      return loadingDirs.has(dir) ? (
        <div
          className="py-1 text-[12px] text-muted-foreground"
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          Loading…
        </div>
      ) : null;
    }
    const shown = visible
      ? entries.filter((entry) => visible.has(entry.path))
      : entries;
    if (shown.length === 0 && depth === 0) {
      return (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          {visible ? "No loaded files match" : "Empty folder"}
        </div>
      );
    }
    return (
      <>
        {shown.slice(0, MAX_ROWS_PER_DIR).map((entry) => {
          const isOpen =
            entry.isDir && (expanded.has(entry.path) || Boolean(visible));
          const selected = entry.path === activePath;
          return (
            <React.Fragment key={entry.path}>
              <button
                className={cn(
                  "group flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px]",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/85 hover:bg-foreground/[0.05]",
                )}
                draggable={!entry.isDir}
                onClick={() =>
                  entry.isDir ? toggleDir(entry.path) : void openFile(entry)
                }
                onDoubleClick={() => {
                  if (!entry.isDir) openFileExternally(entry.path);
                }}
                onDragStart={(event) => {
                  if (entry.isDir) return;
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    WORKBENCH_FILE_DRAG_TYPE,
                    encodeWorkbenchFileDrag({
                      path: entry.path,
                      name: entry.name,
                      mime: entry.mime ?? "application/octet-stream",
                    }),
                  );
                  event.dataTransfer.setData("text/plain", entry.path);
                }}
                style={{ paddingLeft: 6 + depth * 14 }}
                title={entry.path}
                type="button"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    !entry.isDir && "invisible",
                    isOpen && "rotate-90",
                  )}
                />
                <FileIcon entry={entry} open={isOpen} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {!entry.isDir ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground/70 opacity-0 group-hover:opacity-100">
                    {formatFileSize(entry.size)}
                  </span>
                ) : null}
              </button>
              {isOpen ? renderDir(entry.path, depth + 1) : null}
            </React.Fragment>
          );
        })}
        {shown.length > MAX_ROWS_PER_DIR ? (
          <div
            className="py-1 text-[12px] text-muted-foreground"
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            … {shown.length - MAX_ROWS_PER_DIR} more
          </div>
        ) : null}
      </>
    );
  };

  return (
    <>
      <PaneHeader
        actions={
          <Button
            aria-label="Refresh files"
            className={PANE_ICON_BUTTON_CLASS}
            onClick={refresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw />
          </Button>
        }
        menu={
          <>
            <DropdownMenuItem
              disabled={!activeFile && !rootPath}
              onSelect={() => {
                const target = activeFile?.path ?? rootPath;
                if (target)
                  void invoke("workbench_files_reveal", { path: target });
              }}
            >
              <FolderSearch />
              Reveal in Explorer
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeFile}
              onSelect={() => {
                if (activeFile)
                  void navigator.clipboard.writeText(activeFile.path);
              }}
            >
              <Copy />
              Copy file path
            </DropdownMenuItem>
          </>
        }
        paneId="files"
        title="Files"
      />
      <div
        className={cn("flex min-h-0 flex-1", narrow ? "flex-col" : "flex-row")}
        ref={bodyRef}
      >
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col",
            narrow
              ? "h-1/2 border-b border-border/60"
              : "w-[42%] min-w-[220px] max-w-[420px] border-r border-border/60",
          )}
        >
          <div className="flex shrink-0 flex-col gap-1.5 p-2">
            <select
              aria-label="Files location"
              className="h-8 w-full cursor-pointer truncate rounded-md border border-border/60 bg-background px-2 text-[12.5px] outline-none hover:bg-muted/40"
              onChange={(event) => {
                setRootPath(event.target.value);
                setFilter("");
              }}
              value={rootPath ?? ""}
            >
              {roots.map((root) => (
                <option key={root.path} value={root.path}>
                  {root.name === root.path
                    ? root.path
                    : `${root.name} — ${root.path}`}
                </option>
              ))}
            </select>
            <label className="flex h-8 items-center gap-2 rounded-md bg-muted/50 px-2.5 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/40">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="Filter files"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter…"
                spellCheck={false}
                value={filter}
              />
              {filter ? (
                <button
                  aria-label="Clear filter"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setFilter("")}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" role="tree">
            {rootPath ? renderDir(rootPath, 0) : null}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {openFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="size-7 text-muted-foreground/50" />
              <p className="text-[13px] text-muted-foreground">
                Open files appear here
              </p>
              <p className="text-[11.5px] text-muted-foreground/70">
                Click to preview · double-click to open · drag into chat to
                attach
              </p>
            </div>
          ) : (
            <>
              <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-1.5 [scrollbar-width:none]">
                {openFiles.map((file) => {
                  const active = file.path === activePath;
                  return (
                    <div
                      className={cn(
                        "group flex h-7 min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-[12.5px]",
                        active
                          ? "bg-foreground/[0.07] text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04]",
                      )}
                      key={file.path}
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => setActivePath(file.path)}
                        onMouseDown={(event) => {
                          if (event.button === 1) {
                            event.preventDefault();
                            closeFile(file.path);
                          }
                        }}
                        title={file.path}
                        type="button"
                      >
                        {file.name}
                      </button>
                      <button
                        aria-label={`Close ${file.name}`}
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded hover:bg-foreground/10",
                          active
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                        onClick={() => closeFile(file.path)}
                        type="button"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {activeFile ? (
                <>
                  <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 pl-3 pr-1.5">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
                      title={activeFile.path}
                    >
                      {activeFile.path}
                      {activeFile.preview
                        ? ` · ${formatFileSize(activeFile.preview.size)}`
                        : ""}
                    </span>
                    <Button
                      aria-label="Copy path"
                      className={PANE_ICON_BUTTON_CLASS}
                      onClick={() =>
                        void navigator.clipboard.writeText(activeFile.path)
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Copy />
                    </Button>
                    <Button
                      aria-label="Reveal in Explorer"
                      className={PANE_ICON_BUTTON_CLASS}
                      onClick={() =>
                        void invoke("workbench_files_reveal", {
                          path: activeFile.path,
                        })
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <FolderSearch />
                    </Button>
                    <Button
                      aria-label="Open with default app"
                      className={PANE_ICON_BUTTON_CLASS}
                      onClick={() => openFileExternally(activeFile.path)}
                      size="icon"
                      variant="ghost"
                    >
                      <ExternalLink />
                    </Button>
                  </div>
                  <PreviewBody file={activeFile} />
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
