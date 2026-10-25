"use client";

import React from "react";
import type { ChangeEventHandler } from "react";

type SessionActionsProps = {
  busy: boolean;
  onNewProject: () => void;
  onLogout: () => void;
  onLogoutAndClear: () => void;
};

export function SessionActions({ busy, onNewProject, onLogout, onLogoutAndClear }: SessionActionsProps) {
  return <div className="session-controls">
    <p id="session-privacy-note" className="privacy-warning" role="note">
      Обычный выход завершает сессию и сохраняет проект в этом браузере. На общем компьютере используйте выход с удалением данных.
    </p>
    <div className="action-row session-actions" role="group" aria-label="Управление проектом и сессией" aria-describedby="session-privacy-note">
      <button type="button" className="secondary-button" disabled={busy} onClick={onNewProject}>Новый проект/диалог</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onLogout}>Выйти</button>
      <button type="button" className="secondary-button danger-button" disabled={busy} onClick={onLogoutAndClear}>Выйти и удалить локальные данные</button>
    </div>
  </div>;
}

type WorkspaceStoragePanelProps = {
  authenticated: boolean;
  unavailable: boolean;
  hydrated: boolean;
  projectBusy: boolean;
  storageError: string;
  onExport: () => void;
  onImport: ChangeEventHandler<HTMLInputElement>;
  onClear: () => void;
};

export function WorkspaceStoragePanel({ authenticated, unavailable, hydrated, projectBusy, storageError, onExport, onImport, onClear }: WorkspaceStoragePanelProps) {
  if (!authenticated || unavailable) return null;
  return <section className="panel storage-panel" aria-labelledby="workspace-storage-heading">
    <h2 id="workspace-storage-heading">Сохранение проекта</h2>
    <p>Диалог, версии и правки сразу сохраняются в этом браузере. Статус подключённого автосохранения Google Drive показан ниже.</p>
    <p className="privacy-warning" role="note">На общем компьютере экспортируйте нужное, затем выберите «Выйти и удалить локальные данные».</p>
    {storageError && <p className="error-box" role="alert">{storageError}</p>}
    <div className="action-row" aria-label="Резервная копия проекта">
      <button type="button" className="secondary-button" disabled={!hydrated} onClick={onExport}>Экспортировать проект</button>
      <label className="secondary-button import-button">Восстановить из файла
        <input aria-label="Восстановить проект из файла" type="file" accept="application/json,.json" disabled={projectBusy || !hydrated} onChange={onImport} />
      </label>
      <button type="button" className="secondary-button danger-button" disabled={projectBusy || !hydrated} onClick={onClear}>Очистить локальные данные</button>
    </div>
  </section>;
}
