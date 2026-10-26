import 'dart:math';

import '../domain/siding_calculator.dart';

String newId() {
  final random = Random.secure();
  return '${DateTime.now().microsecondsSinceEpoch}-${List.generate(12, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
}

class SavedCalculation {
  SavedCalculation({
    required this.id,
    required this.createdAt,
    required this.draft,
    required this.result,
  });
  final String id;
  final DateTime createdAt;
  final CalculationDraft draft;
  final CalculationResult result;
  Map<String, dynamic> toJson() => {
    'id': id,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'draft': draft.toJson(),
    'result': result.toJson(),
  };
  factory SavedCalculation.fromJson(Map<String, dynamic> value) {
    final draft = CalculationDraft.fromJson(_map(value['draft']));
    // Recalculate the imported snapshot with the exact engine, not untrusted totals.
    return SavedCalculation(
      id: _text(value, 'id', 150),
      createdAt: DateTime.parse(_text(value, 'createdAt', 50)),
      draft: draft,
      result: calculateSiding(draft),
    );
  }
}

class ProjectModel {
  ProjectModel({
    required this.id,
    required this.name,
    this.address = '',
    this.workType = 'siding',
    this.status = 'planned',
    this.isDemo = false,
    DateTime? updatedAt,
    CalculationDraft? draft,
    List<SavedCalculation> calculations = const [],
  }) : updatedAt = updatedAt ?? DateTime.now(),
       draft = draft ?? CalculationDraft.empty(),
       calculations = List.unmodifiable(calculations);
  final String id, name, address, workType, status;
  final bool isDemo;
  final DateTime updatedAt;
  final CalculationDraft draft;
  final List<SavedCalculation> calculations;
  ProjectModel copyWith({
    String? name,
    String? address,
    String? workType,
    String? status,
    DateTime? updatedAt,
    CalculationDraft? draft,
    List<SavedCalculation>? calculations,
  }) => ProjectModel(
    id: id,
    name: name ?? this.name,
    address: address ?? this.address,
    workType: workType ?? this.workType,
    status: status ?? this.status,
    isDemo: isDemo,
    updatedAt: updatedAt ?? this.updatedAt,
    draft: draft ?? this.draft,
    calculations: calculations ?? this.calculations,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'address': address,
    'workType': workType,
    'status': status,
    'isDemo': isDemo,
    'updatedAt': updatedAt.toUtc().toIso8601String(),
    'draft': draft.toJson(),
    'calculations': calculations.map((c) => c.toJson()).toList(),
  };
  factory ProjectModel.fromJson(Map<String, dynamic> value) {
    final raw = value['calculations'];
    if (raw is! List || raw.length > 500) {
      throw const FormatException('Неверный список расчётов');
    }
    final name = _text(value, 'name', 140).trim();
    if (name.isEmpty) throw const FormatException('Объект без названия');
    return ProjectModel(
      id: _text(value, 'id', 150),
      name: name,
      address: _text(value, 'address', 240, optional: true),
      workType: _text(value, 'workType', 50, optional: true),
      status: _text(value, 'status', 50, optional: true),
      isDemo: value['isDemo'] == true,
      updatedAt: DateTime.parse(_text(value, 'updatedAt', 50)),
      draft: CalculationDraft.fromJson(_map(value['draft'])),
      calculations: raw.map((r) => SavedCalculation.fromJson(_map(r))).toList(),
    );
  }
}

class WorkspaceData {
  WorkspaceData({
    required List<ProjectModel> projects,
    this.activeProjectId,
    this.assistantMode = 'general',
    this.assistantQuestion = '',
  }) : projects = List.unmodifiable(projects);
  final List<ProjectModel> projects;
  final String? activeProjectId;
  final String assistantMode, assistantQuestion;
  ProjectModel? get activeProject {
    for (final project in projects) {
      if (project.id == activeProjectId) return project;
    }
    return null;
  }

  WorkspaceData copyWith({
    List<ProjectModel>? projects,
    String? activeProjectId,
    String? assistantMode,
    String? assistantQuestion,
  }) => WorkspaceData(
    projects: projects ?? this.projects,
    activeProjectId: activeProjectId ?? this.activeProjectId,
    assistantMode: assistantMode ?? this.assistantMode,
    assistantQuestion: assistantQuestion ?? this.assistantQuestion,
  );
  factory WorkspaceData.demo() => WorkspaceData(
    activeProjectId: 'demo-house',
    projects: [
      ProjectModel(
        id: 'demo-house',
        name: 'Дом с новым фасадом',
        address: 'Демонстрационный объект · Иркутск',
        status: 'in_progress',
        isDemo: true,
        draft: CalculationDraft.example(),
      ),
      ProjectModel(
        id: 'demo-cottage',
        name: 'Загородный коттедж',
        address: 'Пример карточки объекта',
        workType: 'facade',
        isDemo: true,
        draft: CalculationDraft.example(),
      ),
    ],
  );
  Map<String, dynamic> toJson() => {
    'format': 'svoi-lyudi-native',
    'version': 1,
    'activeProjectId': activeProjectId,
    'assistantMode': assistantMode,
    'assistantQuestion': assistantQuestion,
    'projects': projects.map((p) => p.toJson()).toList(),
  };
  factory WorkspaceData.fromJson(Map<String, dynamic> value) {
    if (value['format'] != 'svoi-lyudi-native' || value['version'] != 1) {
      throw const FormatException('Неподдерживаемый формат резервной копии');
    }
    final rows = value['projects'];
    if (rows is! List || rows.length > 1000) {
      throw const FormatException('Неверный список объектов');
    }
    final projects = rows
        .map((row) => ProjectModel.fromJson(_map(row)))
        .toList();
    if (projects.map((p) => p.id).toSet().length != projects.length) {
      throw const FormatException('Повторяющиеся ID объектов');
    }
    final active = value['activeProjectId'];
    return WorkspaceData(
      projects: projects,
      activeProjectId: active is String && projects.any((p) => p.id == active)
          ? active
          : projects.firstOrNull?.id,
      assistantMode: _text(value, 'assistantMode', 50, optional: true),
      assistantQuestion: _text(
        value,
        'assistantQuestion',
        4000,
        optional: true,
      ),
    );
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is! Map<String, dynamic>) {
    throw const FormatException('Ожидалась запись');
  }
  return value;
}

String _text(
  Map<String, dynamic> map,
  String key,
  int max, {
  bool optional = false,
}) {
  final v = map[key];
  if (optional && v == null) return '';
  if (v is! String || v.length > max) {
    throw FormatException('Неверное поле $key');
  }
  return v;
}
