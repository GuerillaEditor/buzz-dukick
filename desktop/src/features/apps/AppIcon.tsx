import * as React from "react";

import type { HubApp } from "./appsStore";

export function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function AppIcon({ app, size = 36 }: { app: HubApp; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  const host = hostOf(app.webUrl);
  const src =
    app.icon ??
    (host
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
      : null);
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-[13px] font-semibold uppercase text-muted-foreground"
      style={{ height: size, width: size }}
    >
      {src && !failed ? (
        <img
          alt=""
          className="h-[70%] w-[70%] object-contain"
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        app.name.slice(0, 2)
      )}
    </div>
  );
}
