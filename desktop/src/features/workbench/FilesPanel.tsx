import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { encodeWorkbenchFileDrag, WORKBENCH_FILE_DRAG_TYPE } from "./filesDrag";
import {
  createFilesState,
  normalizeFileEntries,
  normalizeFileRoots,
  openFilesPath,
  parentWithinRoots,
  previewDataUrl,
  previewText,
  setFilesPreview,
  type WorkbenchFileEntry,
  type WorkbenchFilePreview,
} from "./filesStore";

export function FilesPanel() {
  const [state, setState] = React.useState(() => createFilesState());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const openDirectory = React.useCallback(async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const entries = await invoke<
        Array<WorkbenchFileEntry & { isDirectory?: boolean }>
      >("workbench_files_list", { path });
      setState((current) =>
        openFilesPath(current, path, normalizeFileEntries(entries)),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void invoke<Array<string | { name: string; path: string }>>(
      "workbench_files_roots",
    )
      .then((roots) => {
        if (!cancelled && Array.isArray(roots)) {
          setState(createFilesState(normalizeFileRoots(roots)));
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewFile = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const preview = await invoke<WorkbenchFilePreview>(
        "workbench_files_preview",
        { path },
      );
      setState((current) => setFilesPreview(current, preview));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const mediaSource = state.preview ? previewDataUrl(state.preview) : null;
  const text = state.preview ? previewText(state.preview) : null;
  const parent = state.currentPath
    ? parentWithinRoots(state.currentPath, state.roots)
    : null;

  return (
    <section aria-label="Files panel" className="buzz-workbench-files">
      <header className="buzz-workbench-files-header">
        <strong>Read-only files</strong>
        {state.currentPath ? (
          <button
            disabled={!parent || busy}
            onClick={() => parent && void openDirectory(parent)}
            type="button"
          >
            Up
          </button>
        ) : null}
      </header>
      <nav aria-label="Allowed file roots" className="buzz-workbench-roots">
        {state.roots.map((root) => (
          <button
            key={root}
            disabled={busy}
            onClick={() => void openDirectory(root)}
            type="button"
          >
            {root}
          </button>
        ))}
      </nav>
      {state.currentPath ? (
        <p className="buzz-workbench-files-path">{state.currentPath}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul aria-label="Directory entries" className="buzz-workbench-file-list">
        {state.entries.map((entry) => (
          <li key={entry.path}>
            <button
              draggable={!entry.isDir}
              onClick={() =>
                entry.isDir
                  ? void openDirectory(entry.path)
                  : void previewFile(entry.path)
              }
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
              }}
              type="button"
            >
              <span aria-hidden="true">{entry.isDir ? "📁" : "📄"}</span>{" "}
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
      {state.preview ? (
        <section aria-label="File preview" className="buzz-workbench-preview">
          <header>
            <strong>{state.preview.name}</strong>
            <button
              onClick={() =>
                void invoke("workbench_files_reveal", {
                  path: state.preview?.path,
                }).catch((cause) => setError(String(cause)))
              }
              type="button"
            >
              Open in Explorer
            </button>
          </header>
          {state.preview.kind === "image" && mediaSource ? (
            <img alt={state.preview.name} src={mediaSource} />
          ) : null}
          {state.preview.kind === "video" && mediaSource ? (
            <video controls preload="metadata" src={mediaSource}>
              <track kind="captions" />
            </video>
          ) : null}
          {text !== null ? <pre>{text}</pre> : null}
          {state.preview.kind === "unsupported" ? (
            <p>Preview is not available for this file type.</p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
