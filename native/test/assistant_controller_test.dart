import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/models/workspace.dart';
import 'package:svoi_lyudi_native/services/assistant_client.dart';
import 'package:svoi_lyudi_native/services/assistant_controller.dart';
import 'package:svoi_lyudi_native/services/workspace_store.dart';

class FakeApi implements NativeAssistantApi {
  final calls = <NativeChatRequest>[];
  final called = Completer<void>();
  Future<NativeChatReply> Function()? answer;
  @override
  Future<NativeSession> signIn(String password) async => NativeSession(
    accessToken: 'native-session-only-in-memory',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
  );
  @override
  Future<NativeChatReply> chat(
    NativeSession session,
    NativeChatRequest request,
  ) async {
    calls.add(request);
    if (!called.isCompleted) called.complete();
    return answer == null ? const NativeChatReply('Ответ') : await answer!();
  }

  @override
  void close() {}
}

void main() {
  late MemoryWorkspaceRepository repository;
  late WorkspaceStore store;
  late FakeApi api;
  late AssistantController controller;
  setUp(() {
    repository = MemoryWorkspaceRepository();
    store = WorkspaceStore(repository, initialData: WorkspaceData.demo());
    api = FakeApi();
    controller = AssistantController(store: store, api: api);
  });
  tearDown(() {
    controller.dispose();
    store.dispose();
  });

  test(
    'credentials never enter workspace or backup; question remains exact',
    () async {
      await controller.signIn('private-owner-password');
      store.updateAssistant(
        mode: 'facade',
        question: 'А теперь без утепления?',
      );
      await controller.send();
      final request = api.calls.single;
      expect(request.message, 'А теперь без утепления?');
      expect(request.mode, 'facade');
      expect(request.projectContext?['name'], 'Дом с новым фасадом');
      expect(store.activeAssistantThread.messages.map((m) => m.role), [
        'user',
        'assistant',
      ]);
      expect(store.activeAssistantThread.draft, '');
      final json = store.exportJson();
      expect(json, isNot(contains('private-owner-password')));
      expect(json, isNot(contains('native-session-only-in-memory')));
    },
  );

  test('late answer stays with captured object and mode', () async {
    final response = Completer<NativeChatReply>();
    api.answer = () => response.future;
    await controller.signIn('owner');
    store.updateAssistant(mode: 'facade', question: 'Фасад первого дома');
    final sending = controller.send();
    await api.called.future;
    await store.selectProject('demo-cottage');
    store.updateAssistant(mode: 'engineering', question: 'Другой вопрос');
    response.complete(const NativeChatReply('Ответ про первый фасад'));
    await sending;
    final original = store.assistantThreadFor('demo-house', 'facade');
    expect(original.messages.last.content, 'Ответ про первый фасад');
    expect(original.draft, '');
    expect(store.activeAssistantThread.projectId, 'demo-cottage');
    expect(store.activeAssistantThread.mode, 'engineering');
    expect(store.activeAssistantThread.draft, 'Другой вопрос');
    expect(store.activeAssistantThread.messages, isEmpty);
  });

  test('new text typed while waiting is not cleared', () async {
    final response = Completer<NativeChatReply>();
    api.answer = () => response.future;
    await controller.signIn('owner');
    store.updateAssistantDraft('Первый вопрос');
    final sending = controller.send();
    await api.called.future;
    store.updateAssistantDraft('Следующий вопрос');
    response.complete(const NativeChatReply('Первый ответ'));
    await sending;
    expect(store.activeAssistantThread.draft, 'Следующий вопрос');
    expect(store.activeAssistantThread.messages.length, 2);
  });

  test(
    'manual retry after network failure reuses the saved user turn',
    () async {
      api.answer = () async => throw const AssistantApiException('Нет сети');
      await controller.signIn('owner');
      store.updateAssistantDraft('Не потерять вопрос');
      await controller.send();
      expect(store.activeAssistantThread.messages.length, 1);
      expect(store.activeAssistantThread.draft, 'Не потерять вопрос');
      api.answer = () async => const NativeChatReply('Получилось');
      await controller.send();
      expect(api.calls.length, 2);
      expect(api.calls.last.history, isEmpty);
      expect(store.activeAssistantThread.messages.length, 2);
    },
  );

  test(
    'failed local save stops the API; retry does not duplicate question',
    () async {
      await controller.signIn('owner');
      repository.failWrites = true;
      store.updateAssistantDraft('Сохранить перед отправкой');
      await controller.send();
      expect(api.calls, isEmpty);
      expect(store.activeAssistantThread.messages.length, 1);
      expect(store.hasUnsavedChanges, isTrue);
      repository.failWrites = false;
      await controller.send();
      expect(api.calls.length, 1);
      expect(store.activeAssistantThread.messages.length, 2);
    },
  );

  test(
    'logout discards an in-flight answer without deleting local question',
    () async {
      final response = Completer<NativeChatReply>();
      api.answer = () => response.future;
      await controller.signIn('owner');
      store.updateAssistantDraft('Вопрос до выхода');
      final sending = controller.send();
      await api.called.future;
      await controller.signOut();
      response.complete(const NativeChatReply('Поздний ответ'));
      await sending;
      expect(controller.authenticated, isFalse);
      expect(controller.sending, isFalse);
      expect(store.activeAssistantThread.messages.length, 1);
      expect(store.activeAssistantThread.draft, 'Вопрос до выхода');
    },
  );

  test(
    'clearing a thread prevents a late reply from recreating old history',
    () async {
      final response = Completer<NativeChatReply>();
      api.answer = () => response.future;
      await controller.signIn('owner');
      store.updateAssistantDraft('Старый вопрос');
      final old = store.activeAssistantThread;
      final sending = controller.send();
      await api.called.future;
      await store.clearAssistantThread(
        projectId: old.projectId,
        mode: old.mode,
        expectedThreadId: old.id,
      );
      response.complete(const NativeChatReply('Старый ответ'));
      await sending;
      expect(store.activeAssistantThread.id, isNot(old.id));
      expect(store.activeAssistantThread.messages, isEmpty);
    },
  );

  test('unauthorized reply requires login again and preserves draft', () async {
    api.answer = () async =>
        throw const AssistantApiException('Войдите снова', statusCode: 401);
    await controller.signIn('owner');
    store.updateAssistantDraft('Мой вопрос');
    await controller.send();
    expect(controller.authenticated, isFalse);
    expect(store.activeAssistantThread.draft, 'Мой вопрос');
  });

  test(
    'restart retries the saved unanswered question without duplication',
    () async {
      api.answer = () async => throw const AssistantApiException('Нет сети');
      await controller.signIn('owner');
      store.updateAssistantDraft('Вопрос переживёт перезапуск');
      await controller.send();
      await store.saveNow();
      controller.dispose();
      store.dispose();
      store = WorkspaceStore(repository, initialData: repository.data!);
      api = FakeApi();
      controller = AssistantController(store: store, api: api);
      await controller.signIn('owner');
      await controller.send();
      expect(store.activeAssistantThread.messages.map((m) => m.role), [
        'user',
        'assistant',
      ]);
      expect(api.calls.single.history, isEmpty);
      expect(repository.data!.threads.single.draft, '');
    },
  );

  test(
    'retry finishes the last available turn at the 100-message limit',
    () async {
      final original = store.activeAssistantThread;
      store.data = store.data.copyWith(
        threads: [
          original.copyWith(
            messages: List.generate(
              98,
              (i) => ChatMessage(
                id: 'message-$i',
                role: i.isEven ? 'user' : 'assistant',
                content: 'Предыдущий текст $i',
                createdAt: DateTime.now(),
              ),
            ),
          ),
        ],
      );
      api.answer = () async => throw const AssistantApiException('Нет сети');
      await controller.signIn('owner');
      store.updateAssistantDraft('Последний вопрос');
      await controller.send();
      expect(store.activeAssistantThread.messages.length, 99);
      api.answer = () async => const NativeChatReply('Последний ответ');
      await controller.send();
      expect(store.activeAssistantThread.messages.length, 100);
      expect(
        store.activeAssistantThread.messages.last.content,
        'Последний ответ',
      );
      expect(repository.data!.threads.single.draft, '');
    },
  );

  test('context history obeys UTF8, count and per-message server limits', () {
    final messages = List.generate(
      25,
      (i) => ChatMessage(
        id: '$i',
        role: i.isEven ? 'user' : 'assistant',
        content: 'я' * 30000,
        createdAt: DateTime.now(),
      ),
    );
    final selected = AssistantController.boundedHistory(messages);
    expect(selected.length, lessThanOrEqualTo(16));
    expect(selected.every((m) => m.content.length <= 20000), isTrue);
    expect(
      selected.fold<int>(0, (n, m) => n + utf8.encode(m.content).length),
      lessThanOrEqualTo(160 * 1024),
    );
  });
}
