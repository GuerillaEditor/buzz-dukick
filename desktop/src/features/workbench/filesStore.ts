export type WorkbenchFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mime: string | null;
};

type BackendFileEntry = Omit<WorkbenchFileEntry, "isDir"> & {
  isDir?: boolean;
  isDirectory?: boolean;
};

type BackendFileRoot = string | { name: string; path: string };

export type WorkbenchFilePreview = {
  name: string;
  path: string;
  mime: string;
  kind: "text" | "markdown" | "image" | "video" | "unsupported";
  text?: string;
  base64?: string;
  size: number;
};

export type FilesState = {
  roots: string[];
  currentPath: string | null;
  entries: WorkbenchFileEntry[];
  preview: WorkbenchFilePreview | null;
};

export function createFilesState(roots: string[] = []): FilesState {
  return { roots, currentPath: null, entries: [], preview: null };
}

export function normalizeFileRoots(roots: BackendFileRoot[]): string[] {
  return roots.map((root) => (typeof root === "string" ? root : root.path));
}

export function normalizeFileEntries(
  entries: BackendFileEntry[],
): WorkbenchFileEntry[] {
  return entries.map(({ isDirectory, ...entry }) => ({
    ...entry,
    isDir: entry.isDir ?? isDirectory ?? false,
  }));
}

export function parentWithinRoots(
  currentPath: string,
  roots: string[],
): string | null {
  const normalized = currentPath.replace(/[\\/]+$/, "");
  const separator = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/"),
  );
  if (separator <= 2) return null;
  const parent = normalized.slice(0, separator);
  const comparableParent = parent.replaceAll("/", "\\").toLowerCase();
  return roots.some((root) => {
    const comparableRoot = root
      .replace(/[\\/]+$/, "")
      .replaceAll("/", "\\")
      .toLowerCase();
    return (
      comparableParent === comparableRoot ||
      comparableParent.startsWith(`${comparableRoot}\\`)
    );
  })
    ? parent
    : null;
}

export function openFilesPath(
  state: FilesState,
  currentPath: string,
  entries: WorkbenchFileEntry[],
): FilesState {
  return { ...state, currentPath, entries, preview: null };
}

export function setFilesPreview(
  state: FilesState,
  preview: WorkbenchFilePreview,
): FilesState {
  return { ...state, preview };
}

export function previewDataUrl(preview: WorkbenchFilePreview): string | null {
  if (
    (preview.kind !== "image" && preview.kind !== "video") ||
    !preview.base64
  ) {
    return null;
  }
  return `data:${preview.mime};base64,${preview.base64}`;
}

export function previewText(preview: WorkbenchFilePreview): string | null {
  return preview.kind === "text" || preview.kind === "markdown"
    ? (preview.text ?? "")
    : null;
}
