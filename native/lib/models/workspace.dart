import 'dart:math';

import '../domain/siding_calculator.dart';

String newId() {
  final random = Random.secure();
  return '${DateTime.now().microsecondsSinceEpoch}-${List.generate(12, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
}

const assistantModes = {
  'general',
  'estimate',
  'engineering',
  'facade',
  'business',
  'documents',
};
const maxAssistantThreads =
    6006; // 1000 objects × six modes, plus general dialogs.
const maxAssistantMessages = 100;

class ChatMessage {
  ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
  }) {
    if (id.isEmpty ||
        id.length > 150 ||
        !const {'user', 'assistant'}.contains(role) ||
        content.isEmpty ||
        content.length > 100000) {
      throw const FormatException('Неверное сообщение помощника');
    }
  }
  final String id, role, content;
  final DateTime createdAt;
  Map<String, dynamic> toJson() => {
    'id': id,
    'role': role,
    'content': content,
    'createdAt': createdAt.toUtc().toIso8601String(),
  };
  factory ChatMessage.fromJson(Map<String, dynamic> value) => ChatMessage(
    id: _text(value, 'id', 150),
    role: _text(value, 'role', 20),
    content: _text(value, 'content', 100000),
    createdAt: DateTime.parse(_text(value, 'createdAt', 50)),
  );
}

class AssistantThread {
  AssistantThread({
    required this.id,
    required this.projectId,
    required this.mode,
    this.draft = '',
    List<ChatMessage> messages = const [],
  }) : messages = List.unmodifiable(messages) {
    if (id.isEmpty ||
        id.length > 150 ||
        (projectId != null &&
            (projectId!.isEmpty || projectId!.length > 150)) ||
        !assistantModes.contains(mode) ||
        draft.length > 4000 ||
        messages.length > maxAssistantMessages ||
        messages.map((m) => m.id).toSet().length != messages.length) {
      throw const FormatException('Неверный диалог помощника');
    }
  }
  final String id, mode, draft;
  final String? projectId;
  final List<ChatMessage> messages;
  AssistantThread copyWith({
    String? id,
    String? draft,
    List<ChatMessage>? messages,
  }) => AssistantThread(
    id: id ?? this.id,
    projectId: projectId,
    mode: mode,
    draft: draft ?? this.draft,
    messages: messages ?? this.messages,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'projectId': projectId,
    'mode': mode,
    'draft': draft,
    'messages': messages.map((m) => m.toJson()).toList(),
  };
  factory AssistantThread.fromJson(Map<String, dynamic> value) {
    final raw = value['messages'];
    if (raw is! List ||
        raw.length > maxAssistantMessages ||
        (value['projectId'] != null && value['projectId'] is! String)) {
      throw const FormatException('Неверный диалог помощника');
    }
    return AssistantThread(
      id: _text(value, 'id', 150),
      projectId: value['projectId'] as String?,
      mode: _text(value, 'mode', 50),
      draft: _text(value, 'draft', 4000, optional: true),
      messages: raw.map((row) => ChatMessage.fromJson(_map(row))).toList(),
    );
  }
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
    List<AssistantThread> threads = const [],
    this.activeProjectId,
    this.assistantMode = 'general',
    this.assistantQuestion = '',
  }) : projects = List.unmodifiable(projects),
       threads = List.unmodifiable(threads);
  final List<ProjectModel> projects;
  final List<AssistantThread> threads;
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
    List<AssistantThread>? threads,
    String? activeProjectId,
    String? assistantMode,
    String? assistantQuestion,
  }) => WorkspaceData(
    projects: projects ?? this.projects,
    threads: threads ?? this.threads,
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
    'threads': threads.map((thread) => thread.toJson()).toList(),
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
    final activeId = active is String && projects.any((p) => p.id == active)
        ? active
        : projects.firstOrNull?.id;
    final mode = _text(value, 'assistantMode', 50, optional: true);
    final question = _text(value, 'assistantQuestion', 4000, optional: true);
    final List<AssistantThread> threads;
    if (value.containsKey('threads')) {
      final rawThreads = value['threads'];
      if (rawThreads is! List || rawThreads.length > maxAssistantThreads) {
        throw const FormatException('Неверный список диалогов');
      }
      threads = rawThreads
          .map((row) => AssistantThread.fromJson(_map(row)))
          .toList();
    } else {
      // The optional v1 field is migrated once. An explicit empty list stays empty.
      threads = question.isEmpty
          ? []
          : [
              AssistantThread(
                id: newId(),
                projectId: activeId,
                mode: assistantModes.contains(mode) ? mode : 'general',
                draft: question,
              ),
            ];
    }
    final projectIds = projects.map((p) => p.id).toSet();
    final threadIds = <String>{}, scopes = <String>{}, messageIds = <String>{};
    for (final thread in threads) {
      if (!threadIds.add(thread.id) ||
          !scopes.add(_assistantScope(thread.projectId, thread.mode)) ||
          (thread.projectId != null &&
              !projectIds.contains(thread.projectId))) {
        throw const FormatException('Неверная принадлежность диалогов');
      }
      for (final message in thread.messages) {
        if (!messageIds.add(message.id)) {
          throw const FormatException('Повторяющиеся ID сообщений');
        }
      }
    }
    return WorkspaceData(
      projects: projects,
      threads: threads,
      activeProjectId: activeId,
      assistantMode: assistantModes.contains(mode) ? mode : 'general',
      assistantQuestion: question,
    );
  }
}

String _assistantScope(String? projectId, String mode) =>
    '${projectId == null ? 'global' : 'project:${projectId.length}:$projectId'}:$mode';

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
