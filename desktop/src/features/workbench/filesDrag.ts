export const WORKBENCH_FILE_DRAG_TYPE = "application/x-buzz-workbench-file";

export type WorkbenchFileDragPayload = {
  path: string;
  name: string;
  mime: string;
};

export type WorkbenchFileReadResult = {
  name: string;
  mime: string;
  base64: string;
  size: number;
};

type WorkbenchDropData = {
  files: ArrayLike<File>;
  types: readonly string[];
  getData(type: string): string;
};

export function encodeWorkbenchFileDrag(
  payload: WorkbenchFileDragPayload,
): string {
  return JSON.stringify(payload);
}

function parseWorkbenchFileDrag(
  dataTransfer: WorkbenchDropData,
): WorkbenchFileDragPayload | null {
  if (!dataTransfer.types.includes(WORKBENCH_FILE_DRAG_TYPE)) return null;
  try {
    const parsed = JSON.parse(
      dataTransfer.getData(WORKBENCH_FILE_DRAG_TYPE),
    ) as Partial<WorkbenchFileDragPayload>;
    if (
      typeof parsed.path !== "string" ||
      parsed.path.length === 0 ||
      typeof parsed.name !== "string" ||
      parsed.name.length === 0 ||
      typeof parsed.mime !== "string"
    ) {
      return null;
    }
    return { path: parsed.path, name: parsed.name, mime: parsed.mime };
  } catch {
    return null;
  }
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

export async function resolveDroppedFiles(
  dataTransfer: WorkbenchDropData,
  readFile: (path: string) => Promise<WorkbenchFileReadResult>,
): Promise<File[]> {
  const nativeFiles = Array.from(dataTransfer.files);
  if (nativeFiles.length > 0) return nativeFiles;

  const payload = parseWorkbenchFileDrag(dataTransfer);
  if (!payload) return [];
  const result = await readFile(payload.path);
  const bytes = decodeBase64(result.base64);
  if (bytes.byteLength !== result.size) {
    throw new Error("workbench file size mismatch");
  }
  return [
    new File([bytes], result.name || payload.name, {
      type: result.mime || payload.mime,
    }),
  ];
}
