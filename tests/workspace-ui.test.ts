import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionActions, WorkspaceStoragePanel } from "../components/WorkspacePrivacyControls";
import { workspaceHasUserData } from "../lib/workspace-ui";
import { emptyWorkspace } from "../lib/workspace-storage";

const noop = () => undefined;

test("workspace controls are absent without an authenticated owner session", () => {
  const markup = renderToStaticMarkup(createElement(WorkspaceStoragePanel, { authenticated: false, unavailable: false, hydrated: true, projectBusy: false, storageError: "", onExport: noop, onImport: noop, onClear: noop }));
  assert.equal(markup, "");
  assert.doesNotMatch(markup, /Экспортировать проект|Восстановить из файла/);
});

test("authenticated workspace and session actions state their privacy effects", () => {
  const storage = renderToStaticMarkup(createElement(WorkspaceStoragePanel, { authenticated: true, unavailable: false, hydrated: true, projectBusy: false, storageError: "", onExport: noop, onImport: noop, onClear: noop }));
  assert.match(storage, /Экспортировать проект/);
  assert.match(storage, /Выйти и удалить локальные данные/);
  assert.match(storage, /aria-label="Восстановить проект из файла"/);

  const session = renderToStaticMarkup(createElement(SessionActions, { busy: false, onNewProject: noop, onLogout: noop, onLogoutAndClear: noop }));
  assert.match(session, /Новый проект\/диалог/);
  assert.match(session, />Выйти</);
  assert.match(session, /Выйти и удалить локальные данные/);
  assert.match(session, /На общем компьютере/);
});

test("new-project protection detects every kind of recoverable user content", () => {
  assert.equal(workspaceHasUserData(emptyWorkspace()), false);

  const draft = emptyWorkspace();
  draft.draft = "Незавершённый запрос";
  assert.equal(workspaceHasUserData(draft), true);

  const history = emptyWorkspace();
  history.messages.push({ id: "m1", role: "user", content: "Объект" });
  assert.equal(workspaceHasUserData(history), true);

  const failed = emptyWorkspace();
  failed.failedRequest = { message: "Повторить", mode: "general", facadeOptions: "auto", history: [] };
  assert.equal(workspaceHasUserData(failed), true);

  const inactiveDraft = emptyWorkspace();
  inactiveDraft.modeState = { facade: { draft: "Черновик во вкладке фасадов", activeDocumentId: null } };
  assert.equal(workspaceHasUserData(inactiveDraft), true);

  const inactiveRetry = emptyWorkspace();
  inactiveRetry.modeState = { estimate: { draft: "", activeDocumentId: null, failedRequest: { message: "Повторить смету", mode: "estimate", facadeOptions: "auto", history: [] } } };
  assert.equal(workspaceHasUserData(inactiveRetry), true);
});
