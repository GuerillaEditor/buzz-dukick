import assert from "node:assert/strict";
import test from "node:test";

test("files state opens a root and navigates into a directory without write actions", async () => {
  const { createFilesState, openFilesPath } = await import("./filesStore.ts");
  const initial = createFilesState([
    "C:\\AIWorkstation\\projects",
    "C:\\AIWorkstation\\buzz_agents\\codex_media",
  ]);
  const opened = openFilesPath(initial, "C:\\AIWorkstation\\projects", [
    {
      name: "episode-01",
      path: "C:\\AIWorkstation\\projects\\episode-01",
      isDir: true,
      size: 0,
      mime: null,
    },
  ]);

  assert.equal(opened.currentPath, "C:\\AIWorkstation\\projects");
  assert.equal(opened.entries[0].name, "episode-01");
  assert.deepEqual(Object.keys(opened).sort(), [
    "currentPath",
    "entries",
    "preview",
    "roots",
  ]);
});

test("preview helpers produce safe media data URLs and leave text as text", async () => {
  const { previewDataUrl, previewText } = await import("./filesStore.ts");
  assert.equal(
    previewDataUrl({
      name: "clip.mp4",
      path: "C:\\allowed\\clip.mp4",
      mime: "video/mp4",
      kind: "video",
      base64: "AAEC",
      size: 3,
    }),
    "data:video/mp4;base64,AAEC",
  );
  assert.equal(
    previewText({
      name: "notes.md",
      path: "C:\\allowed\\notes.md",
      mime: "text/markdown",
      kind: "markdown",
      text: "# Notes",
      size: 7,
    }),
    "# Notes",
  );
  assert.equal(
    previewDataUrl({
      name: "notes.md",
      path: "C:\\allowed\\notes.md",
      mime: "text/markdown",
      kind: "markdown",
      text: "# Notes",
      size: 7,
    }),
    null,
  );
});

test("backend root and directory field names normalize to the UI contract", async () => {
  const { normalizeFileEntries, normalizeFileRoots } = await import(
    "./filesStore.ts"
  );
  assert.deepEqual(
    normalizeFileRoots([
      { name: "projects", path: "C:\\AIWorkstation\\projects" },
      "C:\\AIWorkstation\\buzz_agents\\codex_media",
    ]),
    [
      "C:\\AIWorkstation\\projects",
      "C:\\AIWorkstation\\buzz_agents\\codex_media",
    ],
  );
  assert.deepEqual(
    normalizeFileEntries([
      {
        name: "episode-01",
        path: "C:\\AIWorkstation\\projects\\episode-01",
        isDirectory: true,
        size: 0,
        mime: null,
      },
    ]),
    [
      {
        name: "episode-01",
        path: "C:\\AIWorkstation\\projects\\episode-01",
        isDir: true,
        size: 0,
        mime: null,
      },
    ],
  );
});

test("up navigation stops at an allowed root", async () => {
  const { parentWithinRoots } = await import("./filesStore.ts");
  const roots = ["C:\\AIWorkstation\\projects"];
  assert.equal(
    parentWithinRoots("C:\\AIWorkstation\\projects\\episode-01", roots),
    "C:\\AIWorkstation\\projects",
  );
  assert.equal(parentWithinRoots("C:\\AIWorkstation\\projects", roots), null);
});

test("tree filter keeps matches and their ancestor folders", async () => {
  const { visiblePathsForFilter, codeLanguageForPath, formatFileSize } =
    await import("./filesStore.ts");
  const dir = (name, path) => ({
    name,
    path,
    isDir: true,
    size: 0,
    mime: null,
  });
  const file = (name, path) => ({
    name,
    path,
    isDir: false,
    size: 1,
    mime: null,
  });
  const children = new Map([
    [
      "C:\\p",
      [dir("shots", "C:\\p\\shots"), file("notes.md", "C:\\p\\notes.md")],
    ],
    ["C:\\p\\shots", [file("hero.mp4", "C:\\p\\shots\\hero.mp4")]],
  ]);
  assert.equal(visiblePathsForFilter(children, "C:\\p", " "), null);
  const visible = visiblePathsForFilter(children, "C:\\p", "HERO");
  assert.deepEqual([...visible].sort(), [
    "C:\\p\\shots",
    "C:\\p\\shots\\hero.mp4",
  ]);
  assert.equal(codeLanguageForPath("C:\\x\\run.ps1"), "powershell");
  assert.equal(codeLanguageForPath("C:\\x\\notes.md"), null);
  assert.equal(formatFileSize(2048), "2.0 KB");
});
