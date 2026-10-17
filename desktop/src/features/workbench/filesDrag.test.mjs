import assert from "node:assert/strict";
import test from "node:test";

test("workbench drag payload reads backend bytes into the original File", async () => {
  const {
    WORKBENCH_FILE_DRAG_TYPE,
    encodeWorkbenchFileDrag,
    resolveDroppedFiles,
  } = await import("./filesDrag.ts");
  const payload = encodeWorkbenchFileDrag({
    name: "shot.mp4",
    path: "C:\\AIWorkstation\\projects\\shot.mp4",
    mime: "video/mp4",
  });
  const calls = [];
  const files = await resolveDroppedFiles(
    {
      files: [],
      types: [WORKBENCH_FILE_DRAG_TYPE],
      getData(type) {
        return type === WORKBENCH_FILE_DRAG_TYPE ? payload : "";
      },
    },
    async (path) => {
      calls.push(path);
      return {
        name: "shot.mp4",
        mime: "video/mp4",
        base64: "aGVsbG8=",
        size: 5,
      };
    },
  );

  assert.deepEqual(calls, ["C:\\AIWorkstation\\projects\\shot.mp4"]);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "shot.mp4");
  assert.equal(files[0].type, "video/mp4");
  assert.equal(files[0].size, 5);
  assert.equal(await files[0].text(), "hello");
});

test("native file drop stays unchanged and never calls the workbench reader", async () => {
  const { resolveDroppedFiles } = await import("./filesDrag.ts");
  const native = new File(["native"], "native.txt", { type: "text/plain" });
  let readCount = 0;
  const files = await resolveDroppedFiles(
    {
      files: [native],
      types: ["Files"],
      getData() {
        return "";
      },
    },
    async () => {
      readCount += 1;
      throw new Error("must not read through Tauri");
    },
  );

  assert.equal(readCount, 0);
  assert.equal(files.length, 1);
  assert.equal(files[0], native);
});

test("invalid workbench drag JSON is ignored", async () => {
  const { WORKBENCH_FILE_DRAG_TYPE, resolveDroppedFiles } = await import(
    "./filesDrag.ts"
  );
  const files = await resolveDroppedFiles(
    {
      files: [],
      types: [WORKBENCH_FILE_DRAG_TYPE],
      getData() {
        return "{bad";
      },
    },
    async () => {
      throw new Error("must not read malformed payload");
    },
  );
  assert.deepEqual(files, []);
});

test("workbench drag rejects a backend size mismatch", async () => {
  const {
    WORKBENCH_FILE_DRAG_TYPE,
    encodeWorkbenchFileDrag,
    resolveDroppedFiles,
  } = await import("./filesDrag.ts");
  const payload = encodeWorkbenchFileDrag({
    name: "clip.mp4",
    path: "C:\\AIWorkstation\\projects\\clip.mp4",
    mime: "video/mp4",
  });
  await assert.rejects(
    resolveDroppedFiles(
      {
        files: [],
        types: [WORKBENCH_FILE_DRAG_TYPE],
        getData: () => payload,
      },
      async () => ({
        name: "clip.mp4",
        mime: "video/mp4",
        base64: "aGVsbG8=",
        size: 99,
      }),
    ),
    /size mismatch/,
  );
});
