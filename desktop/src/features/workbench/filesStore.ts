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
  kind: "text" | "markdown" | "image" | "video" | "audio" | "unsupported";
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

export type WorkbenchFileRoot = { name: string; path: string };

export function normalizeFileRootEntries(
  roots: BackendFileRoot[],
): WorkbenchFileRoot[] {
  return roots.map((root) =>
    typeof root === "string"
      ? { name: root.split(/[\\/]/).filter(Boolean).at(-1) ?? root, path: root }
      : root,
  );
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
    (preview.kind !== "image" &&
      preview.kind !== "video" &&
      preview.kind !== "audio") ||
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

const CODE_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonl: "json",
  rs: "rust",
  py: "python",
  ps1: "powershell",
  psm1: "powershell",
  sh: "bash",
  bat: "bat",
  cmd: "bat",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  vue: "vue",
  svelte: "svelte",
  ini: "ini",
};

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Shiki language for a code file, or null for prose / plain text. */
export function codeLanguageForPath(path: string): string | null {
  return CODE_LANGUAGES[fileExtension(path)] ?? null;
}

export function isMarkdownPath(path: string): boolean {
  return ["md", "markdown"].includes(fileExtension(path));
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Paths whose rows stay visible for a name filter: every loaded entry whose
 * name matches, plus all of its ancestors so the tree keeps its shape.
 */
export function visiblePathsForFilter(
  children: ReadonlyMap<string, readonly WorkbenchFileEntry[]>,
  rootPath: string,
  filter: string,
): Set<string> | null {
  const needle = filter.trim().toLowerCase();
  if (!needle) return null;
  const visible = new Set<string>();
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 32) return false;
    let any = false;
    for (const entry of children.get(dir) ?? []) {
      const childMatch = entry.isDir ? walk(entry.path, depth + 1) : false;
      if (childMatch || entry.name.toLowerCase().includes(needle)) {
        visible.add(entry.path);
        any = true;
      }
    }
    return any;
  };
  walk(rootPath, 0);
  return visible;
}
