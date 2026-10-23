import { decodeWorkspace, type Workspace } from "./workspace-storage";

// Leave room for JSON escaping and the upload ticket below Vercel's 4.5 MB request limit.
export const MAX_CLOUD_BYTES = 3_000_000;
export const CLOUD_STORAGE_KEY = "svoi-lyudi.builder.cloud.v1";
export const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,100}$/;
export type Snapshot = { schemaVersion: 1; operationId: string; parents: string[]; workspace: Workspace };
export type Revision = { id: string; createdAt: string; hash: string; parents: string[]; label?: string };
export type CloudIndex = { heads: Revision[]; revisions: Revision[] };
export function decodeSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная версия проекта.");
  const v = value as Snapshot;
  if (Object.keys(v).sort().join() !== "operationId,parents,schemaVersion,workspace" || v.schemaVersion !== 1 ||
      typeof v.operationId !== "string" || !/^[0-9a-f-]{36}$/.test(v.operationId) || !Array.isArray(v.parents) ||
      v.parents.length > 8 || v.parents.some(id => typeof id !== "string" || !DRIVE_FILE_ID.test(id)) || new Set(v.parents).size !== v.parents.length) throw new Error("Некорректная версия проекта.");
  const raw = JSON.stringify(v);
  if (new TextEncoder().encode(raw).length > MAX_CLOUD_BYTES) throw new Error("Проект больше 3 МБ. Облачная копия не обновлена; экспортируйте проект в файл.");
  return { schemaVersion: 1, operationId: v.operationId, parents: [...v.parents].sort(), workspace: decodeWorkspace(JSON.stringify(v.workspace)) };
}
export function snapshotText(value: Snapshot): string { return JSON.stringify(decodeSnapshot(value)); }
export async function workspaceHash(workspace: Workspace): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(workspace)));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function hasWorkspaceContent(workspace: Workspace): boolean {
  return Boolean(workspace.draft || workspace.messages.length || workspace.documents.length || workspace.failedRequest || Object.values(workspace.modeState ?? {}).some(state => state?.draft || state?.failedRequest));
}
