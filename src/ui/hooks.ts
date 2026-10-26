import { useCallback, useEffect, useState } from "react";
import { isExtension, request } from "../client.ts";
import type { Item, Snapshot } from "../types.ts";

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const s = await request<Snapshot>({ type: "snapshot" });
      setSnapshot(s);
      setError("");
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (!isExtension) return;
    const listener = (_c: unknown, area: string) => {
      if (area === "local") void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);
  return { snapshot, error, setError, refresh };
}

export const shortHost = (url?: string) => {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function pinnedEntries(snapshot: Snapshot, activeSpace?: string): Item[] {
  return snapshot.state.items.filter(
    (i) =>
      (i.kind === "link" || i.kind === "split") &&
      !i.missing &&
      i.scope !== "temporary" &&
      (i.spaceId === activeSpace || i.spaceId === null),
  );
}

export const letterOf = (url?: string, title?: string) =>
  (shortHost(url) || title || "?").slice(0, 1).toUpperCase();
