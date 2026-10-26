import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/models/workspace.dart';
import 'package:svoi_lyudi_native/services/workspace_store.dart';

void main() {
  test('legacy question migrates once to its object and mode', () {
    final legacy =
        _workspace()
            .copyWith(
              assistantMode: 'estimate',
              assistantQuestion: 'Исходный вопрос',
            )
            .toJson()
          ..remove('threads');
    final migrated = WorkspaceData.fromJson(legacy);
    expect(migrated.threads, hasLength(1));
    final thread = migrated.threads.single;
    expect(thread.projectId, 'one');
    expect(thread.mode, 'estimate');
    expect(thread.draft, 'Исходный вопрос');
    final restored = WorkspaceData.fromJson(migrated.toJson());
    expect(restored.threads.single.id, thread.id);
    expect(restored.threads, hasLength(1));

    legacy['threads'] = [];
    expect(WorkspaceData.fromJson(legacy).threads, isEmpty);
  });

  test(
    'assistant lists are immutable and backup roundtrip preserves ownership',
    () {
      final state = _workspace().copyWith(
        threads: [
          _thread('one', 'estimate', messages: [_message('question', 'user')]),
        ],
      );
      expect(
        () => state.threads.add(_thread('two', 'general')),
        throwsUnsupportedError,
      );
      expect(
        () => state.threads.single.messages.add(_message('reply', 'assistant')),
        throwsUnsupportedError,
      );
      expect(WorkspaceData.fromJson(state.toJson()).toJson(), state.toJson());
    },
  );

  test('parser rejects invalid references, scopes, IDs, roles and bounds', () {
    final valid = _workspace()
        .copyWith(
          threads: [
            _thread('one', 'general', messages: [_message('first', 'user')]),
            _thread(
              'two',
              'estimate',
              messages: [_message('second', 'assistant')],
            ),
          ],
        )
        .toJson();
    final mutations = <void Function(Map<String, dynamic>)>[
      (v) => (v['threads'] as List)[0]['projectId'] = 'missing',
      (v) => (v['threads'] as List)[0]['projectId'] = 5,
      (v) => (v['threads'] as List)[0]['mode'] = 'system',
      (v) => (v['threads'] as List)[0]['id'] = '',
      (v) => (v['threads'] as List)[1]['id'] = (v['threads'] as List)[0]['id'],
      (v) {
        (v['threads'] as List)[1]['projectId'] = 'one';
        (v['threads'] as List)[1]['mode'] = 'general';
      },
      (v) => (v['threads'] as List)[0]['messages'][0]['role'] = 'system',
      (v) => (v['threads'] as List)[0]['messages'][0]['content'] = 'x' * 100001,
      (v) => (v['threads'] as List)[0]['draft'] = 'x' * 4001,
      (v) => (v['threads'] as List)[1]['messages'][0]['id'] =
          (v['threads'] as List)[0]['messages'][0]['id'],
      (v) => (v['threads'] as List)[0]['messages'] = List.generate(
        101,
        (i) => _message('limit-$i', 'user').toJson(),
      ),
      (v) => v['threads'] = List.generate(
        maxAssistantThreads + 1,
        (_) => (jsonDecode(jsonEncode(valid['threads'])) as List).first,
      ),
    ];
    for (var i = 0; i < mutations.length; i++) {
      final value = jsonDecode(jsonEncode(valid)) as Map<String, dynamic>;
      mutations[i](value);
      expect(
        () => WorkspaceData.fromJson(value),
        throwsFormatException,
        reason: 'Mutation $i must be rejected',
      );
    }
  });

  test('serializer never carries unknown credential metadata into backups', () {
    const secret = 'credential-sentinel-never-back-up';
    final input = _workspace()
        .copyWith(
          threads: [
            _thread('one', 'general', messages: [_message('safe', 'user')]),
          ],
        )
        .toJson();
    input['token'] = secret;
    input['password'] = secret;
    (input['threads'] as List).first['apiKey'] = secret;
    (input['threads'] as List).first['messages'][0]['accessToken'] = secret;
    final exported = jsonEncode(WorkspaceData.fromJson(input).toJson());
    expect(exported, isNot(contains(secret)));
  });

  test(
    'drafts and histories stay with their captured object and mode',
    () async {
      final repository = MemoryWorkspaceRepository(_workspace());
      final store = WorkspaceStore(repository, initialData: _workspace());
      addTearDown(store.dispose);
      var notifications = 0;
      store.addListener(() => notifications++);
      final first = store.activeAssistantThread;
      expect(store.activeAssistantThread.id, first.id);
      store.updateAssistantDraft('Вопрос первого объекта');
      expect(notifications, greaterThan(0));
      store.updateAssistant(mode: 'estimate');
      expect(store.assistantDraft, isEmpty);
      store.updateAssistantDraft('Смета первого объекта');
      await store.selectProject('two');
      store.updateAssistantDraft('Смета второго объекта');
      expect(
        await store.appendAssistantMessage(
          projectId: 'one',
          mode: 'general',
          message: _message('late-answer', 'assistant'),
          expectedThreadId: first.id,
        ),
        isTrue,
      );
      expect(store.activeProject!.id, 'two');
      expect(store.assistantMode, 'estimate');
      expect(store.assistantDraft, 'Смета второго объекта');
      expect(
        store.assistantThreadFor('one', 'general').draft,
        'Вопрос первого объекта',
      );
      expect(
        store.assistantThreadFor('one', 'general').messages.single.id,
        'late-answer',
      );
      expect(store.assistantThreadFor('one', 'estimate').messages, isEmpty);

      final reloaded = WorkspaceStore(repository);
      addTearDown(reloaded.dispose);
      await reloaded.initialize();
      expect(reloaded.assistantThreadFor('one', 'general').id, first.id);
      expect(reloaded.assistantDraft, 'Смета второго объекта');
    },
  );

  test(
    'clearing replaces thread identity and rejects a late old reply',
    () async {
      final store = WorkspaceStore(
        MemoryWorkspaceRepository(),
        initialData: _workspace(),
      );
      addTearDown(store.dispose);
      final old = store.activeAssistantThread;
      store.updateAssistantDraft('Старый вопрос');
      expect(
        await store.clearAssistantThread(
          projectId: 'one',
          mode: 'general',
          expectedThreadId: old.id,
        ),
        isTrue,
      );
      expect(store.activeAssistantThread.id, isNot(old.id));
      expect(store.assistantDraft, isEmpty);
      expect(
        await store.appendAssistantMessage(
          projectId: 'one',
          mode: 'general',
          expectedThreadId: old.id,
          message: _message('stale', 'assistant'),
        ),
        isFalse,
      );
      expect(store.activeAssistantThread.messages, isEmpty);
    },
  );

  test(
    'targeted draft completion preserves a new draft and current selection',
    () async {
      final store = WorkspaceStore(
        MemoryWorkspaceRepository(),
        initialData: _workspace(),
      );
      addTearDown(store.dispose);
      store.updateAssistantDraft('Отправлено');
      final old = store.activeAssistantThread;
      store.updateAssistantDraft('Уже новый текст');
      await store.selectProject('two');
      store.updateAssistant(
        mode: 'engineering',
        question: 'Текущий другой вопрос',
      );
      expect(
        store.updateAssistantDraftFor(
          projectId: 'one',
          mode: 'general',
          text: '',
          expectedThreadId: old.id,
          expectedDraft: 'Отправлено',
        ),
        isFalse,
      );
      expect(
        store.assistantThreadFor('one', 'general').draft,
        'Уже новый текст',
      );
      expect(
        store.updateAssistantDraftFor(
          projectId: 'one',
          mode: 'general',
          text: '',
          expectedThreadId: old.id,
          expectedDraft: 'Уже новый текст',
        ),
        isTrue,
      );
      expect(store.activeProject!.id, 'two');
      expect(store.assistantMode, 'engineering');
      expect(store.assistantDraft, 'Текущий другой вопрос');
    },
  );

  test('a failed new-dialog save restores the previous conversation', () async {
    final original = _thread(
      'one',
      'general',
      draft: 'Не терять',
      messages: [_message('history', 'assistant')],
    );
    final initial = _workspace().copyWith(threads: [original]);
    final repository = MemoryWorkspaceRepository(initial)..failWrites = true;
    final store = WorkspaceStore(repository, initialData: initial);
    addTearDown(store.dispose);
    expect(
      await store.clearAssistantThread(
        projectId: 'one',
        mode: 'general',
        expectedThreadId: original.id,
      ),
      isFalse,
    );
    expect(store.activeAssistantThread.toJson(), original.toJson());
    expect(repository.data!.threads.single.toJson(), original.toJson());
    expect(store.error, isNotNull);
  });

  test(
    'explicit global clear never targets the currently selected object',
    () async {
      final global = _thread(
        null,
        'general',
        messages: [_message('global', 'user')],
      );
      final object = _thread(
        'one',
        'general',
        messages: [_message('object', 'assistant')],
      );
      final initial = _workspace().copyWith(threads: [global, object]);
      final store = WorkspaceStore(
        MemoryWorkspaceRepository(initial),
        initialData: initial,
      );
      addTearDown(store.dispose);
      expect(
        await store.clearAssistantThread(
          projectId: null,
          mode: 'general',
          expectedThreadId: global.id,
        ),
        isTrue,
      );
      expect(store.activeProject!.id, 'one');
      expect(store.activeAssistantThread.id, object.id);
      expect(store.activeAssistantThread.messages.single.id, 'object');
      expect(store.assistantThreadFor(null, 'general').messages, isEmpty);
      expect(store.assistantThreadFor(null, 'general').id, isNot(global.id));
    },
  );

  test(
    'failed message write preserves the same in-memory turn for save retry',
    () async {
      final repository = MemoryWorkspaceRepository(_workspace())
        ..failWrites = true;
      final store = WorkspaceStore(repository, initialData: _workspace());
      addTearDown(store.dispose);
      final thread = store.activeAssistantThread;
      final question = _message('not-saved-yet', 'user');
      expect(
        await store.appendAssistantMessage(
          projectId: 'one',
          mode: 'general',
          message: question,
          expectedThreadId: thread.id,
        ),
        isFalse,
      );
      expect(store.activeAssistantThread.messages.single.id, question.id);
      expect(store.hasUnsavedChanges, isTrue);
      expect(store.error, isNotNull);
      expect(repository.data!.threads, isEmpty);
      repository.failWrites = false;
      expect(await store.saveNow(), isTrue);
      expect(repository.data!.threads.single.messages.single.id, question.id);
      expect(store.hasUnsavedChanges, isFalse);
    },
  );

  test(
    'message bound rejects additions without silently discarding history',
    () async {
      final messages = List.generate(100, (i) => _message('entry-$i', 'user'));
      final initial = _workspace().copyWith(
        threads: [_thread('one', 'general', messages: messages)],
      );
      final store = WorkspaceStore(
        MemoryWorkspaceRepository(initial),
        initialData: initial,
      );
      addTearDown(store.dispose);
      expect(
        await store.appendAssistantMessage(
          projectId: 'one',
          mode: 'general',
          message: _message('too-many', 'assistant'),
        ),
        isFalse,
      );
      expect(
        store.activeAssistantThread.messages.map((m) => m.id),
        messages.map((m) => m.id),
      );
      expect(store.error, contains('100'));
    },
  );

  test('import remaps every object, dialog and message and preserves globals separately', () async {
    final localGlobal = _thread(
      null,
      'general',
      messages: [_message('local', 'user')],
    );
    final initial = _workspace().copyWith(threads: [localGlobal]);
    final repository = MemoryWorkspaceRepository(initial);
    final store = WorkspaceStore(repository, initialData: initial);
    addTearDown(store.dispose);
    final incoming = WorkspaceData(
      projects: [ProjectModel(id: 'one', name: 'Входящий объект')],
      activeProjectId: 'one',
      threads: [
        _thread(
          'one',
          'estimate',
          draft: 'Исходные данные',
          messages: [_message('source-object', 'assistant')],
        ),
        _thread(null, 'general', messages: [_message('source-global', 'user')]),
      ],
    );
    expect(await store.importCopies(jsonEncode(incoming.toJson())), 2);
    final copy = store.data.projects.singleWhere(
      (p) => p.name == 'Входящий объект · копия',
    );
    final globalsCopy = store.data.projects.singleWhere(
      (p) => p.name == 'Общие диалоги · копия',
    );
    expect(copy.id, isNot('one'));
    final thread = store.assistantThreadFor(copy.id, 'estimate');
    expect(thread.draft, 'Исходные данные');
    expect(thread.id, isNot(incoming.threads.first.id));
    expect(thread.messages.single.id, isNot('source-object'));
    expect(thread.messages.single.content, 'source-object');
    expect(
      store.assistantThreadFor(null, 'general').messages.single.id,
      'local',
    );
    final importedGlobal = store.assistantThreadFor(globalsCopy.id, 'general');
    expect(importedGlobal.messages.single.content, 'source-global');
    expect(globalsCopy.workType, 'other');
    expect(WorkspaceData.fromJson(store.data.toJson()).threads, hasLength(3));
    expect(repository.data!.threads, hasLength(3));
  });

  test('invalid history import leaves current workspace untouched', () async {
    final initial = _workspace();
    final store = WorkspaceStore(
      MemoryWorkspaceRepository(initial),
      initialData: initial,
    );
    addTearDown(store.dispose);
    final original = store.exportJson();
    final incoming = _workspace()
        .copyWith(threads: [_thread('one', 'general')])
        .toJson();
    (incoming['threads'] as List).first['projectId'] = 'missing';
    await expectLater(
      store.importCopies(jsonEncode(incoming)),
      throwsFormatException,
    );
    expect(store.exportJson(), original);
  });
}

WorkspaceData _workspace() => WorkspaceData(
  projects: [
    ProjectModel(id: 'one', name: 'Первый объект'),
    ProjectModel(id: 'two', name: 'Второй объект'),
  ],
  activeProjectId: 'one',
);

AssistantThread _thread(
  String? projectId,
  String mode, {
  String draft = '',
  List<ChatMessage> messages = const [],
}) => AssistantThread(
  id: 'thread-${projectId ?? 'global'}-$mode',
  projectId: projectId,
  mode: mode,
  draft: draft,
  messages: messages,
);

ChatMessage _message(String id, String role) => ChatMessage(
  id: id,
  role: role,
  content: id,
  createdAt: DateTime.utc(2026, 10, 26),
);
