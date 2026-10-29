import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/workspace.dart';
import 'assistant_client.dart';
import 'workspace_store.dart';

class AssistantController extends ChangeNotifier {
  AssistantController({required this.store, required this.api});
  final WorkspaceStore store;
  final NativeAssistantApi api;
  NativeSession? _session;
  bool signingIn = false, sending = false, _disposed = false;
  int _authRevision = 0;
  Timer? _expiryTimer;
  String? error, info;
  bool get authenticated => _session != null && !_session!.expired;
  DateTime? get expiresAt => _session?.expiresAt;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> signIn(String password) async {
    if (signingIn || _disposed) return;
    if (password.isEmpty || password.length > 1000) {
      error = 'Введите пароль помощника.';
      _notify();
      return;
    }
    final revision = ++_authRevision;
    signingIn = true;
    error = null;
    info = null;
    _notify();
    try {
      final session = await api.signIn(password);
      if (_disposed || revision != _authRevision) return;
      _session = session;
      _expiryTimer?.cancel();
      _expiryTimer = Timer(session.expiresAt.difference(DateTime.now()), () {
        _session = null;
        _authRevision++;
        info = 'Срок входа истёк. Войдите снова, чтобы продолжить диалог.';
        _notify();
      });
    } on AssistantApiException catch (e) {
      if (!_disposed && revision == _authRevision) {
        error = e.message;
      }
    } catch (_) {
      if (!_disposed && revision == _authRevision) {
        error = 'Не удалось войти. Повторите попытку.';
      }
    } finally {
      if (!_disposed && revision == _authRevision) {
        signingIn = false;
        _notify();
      }
    }
  }

  Future<void> signOut() async {
    _authRevision++;
    _session = null;
    _expiryTimer?.cancel();
    signingIn = false;
    error = null;
    info = 'Вы вышли. Диалоги сохранены на устройстве.';
    _notify();
  }

  void clearError() {
    error = null;
    info = null;
    _notify();
  }

  Future<void> newConversation() async {
    if (sending || _disposed) return;
    final thread = store.activeAssistantThread;
    if (await store.clearAssistantThread(
      projectId: thread.projectId,
      mode: thread.mode,
      expectedThreadId: thread.id,
    )) {
      error = null;
      info = null;
    } else {
      error =
          'Не удалось сохранить новый диалог. Предыдущая история сохранена.';
    }
    _notify();
  }

  Future<void> send() async {
    if (sending || _disposed || !store.ready) return;
    final session = _session;
    if (session == null || session.expired) {
      error = 'Войдите в помощник, чтобы отправить вопрос.';
      _notify();
      return;
    }
    final thread = store.activeAssistantThread;
    final question = thread.draft.trim();
    if (question.isEmpty) {
      error = 'Напишите вопрос.';
      _notify();
      return;
    }
    final project = store.data.projects
        .where((p) => p.id == thread.projectId)
        .firstOrNull;
    final revision = _authRevision;
    final originalDraft = thread.draft;
    final lastMessage = thread.messages.lastOrNull;
    final reuse =
        lastMessage?.role == 'user' && lastMessage?.content == question;
    if (thread.messages.length >= (reuse ? 100 : 99)) {
      error =
          'Этот диалог заполнен. Скопируйте нужные ответы и очистите диалог.';
      _notify();
      return;
    }
    final pending = reuse
        ? _PendingQuestion(question, lastMessage!)
        : _PendingQuestion(
            question,
            ChatMessage(
              id: newId(),
              role: 'user',
              content: question,
              createdAt: DateTime.now(),
            ),
          );
    final history = boundedHistory(
      thread.messages.where((m) => m.id != pending.message.id).toList(),
    );
    sending = true;
    error = null;
    info = null;
    _notify();
    try {
      final saved = reuse
          ? await store.saveNow()
          : await store.appendAssistantMessage(
              projectId: thread.projectId,
              mode: thread.mode,
              message: pending.message,
              expectedThreadId: thread.id,
            );
      if (_disposed || revision != _authRevision) return;
      if (!saved) {
        error = 'Вопрос не сохранён на устройстве. Освободите место и повторите отправку.';
        return;
      }
      if (_disposed || revision != _authRevision) return;
      final response = await api.chat(
        session,
        NativeChatRequest(
          message: question,
          mode: thread.mode,
          history: history,
          projectContext: _projectContext(project),
        ),
      );
      if (_disposed || revision != _authRevision) return;
      final current = store.assistantThreadFor(thread.projectId, thread.mode);
      if (current.id != thread.id) return;
      final reply = ChatMessage(
        id: newId(),
        role: 'assistant',
        content: response.text,
        createdAt: DateTime.now(),
      );
      final persisted = await store.appendAssistantMessage(
        projectId: thread.projectId,
        mode: thread.mode,
        message: reply,
        expectedThreadId: thread.id,
        clearDraftIfMatches: originalDraft,
      );
      if (_disposed || revision != _authRevision) return;
      if (!persisted) {
        error = 'Ответ получен, но пока не сохранён на диске. Скопируйте его или повторите сохранение в настройках.';
      } else if (store.activeAssistantThread.id != thread.id) {
        info = 'Ответ сохранён в исходном объекте и направлении.';
      }
    } on AssistantApiException catch (e) {
      if (_disposed || revision != _authRevision) return;
      if (e.statusCode == 401) {
        _session = null;
        _expiryTimer?.cancel();
      }
      error = e.message;
    } catch (_) {
      if (!_disposed && revision == _authRevision) {
        error =
            'Не удалось получить ответ. Вопрос сохранён; повторите отправку.';
      }
    } finally {
      if (!_disposed) {
        sending = false;
        _notify();
      }
    }
  }

  static List<NativeHistoryMessage> boundedHistory(List<ChatMessage> messages) {
    final selected = <NativeHistoryMessage>[];
    var bytes = 0;
    for (final message in messages.reversed.take(16)) {
      final text = message.content.length <= 20000
          ? message.content
          : '${message.content.substring(0, 19930)}\n[Длинное сообщение сокращено для контекста.]';
      final size = utf8.encode(text).length;
      if (bytes + size > 160 * 1024) break;
      selected.add(NativeHistoryMessage(message.role, text));
      bytes += size;
    }
    return selected.reversed.toList(growable: false);
  }

  static Map<String, dynamic>? _projectContext(ProjectModel? project) {
    if (project == null) return null;
    final calculation = project.calculations.lastOrNull;
    return {
      'name': project.name,
      if (project.address.isNotEmpty) 'address': project.address,
      if (calculation != null) 'savedCalculation': calculation.result.toJson(),
    };
  }

  @override
  void dispose() {
    _disposed = true;
    _authRevision++;
    _expiryTimer?.cancel();
    _session = null;
    api.close();
    super.dispose();
  }
}

class _PendingQuestion {
  const _PendingQuestion(this.question, this.message);
  final String question;
  final ChatMessage message;
}
