import {
  documentOf,
  initialRuntime,
  initialState,
  validateBackup,
} from "./model.ts";
import type {
  AppState,
  BookmarkBefore,
  DataDocument,
  RuntimeState,
} from "./types.ts";

export interface Journal {
  before: DataDocument;
  created: string[];
  changed: BookmarkBefore[];
  creating?: {
    parentId: string;
    title: string;
    url?: string;
    beforeIds: string[];
  };
}
export async function loadState(): Promise<AppState> {
  const { data } = (await chrome.storage.local.get("data")) as {
    data?: AppState;
  };
  if (!data) return initialState();
  if (data.schemaVersion !== 1)
    throw new Error("本地数据版本不受支持，请先导出备份");
  validateBackup(JSON.stringify(data));
  return data as AppState;
}
export async function saveState(state: AppState): Promise<void> {
  state.revision++;
  await chrome.storage.local.set({ data: state });
}
export async function loadRuntime(): Promise<RuntimeState> {
  const { runtime } = (await chrome.storage.session.get("runtime")) as {
    runtime?: RuntimeState;
  };
  return runtime ?? initialRuntime();
}
export const saveRuntime = (runtime: RuntimeState) =>
  chrome.storage.session.set({ runtime });
export const saveJournal = (pending: Journal) =>
  chrome.storage.local.set({ pending });
export async function resolveCreation(pending: Journal): Promise<void> {
  if (!pending.creating) return;
  const intent = pending.creating;
  const children = await chrome.bookmarks.getChildren(intent.parentId);
  const candidates = children.filter(
    (node) =>
      !intent.beforeIds.includes(node.id) &&
      node.title === intent.title &&
      node.url === intent.url,
  );
  if (candidates.length > 1)
    throw new Error("上次书签创建存在多个候选，请检查专属目录后重试恢复");
  if (candidates.length === 1 && !pending.created.includes(candidates[0].id))
    pending.created.push(candidates[0].id);
  delete pending.creating;
  await saveJournal(pending);
}
export async function rollbackBookmarks(
  created: string[],
  changed: BookmarkBefore[] = [],
): Promise<string[]> {
  const failures: string[] = [];
  for (const before of [...changed].reverse()) {
    try {
      await chrome.bookmarks.update(before.id, {
        title: before.title,
        ...(before.url ? { url: before.url } : {}),
      });
      if (before.parentId)
        await chrome.bookmarks.move(before.id, {
          parentId: before.parentId,
          index: before.index,
        });
    } catch {
      failures.push(before.id);
    }
  }
  for (const id of [...created].reverse()) {
    try {
      await chrome.bookmarks.get(id);
    } catch {
      continue;
    }
    try {
      await chrome.bookmarks.remove(id);
    } catch {
      failures.push(id);
    }
  }
  return failures;
}
export async function recoverJournal(): Promise<void> {
  const { pending } = (await chrome.storage.local.get("pending")) as {
    pending?: Journal;
  };
  if (!pending) return;
  await resolveCreation(pending);
  const failures = await rollbackBookmarks(pending.created, pending.changed);
  if (failures.length)
    throw new Error("上次导入尚有书签待恢复，请保留备份并检查专属目录");
  await chrome.storage.local.set({ data: pending.before });
  await chrome.storage.local.remove("pending");
}
export function backup(state: AppState): string {
  return JSON.stringify(documentOf(state), null, 2);
}
let tail: Promise<unknown> = Promise.resolve();
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task);
  tail = result.catch(() => undefined);
  return result;
}
