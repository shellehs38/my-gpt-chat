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
    data = data.copyWith(activeProjectId: id);
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
    data = data.copyWith(assistantMode: mode, assistantQuestion: question);
    _unsaved = true;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 500), _save);
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
    if (data.projects.length + incoming.projects.length > 1000) {
      throw const FormatException('Слишком много объектов');
    }
    final copies = incoming.projects
        .map(
          (p) => ProjectModel(
            id: newId(),
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
    final previous = data;
    final wasReadFailed = _readFailed;
    _readFailed = false;
    data = data.copyWith(projects: [...data.projects, ...copies]);
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
