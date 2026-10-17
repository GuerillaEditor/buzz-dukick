import type { TerminalFrameMessage } from "./terminalClient";

export function terminalFrameToText(frame: TerminalFrameMessage | undefined) {
  if (!frame) return "";
  return frame.rows
    .slice()
    .sort((a, b) => a.line - b.line)
    .map((row) =>
      row.spans
        .slice()
        .sort(
          (a, b) => (a.clusters[0]?.column ?? 0) - (b.clusters[0]?.column ?? 0),
        )
        .flatMap((span) => span.clusters.map((cluster) => cluster.text))
        .join(""),
    )
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
}
