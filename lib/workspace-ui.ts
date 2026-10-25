import type { Workspace } from "./workspace-storage";

/** Content that would be lost when the owner starts a new local project. */
export function workspaceHasUserData(workspace: Workspace): boolean {
  const savedModeData = Object.values(workspace.modeState ?? {}).some((state) =>
    Boolean(state && (state.draft.length > 0 || state.failedRequest !== undefined)),
  );
  return workspace.draft.length > 0
    || workspace.messages.length > 0
    || workspace.documents.length > 0
    || workspace.failedRequest !== undefined
    || savedModeData;
}
