import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { createPortal } from "react-dom";

import {
  type TerminalDelivery,
  TerminalConnection,
  type TerminalFrameMessage,
  type TerminalMessage,
} from "./terminalClient";
import {
  TerminalSubstrate,
  type TerminalViewportSize,
} from "./TerminalSubstrate";
import {
  setTerminalPanelMode,
  setTerminalSessionChannels,
  toggleTerminalPanel,
  useTerminalPanel,
  requestTerminalAgentCommand,
} from "./terminalPanelStore";
import { terminalFrameToText } from "./terminalMcpBridge";
import {
  togglePaneMaximized,
  usePaneLayout,
} from "../workbench/paneLayoutStore";

/** Mirrors `TERMINAL_HOST_EVENT` in the workbench (kept here to avoid a cycle). */
const TERMINAL_HOST_EVENT = "buzz-dukick:terminal-host";

type TerminalContext = {
  channelId: string;
  channelName: string;
  threadId: string | null;
  npub: string;
  relayUrl: string;
};

type Session = {
  key: string;
  connection: TerminalConnection | null;
  delivery: TerminalDelivery | null;
  frame: TerminalFrameMessage | undefined;
  title: string;
  closing: boolean;
  context: TerminalContext;
  pendingCommand?: string;
  pendingRequestId?: string;
};

const INITIAL_SIZE: TerminalViewportSize = {
  columns: 80,
  rows: 24,
  pixelWidth: 672,
  pixelHeight: 408,
};

function report(error: unknown) {
  console.error("terminal session failed", error);
}

export function TerminalBootstrap({
  channelId,
  channelName,
  threadId,
  npub,
  relayUrl,
}: {
  channelId: string | null;
  channelName: string | null;
  threadId: string | null;
  npub: string | null;
  relayUrl: string | null;
}) {
  // Dukick: the Terminal pane works everywhere, not only inside a channel.
  // Outside a channel the shell simply gets no channel context variables.
  const context: TerminalContext = {
    channelId: channelId ?? "workbench",
    channelName: channelName ?? (channelId ? channelId : "Workbench"),
    threadId,
    npub: npub ?? "",
    relayUrl: relayUrl ?? "",
  };
  const contextRef = React.useRef<TerminalContext | null>(context);
  contextRef.current = context;
  const mountedRef = React.useRef(true);
  const sizeRef = React.useRef(INITIAL_SIZE);
  const resizeChainRef = React.useRef(Promise.resolve());
  const connectionSizesRef = React.useRef(
    new WeakMap<TerminalConnection, TerminalViewportSize>(),
  );
  const closedSessionKeysRef = React.useRef(new Set<string>());
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [available, setAvailable] = React.useState(() => isTauri());
  const [portalHost, setPortalHost] = React.useState<HTMLElement | null>(null);
  const panel = useTerminalPanel();
  const [, setRenderedMode] = React.useState<"docked" | "maximized">(
    panel.mode === "maximized" ? "maximized" : "docked",
  );
  const [panelVisible, setPanelVisible] = React.useState(
    panel.mode !== "closed",
  );
  const [panelMounted, setPanelMounted] = React.useState(
    panel.mode !== "closed",
  );
  const [splashPending, setSplashPending] = React.useState(true);
  const [viewportReportingEnabled, setViewportReportingEnabled] =
    React.useState(panel.mode !== "closed");
  const previousPanelModeRef = React.useRef(panel.mode);
  const acknowledgedSequenceRef = React.useRef(new Map<string, number>());
  const sessionsRef = React.useRef(sessions);
  sessionsRef.current = sessions;

  React.useLayoutEffect(() => {
    const update = () =>
      setPortalHost(document.getElementById("buzz-terminal-dock-host"));
    update();
    window.addEventListener(TERMINAL_HOST_EVENT, update);
    return () => window.removeEventListener(TERMINAL_HOST_EVENT, update);
  }, []);
  const paneLayout = usePaneLayout();

  React.useEffect(() => {
    const previousMode = previousPanelModeRef.current;
    if (previousMode === panel.mode) return;
    previousPanelModeRef.current = panel.mode;
    setViewportReportingEnabled(false);

    let firstFrame = 0;
    let secondFrame = 0;
    let timeout = 0;
    if (panel.mode !== "closed") {
      setRenderedMode(panel.mode);
      setPanelMounted(true);
      if (previousMode === "closed") {
        // Give the collapsed substrate a painted frame before expanding it.
        // A single rAF can still be batched into the mount commit by React.
        setPanelVisible(false);
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(() =>
            setPanelVisible(true),
          );
        });
      } else {
        setPanelVisible(true);
      }
      // Resizing the PTY through every animation frame causes shell reflow and
      // leaves transient filler rows in the scrollback. Publish only the final
      // settled viewport.
      timeout = window.setTimeout(() => setViewportReportingEnabled(true), 200);
    } else {
      setPanelVisible(false);
      timeout = window.setTimeout(() => setPanelMounted(false), 180);
    }
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
    };
  }, [panel.mode]);

  React.useEffect(() => {
    if (
      !isTauri() ||
      typeof (
        globalThis as { __TAURI_INTERNALS__?: { unregisterListener?: unknown } }
      ).__TAURI_INTERNALS__?.unregisterListener !== "function"
    )
      return;
    let disposed = false;
    const unlisten = listen<{ requestId?: string; command?: string }>(
      "workbench-mcp-terminal-run",
      (event) => {
        const command = event.payload?.command;
        const requestId = event.payload?.requestId;
        if (typeof command !== "string" || typeof requestId !== "string")
          return;
        requestTerminalAgentCommand(command, requestId);
      },
    );
    return () => {
      disposed = true;
      void unlisten.then((stop) => {
        if (!disposed || typeof stop !== "function") return;
        stop();
      });
    };
  }, []);

  React.useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (
        panel.mode !== "closed" ||
        event.code !== "KeyJ" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "keyup") toggleTerminalPanel();
    };
    window.addEventListener("keydown", toggle, true);
    window.addEventListener("keyup", toggle, true);
    return () => {
      window.removeEventListener("keydown", toggle, true);
      window.removeEventListener("keyup", toggle, true);
    };
  }, [panel.mode]);

  const fail = React.useCallback((error: unknown) => {
    report(error);
    setAvailable(false);
  }, []);

  const removeSession = React.useCallback((key: string) => {
    setSessions((current) => current.filter((session) => session.key !== key));
    setActiveKey((current) => {
      if (current !== key) return current;
      const remaining = sessionsRef.current.filter(
        (session) => session.key !== key,
      );
      return remaining.at(-1)?.key ?? null;
    });
  }, []);

  React.useEffect(() => {
    if (
      !isTauri() ||
      typeof (
        globalThis as { __TAURI_INTERNALS__?: { unregisterListener?: unknown } }
      ).__TAURI_INTERNALS__?.unregisterListener !== "function"
    )
      return;
    let disposed = false;
    const listeners = Promise.all([
      listen<{ requestId?: string; sessionId?: string }>(
        "workbench-mcp-terminal-read",
        async (event) => {
          const { requestId, sessionId } = event.payload ?? {};
          if (!requestId || !sessionId) return;
          const session = sessionsRef.current.find(
            (candidate) => candidate.connection?.sessionId === sessionId,
          );
          await emit("workbench-mcp-result", {
            requestId,
            ok: Boolean(session),
            sessionId,
            text: terminalFrameToText(session?.frame),
            ...(session ? {} : { error: "terminal session not found" }),
          });
        },
      ),
      listen<{ requestId?: string; sessionId?: string }>(
        "workbench-mcp-terminal-stop",
        async (event) => {
          const { requestId, sessionId } = event.payload ?? {};
          if (!requestId || !sessionId) return;
          const session = sessionsRef.current.find(
            (candidate) => candidate.connection?.sessionId === sessionId,
          );
          if (!session?.connection) {
            await emit("workbench-mcp-result", {
              requestId,
              ok: false,
              error: "terminal session not found",
            });
            return;
          }
          try {
            await session.connection.close();
            await emit("workbench-mcp-result", {
              requestId,
              ok: true,
              sessionId,
              stopped: true,
            });
          } catch (error) {
            await emit("workbench-mcp-result", {
              requestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      ),
    ]);
    return () => {
      disposed = true;
      void listeners.then((stops) => {
        if (disposed) stops.forEach((stop) => void stop());
      });
    };
  }, []);

  const createSession = React.useCallback(
    (pendingCommand?: string, pendingRequestId?: string) => {
      const spawnContext = contextRef.current;
      if (!available || !spawnContext) return;
      const key = crypto.randomUUID();
      const initial: Session = {
        key,
        connection: null,
        delivery: null,
        frame: undefined,
        title: "SHELL",
        closing: false,
        context: spawnContext,
        pendingCommand,
        pendingRequestId,
      };
      setSessions((current) => [...current, initial]);
      setActiveKey(key);

      const update = (apply: (session: Session) => Session) => {
        if (!mountedRef.current) return;
        setSessions((current) =>
          current.map((session) =>
            session.key === key ? apply(session) : session,
          ),
        );
      };
      const onMessage = (
        message: Exclude<TerminalMessage, { type: "frame" }>,
      ) => {
        if (message.type === "exit") {
          removeSession(key);
        } else if (message.type === "title") {
          update((session) => ({
            ...session,
            title: message.payload || "SHELL",
          }));
        } else if (message.type === "resetTitle") {
          update((session) => ({ ...session, title: "SHELL" }));
        }
      };
      const onFrame = (delivery: TerminalDelivery) => {
        update((session) => ({ ...session, delivery, frame: delivery.frame }));
      };

      const size = sizeRef.current;
      void TerminalConnection.attach(
        {
          ...spawnContext,
          threadId: spawnContext.threadId ?? undefined,
          ...size,
        },
        onMessage,
        onFrame,
      )
        .then((connection) => {
          if (!mountedRef.current) return connection.detach();
          if (closedSessionKeysRef.current.delete(key))
            return connection.close();
          connectionSizesRef.current.set(connection, size);
          update((session) => ({ ...session, connection }));
          if (pendingCommand) {
            void connection
              .input(`${pendingCommand}\n`)
              .then(() =>
                pendingRequestId
                  ? emit("workbench-mcp-result", {
                      requestId: pendingRequestId,
                      ok: true,
                      sessionId: connection.sessionId,
                      commandSent: true,
                    })
                  : undefined,
              )
              .catch(async (error) => {
                if (pendingRequestId) {
                  await emit("workbench-mcp-result", {
                    requestId: pendingRequestId,
                    ok: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                  });
                }
                fail(error);
              });
          }
          if (sizeRef.current !== size) {
            const currentSize = sizeRef.current;
            resizeChainRef.current = resizeChainRef.current
              .then(async () => {
                const viewport = await connection.resize(
                  currentSize.columns,
                  currentSize.rows,
                  currentSize.pixelWidth,
                  currentSize.pixelHeight,
                );
                connectionSizesRef.current.set(connection, currentSize);
                await connection.viewportReady(viewport);
              })
              .catch(fail);
          }
        })
        .catch((error) => {
          if (closedSessionKeysRef.current.delete(key)) return;
          removeSession(key);
          fail(error);
        });
    },
    [available, fail, removeSession],
  );

  // Dukick: one terminal list for the whole app (Claude-desktop style).
  const channelSessions = sessions;
  const handledSessionRequestRef = React.useRef(panel.newSessionRequestId);
  const sessionRequestPending =
    handledSessionRequestRef.current !== panel.newSessionRequestId;

  React.useEffect(() => {
    setTerminalSessionChannels(
      sessions.map((session) => session.context.channelId),
    );
  }, [sessions]);

  React.useEffect(() => {
    if (!sessionRequestPending) return;
    handledSessionRequestRef.current = panel.newSessionRequestId;
    createSession(panel.agentCommand?.command, panel.agentCommand?.requestId);
  }, [
    createSession,
    panel.agentCommand?.command,
    panel.agentCommand?.requestId,
    panel.newSessionRequestId,
    sessionRequestPending,
  ]);

  React.useEffect(() => {
    if (panel.mode === "closed" || !available) return;
    if (sessionRequestPending) return;
    if (channelSessions.length === 0) createSession();
    else if (!channelSessions.some((session) => session.key === activeKey))
      setActiveKey(channelSessions.at(-1)?.key ?? null);
  }, [
    activeKey,
    available,
    channelSessions,
    createSession,
    panel.mode,
    sessionRequestPending,
  ]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const session of sessionsRef.current) {
        void session.connection?.detach().catch(report);
      }
    };
  }, []);

  const active =
    channelSessions.find((session) => session.key === activeKey) ??
    channelSessions.at(-1) ??
    null;

  React.useEffect(() => {
    const connection = active?.connection;
    if (!connection) return;
    const size = sizeRef.current;
    if (connectionSizesRef.current.get(connection) === size) return;
    resizeChainRef.current = resizeChainRef.current
      .then(async () => {
        const viewport = await connection.resize(
          size.columns,
          size.rows,
          size.pixelWidth,
          size.pixelHeight,
        );
        connectionSizesRef.current.set(connection, size);
        await connection.viewportReady(viewport);
      })
      .catch(fail);
  }, [active?.connection, fail]);

  const send = (operation: Promise<void> | undefined) => operation?.catch(fail);
  const handleSplashStarted = React.useCallback(() => {
    setSplashPending(false);
  }, []);

  const handleSize = React.useCallback(
    (size: TerminalViewportSize) => {
      sizeRef.current = size;
      const connection = sessionsRef.current.find(
        (session) => session.key === activeKey,
      )?.connection;
      if (!connection) return;
      resizeChainRef.current = resizeChainRef.current
        .then(async () => {
          const viewport = await connection.resize(
            size.columns,
            size.rows,
            size.pixelWidth,
            size.pixelHeight,
          );
          connectionSizesRef.current.set(connection, size);
          await connection.viewportReady(viewport);
        })
        .catch(fail);
    },
    [activeKey, fail],
  );

  if (!panelMounted) return null;

  const substrate = (
    <TerminalSubstrate
      bracketedPaste={active?.frame?.bracketedPaste ?? false}
      channelName={active?.context.channelName ?? channelName}
      enabled={available}
      fitHost
      mode={paneLayout.maximized === "terminal" ? "maximized" : "docked"}
      visible={panelVisible}
      onHide={() => setTerminalPanelMode("closed")}
      onModeChange={() => togglePaneMaximized("terminal")}
      onToggle={toggleTerminalPanel}
      focusReportingEnabled={active?.frame?.focusReporting ?? false}
      frame={active?.frame}
      viewportReportingEnabled={viewportReportingEnabled}
      showSplash={splashPending && Boolean(active?.frame)}
      onSplashStarted={handleSplashStarted}
      sessionFrames={channelSessions.flatMap((session) =>
        session.frame ? [{ sessionId: session.key, frame: session.frame }] : [],
      )}
      onCloseSession={(key) => {
        setSessions((current) =>
          current.map((session) =>
            session.key === key ? { ...session, closing: true } : session,
          ),
        );
        const connection = sessionsRef.current.find(
          (session) => session.key === key,
        )?.connection;
        if (!connection) {
          closedSessionKeysRef.current.add(key);
          removeSession(key);
          return;
        }
        void connection
          .close()
          .then(() => removeSession(key))
          .catch(fail);
      }}
      onFrameConsumed={(frame) => {
        const delivery = sessionsRef.current.find(
          (session) => session.delivery?.frame === frame,
        )?.delivery;
        if (!delivery) return;
        const { sequence, subscriptionId } = delivery.frame;
        const lastAcknowledged =
          acknowledgedSequenceRef.current.get(subscriptionId) ?? -1;
        if (sequence <= lastAcknowledged) return;
        acknowledgedSequenceRef.current.set(subscriptionId, sequence);
        delivery.acknowledge().catch((error) => {
          if (
            acknowledgedSequenceRef.current.get(subscriptionId) === sequence
          ) {
            acknowledgedSequenceRef.current.set(
              subscriptionId,
              lastAcknowledged,
            );
          }
          fail(error);
        });
      }}
      onInput={(text) => send(active?.connection?.input(text))}
      onNewSession={createSession}
      onScroll={(lines) => send(active?.connection?.scroll(lines))}
      onSelectSession={setActiveKey}
      onTerminalFocusChange={(focused) =>
        send(active?.connection?.focus(focused))
      }
      onViewportSize={handleSize}
      sessions={channelSessions
        .filter((session) => !session.closing)
        .map((session) => ({
          active: session.key === activeKey,
          closing: session.closing,
          id: session.key,
          title: session.title,
        }))}
    />
  );
  if (portalHost) return createPortal(substrate, portalHost);
  return (
    globalThis as typeof globalThis & {
      __BUZZ_TERMINAL_INLINE_TEST__?: boolean;
    }
  ).__BUZZ_TERMINAL_INLINE_TEST__
    ? substrate
    : null;
}
