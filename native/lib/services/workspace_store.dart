import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../domain/siding_calculator.dart';
import '../models/workspace.dart';

abstract interface class WorkspaceRepository {
  Future<WorkspaceData?> read();
  Future<void> write(WorkspaceData data);
}

class FileWorkspaceRepository implements WorkspaceRepository {
  FileWorkspaceRepository({this._directory});
  Directory? _directory;
  Future<File> _file() async {
    final root = _directory ??= await getApplicationSupportDirectory();
    await root.create(recursive: true);
    return File(
      '${root.path}${Platform.pathSeparator}svoi-lyudi-workspace.json',
    );
  }

  @override
  Future<WorkspaceData?> read() async {
    final file = await _file();
    if (!await file.exists()) return null;
    if (await file.length() > 10 * 1024 * 1024) {
      throw const FormatException('Файл данных превышает 10 МБ');
    }
    return WorkspaceData.fromJson(
      jsonDecode(await file.readAsString()) as Map<String, dynamic>,
    );
  }

  @override
  Future<void> write(WorkspaceData data) async {
    final file = await _file();
    final payload = jsonEncode(data.toJson());
    if (utf8.encode(payload).length > 10 * 1024 * 1024) {
      throw const FormatException('Файл данных превышает 10 МБ');
    }
    final temporary = File('${file.path}.${newId()}.tmp');
    try {
      await temporary.writeAsString(payload, flush: true);
      if (await file.exists()) {
        var validPrevious = true;
        try {
          final prior = jsonDecode(await file.readAsString());
          if (prior is! Map<String, dynamic>) {
            throw const FormatException('Invalid workspace');
          }
          WorkspaceData.fromJson(prior);
        } on FormatException {
          validPrevious = false;
        } on TypeError {
          validPrevious = false;
        }
        await file.copy(
          validPrevious
              ? '${file.path}.backup'
              : '${file.path}.damaged-${newId()}',
        );
      }
      await temporary.rename(file.path);
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
  }
}

class MemoryWorkspaceRepository implements WorkspaceRepository {
  MemoryWorkspaceRepository([this.data]);
  WorkspaceData? data;
  bool failWrites = false;
  @override
  Future<WorkspaceData?> read() async => data;
  @override
  Future<void> write(WorkspaceData value) async {
    if (failWrites) throw const FileSystemException('Test write failure');
    data = WorkspaceData.fromJson(value.toJson());
  }
}

class WorkspaceStore extends ChangeNotifier {
  WorkspaceStore(this.repository, {WorkspaceData? initialData})
    : data = initialData ?? WorkspaceData.demo(),
      ready = initialData != null;
  final WorkspaceRepository repository;
  WorkspaceData data;
  bool ready, saving = false;
  bool get hasUnsavedChanges => _unsaved;
  bool _unsaved = false, _readFailed = false, _disposed = false;
  int _pendingWrites = 0;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  String? error;
  Timer? _draftTimer;
  Future<void> _queue = Future.value();
  ProjectModel? get activeProject => data.activeProject;
  String get assistantMode => assistantModes.contains(data.assistantMode)
      ? data.assistantMode
      : 'general';
  AssistantThread get activeAssistantThread =>
      assistantThreadFor(data.activeProjectId, assistantMode);
  String get assistantDraft => activeAssistantThread.draft;

  AssistantThread assistantThreadFor(String? projectId, String mode) {
    if (!assistantModes.contains(mode) ||
        (projectId != null && !data.projects.any((p) => p.id == projectId))) {
      throw const FormatException('Неверное направление или объект диалога');
    }
    for (final thread in data.threads) {
      if (thread.projectId == projectId && thread.mode == mode) return thread;
    }
    if (data.threads.length >= maxAssistantThreads) {
      throw const FormatException('Достигнут предел количества диалогов');
    }
    final thread = AssistantThread(
      id: newId(),
      projectId: projectId,
      mode: mode,
    );
    data = data.copyWith(threads: [...data.threads, thread]);
    // This accessor may be called while building a widget. The save notifies later.
    _scheduleDraftSave();
    return thread;
  }

  void _scheduleDraftSave() {
    _unsaved = true;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 500), _save);
  }

  void _replaceThread(AssistantThread thread) {
    data = data.copyWith(
      threads: data.threads
          .map(
            (prior) =>
                prior.projectId == thread.projectId && prior.mode == thread.mode
                ? thread
                : prior,
          )
          .toList(),
      assistantQuestion:
          thread.projectId == data.activeProjectId &&
              thread.mode == assistantMode
          ? thread.draft
          : null,
    );
  }

  Future<void> initialize() async {
    try {
      data = await repository.read() ?? WorkspaceData.demo();
    } catch (e) {
      error = 'Не удалось прочитать данные. Исходный файл сохранён; запись остановлена до восстановления копии.';
      _readFailed = true;
    }
    ready = true;
    _notify();
  }

  Future<bool> _save() {
    _draftTimer?.cancel();
    if (!ready || _disposed) return Future.value(false);
    if (_readFailed) {
      _notify();
      return Future.value(false);
    }
    final snapshot = data;
    final completer = Completer<bool>();
    _pendingWrites++;
    saving = true;
    _unsaved = true;
    _notify();
    _queue = _queue.then((_) async {
      try {
        await repository.write(snapshot);
        if (identical(data, snapshot)) _unsaved = false;
        error = null;
        completer.complete(true);
      } catch (e) {
        error = 'Не удалось сохранить на устройстве. Скачайте резервную копию и повторите.';
        _unsaved = true;
        completer.complete(false);
      } finally {
        _pendingWrites--;
        saving = _pendingWrites > 0;
        _notify();
      }
    });
    return completer.future;
  }

  Future<bool> saveNow() => _save();
  Future<bool> selectProject(String id) async {
    if (!data.projects.any((p) => p.id == id)) return false;
    final thread = data.threads
        .where((t) => t.projectId == id && t.mode == assistantMode)
        .firstOrNull;
    data = data.copyWith(
      activeProjectId: id,
      assistantQuestion: thread?.draft ?? '',
    );
    return _save();
  }

  Future<bool> upsertProject(ProjectModel project) async {
    final exists = data.projects.any((p) => p.id == project.id);
    data = data.copyWith(
      projects: exists
          ? data.projects.map((p) => p.id == project.id ? project : p).toList()
          : [project, ...data.projects],
      activeProjectId: project.id,
    );
    final thread = data.threads
        .where((t) => t.projectId == project.id && t.mode == assistantMode)
        .firstOrNull;
    data = data.copyWith(assistantQuestion: thread?.draft ?? '');
    return _save();
  }

  void updateDraft(CalculationDraft draft) {
    final project = activeProject;
    if (project == null) return;
    data = data.copyWith(
      projects: data.projects
          .map((p) => p.id == project.id ? p.copyWith(draft: draft) : p)
          .toList(),
    );
    _unsaved = true;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 400), _save);
  }

  Future<bool> saveCalculation(
    CalculationDraft draft,
    CalculationResult result,
  ) async {
    final project = activeProject;
    if (project == null || !result.complete) return false;
    final calc = SavedCalculation(
      id: newId(),
      createdAt: DateTime.now(),
      draft: draft,
      result: result,
    );
    data = data.copyWith(
      projects: data.projects
          .map(
            (p) => p.id == project.id
                ? p.copyWith(
                    draft: draft,
                    updatedAt: DateTime.now(),
                    calculations: [...p.calculations, calc],
                  )
                : p,
          )
          .toList(),
    );
    final snapshot = data;
    final saved = await _save();
    if (!saved && identical(data, snapshot)) {
      data = data.copyWith(
        projects: data.projects
            .map(
              (p) => p.id == project.id
                  ? p.copyWith(calculations: project.calculations)
                  : p,
            )
            .toList(),
      );
      _notify();
    }
    return saved;
  }

  void updateAssistant({String? mode, String? question}) {
    if (mode != null && !assistantModes.contains(mode)) {
      throw const FormatException('Неверное направление помощника');
    }
    final selected = mode ?? assistantMode;
    final thread = assistantThreadFor(data.activeProjectId, selected);
    data = data.copyWith(
      assistantMode: selected,
      assistantQuestion: question ?? thread.draft,
    );
    if (question != null) _replaceThread(thread.copyWith(draft: question));
    _scheduleDraftSave();
    _notify();
  }

  void updateAssistantDraft(String text) => updateAssistant(question: text);

  bool updateAssistantDraftFor({
    required String? projectId,
    required String mode,
    required String text,
    String? expectedThreadId,
    String? expectedDraft,
  }) {
    if (!ready ||
        _disposed ||
        text.length > 4000 ||
        !assistantModes.contains(mode) ||
        (projectId != null && !data.projects.any((p) => p.id == projectId))) {
      return false;
    }
    final existing = data.threads
        .where((thread) => thread.projectId == projectId && thread.mode == mode)
        .firstOrNull;
    if (expectedThreadId != null && existing?.id != expectedThreadId) {
      return false;
    }
    final thread = existing ?? assistantThreadFor(projectId, mode);
    if (expectedDraft != null && thread.draft != expectedDraft) return false;
    _replaceThread(thread.copyWith(draft: text));
    _scheduleDraftSave();
    _notify();
    return true;
  }

  Future<bool> appendAssistantMessage({
    required String? projectId,
    required String mode,
    required ChatMessage message,
    String? expectedThreadId,
    String? clearDraftIfMatches,
  }) async {
    if (!ready ||
        _disposed ||
        !assistantModes.contains(mode) ||
        (projectId != null && !data.projects.any((p) => p.id == projectId))) {
      return false;
    }
    final matches = data.threads.where(
      (thread) => thread.projectId == projectId && thread.mode == mode,
    );
    if (expectedThreadId != null &&
        (matches.isEmpty || matches.first.id != expectedThreadId)) {
      return false;
    }
    final thread = matches.firstOrNull ?? assistantThreadFor(projectId, mode);
    if (thread.messages.length >= maxAssistantMessages) {
      error = 'В диалоге уже 100 сообщений. Начните новый диалог.';
      _notify();
      return false;
    }
    if (data.threads.any((t) => t.messages.any((m) => m.id == message.id))) {
      return false;
    }
    _replaceThread(
      thread.copyWith(
        messages: [...thread.messages, message],
        draft:
            clearDraftIfMatches != null && thread.draft == clearDraftIfMatches
            ? ''
            : thread.draft,
      ),
    );
    return _save();
  }

  Future<bool> clearAssistantThread({
    required String? projectId,
    required String mode,
    String? expectedThreadId,
  }) async {
    if (!ready || _disposed) return false;
    final thread = assistantThreadFor(projectId, mode);
    if (expectedThreadId != null && thread.id != expectedThreadId) return false;
    final previous = data;
    _replaceThread(thread.copyWith(id: newId(), draft: '', messages: []));
    final snapshot = data;
    final saved = await _save();
    if (!saved && identical(data, snapshot)) {
      data = previous;
      _notify();
    }
    return saved;
  }

  String exportJson() =>
      const JsonEncoder.withIndent('  ').convert(data.toJson());
  Future<int> importCopies(String text) async {
    if (utf8.encode(text).length > 10 * 1024 * 1024) {
      throw const FormatException('Размер копии превышает 10 МБ');
    }
    final incoming = WorkspaceData.fromJson(
      jsonDecode(text) as Map<String, dynamic>,
    );
    final globalThreads = incoming.threads
        .where((t) => t.projectId == null)
        .toList();
    if (data.projects.length +
            incoming.projects.length +
            (globalThreads.isNotEmpty ? 1 : 0) >
        1000) {
      throw const FormatException('Слишком много объектов');
    }
    if (data.threads.length + incoming.threads.length > maxAssistantThreads) {
      throw const FormatException('Слишком много диалогов');
    }
    final projectIdMap = {
      for (final project in incoming.projects) project.id: newId(),
    };
    final copies = incoming.projects
        .map(
          (p) => ProjectModel(
            id: projectIdMap[p.id]!,
            name: '${p.name} · копия'.substring(
              0,
              ('${p.name} · копия').length.clamp(0, 140),
            ),
            address: p.address,
            workType: p.workType,
            status: p.status,
            draft: p.draft,
            calculations: p.calculations
                .map(
                  (c) => SavedCalculation(
                    id: newId(),
                    createdAt: c.createdAt,
                    draft: c.draft,
                    result: c.result,
                  ),
                )
                .toList(),
          ),
        )
        .toList();
    String? globalProjectId;
    if (globalThreads.isNotEmpty) {
      globalProjectId = newId();
      copies.add(
        ProjectModel(
          id: globalProjectId,
          name: 'Общие диалоги · копия',
          workType: 'other',
          status: 'planned',
        ),
      );
    }
    final importedThreads = incoming.threads
        .map(
          (thread) => AssistantThread(
            id: newId(),
            projectId: thread.projectId == null
                ? globalProjectId!
                : projectIdMap[thread.projectId]!,
            mode: thread.mode,
            draft: thread.draft,
            messages: thread.messages
                .map(
                  (message) => ChatMessage(
                    id: newId(),
                    role: message.role,
                    content: message.content,
                    createdAt: message.createdAt,
                  ),
                )
                .toList(),
          ),
        )
        .toList();
    final previous = data;
    final wasReadFailed = _readFailed;
    _readFailed = false;
    data = data.copyWith(
      projects: [...data.projects, ...copies],
      threads: [...data.threads, ...importedThreads],
    );
    if (!await _save()) {
      data = previous;
      _readFailed = wasReadFailed;
      _notify();
      throw const FileSystemException('Импорт не сохранён');
    }
    return copies.length;
  }

  @override
  void dispose() {
    _disposed = true;
    _draftTimer?.cancel();
    super.dispose();
  }
}
