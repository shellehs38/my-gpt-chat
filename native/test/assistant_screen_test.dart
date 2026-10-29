import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/models/workspace.dart';
import 'package:svoi_lyudi_native/screens/assistant_screen.dart';
import 'package:svoi_lyudi_native/services/assistant_client.dart';
import 'package:svoi_lyudi_native/services/assistant_controller.dart';
import 'package:svoi_lyudi_native/services/workspace_store.dart';
import 'package:svoi_lyudi_native/theme.dart';

class MockNativeAssistantApi implements NativeAssistantApi {
  final List<String> passwords = [];
  final List<NativeChatRequest> requests = [];
  AssistantApiException? loginError;
  static const reply =
      '<script>alert("обычный текст")</script>\nПроверьте размеры по проекту.';

  @override
  Future<NativeSession> signIn(String password) async {
    passwords.add(password);
    if (loginError != null) throw loginError!;
    return NativeSession(
      accessToken: 'private-test-session-token',
      expiresAt: DateTime.now().add(const Duration(hours: 12)),
    );
  }

  @override
  Future<NativeChatReply> chat(
    NativeSession session,
    NativeChatRequest request,
  ) async {
    requests.add(request);
    return const NativeChatReply(reply);
  }

  @override
  void close() {}
}

Future<void> reveal(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final font = FontLoader('DejaVu')
      ..addFont(rootBundle.load('assets/fonts/DejaVuSans.ttf'))
      ..addFont(rootBundle.load('assets/fonts/DejaVuSans-Bold.ttf'));
    await font.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  for (final size in [const Size(390, 844), const Size(1440, 1000)]) {
    testWidgets(
      'assistant at ${size.width.toInt()}px logs in and sends selected direction with object context',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = size;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final store = WorkspaceStore(
          MemoryWorkspaceRepository(),
          initialData: WorkspaceData.demo(),
        );
        final api = MockNativeAssistantApi();
        final controller = AssistantController(store: store, api: api);
        addTearDown(controller.dispose);
        addTearDown(store.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: constructionTheme(),
            home: Scaffold(
              body: AssistantScreen(store: store, controller: controller),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        final password = find.byKey(const ValueKey('assistant-password'));
        await reveal(tester, password);
        await tester.enterText(password, 'owner-test-password');
        final login = find.byKey(const ValueKey('assistant-sign-in'));
        await reveal(tester, login);
        await tester.tap(login);
        await tester.pumpAndSettle();
        expect(api.passwords, ['owner-test-password']);
        expect(controller.authenticated, isTrue);
        expect(password, findsNothing);

        final mode = find.byKey(const ValueKey('assistant-mode-general'));
        await reveal(tester, mode);
        await tester.tap(mode);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Фасады').last);
        await tester.pumpAndSettle();
        expect(store.data.assistantMode, 'facade');

        final question = find.byKey(const ValueKey('assistant-question'));
        await reveal(tester, question);
        await tester.enterText(question, 'Какие замеры нужны для сайдинга?');
        final send = find.byKey(const ValueKey('assistant-send'));
        await reveal(tester, send);
        await tester.tap(send);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(api.requests, hasLength(1));
        expect(api.requests.single.mode, 'facade');
        expect(api.requests.single.message, 'Какие замеры нужны для сайдинга?');
        expect(
          api.requests.single.projectContext?['name'],
          'Дом с новым фасадом',
        );
        expect(api.requests.single.history, isEmpty);
        expect(store.activeAssistantThread.messages, hasLength(2));
        expect(store.activeAssistantThread.draft, isEmpty);
        expect(tester.widget<TextField>(question).controller!.text, isEmpty);
        // Model output remains selectable literal text, including HTML-looking input.
        expect(
          tester
              .widgetList<SelectableText>(find.byType(SelectableText))
              .any((widget) => widget.data == MockNativeAssistantApi.reply),
          isTrue,
        );
        expect(store.exportJson(), isNot(contains('owner-test-password')));
        expect(
          store.exportJson(),
          isNot(contains('private-test-session-token')),
        );

        final clear = find.byKey(const ValueKey('assistant-new-conversation'));
        await reveal(tester, clear);
        expect(find.text('Очистить этот диалог'), findsOneWidget);
        expect(
          find.text('Сообщения этого диалога будут удалены с устройства.'),
          findsOneWidget,
        );
        await tester.tap(clear);
        await tester.pumpAndSettle();
        expect(store.activeAssistantThread.messages, isEmpty);
        expect(tester.takeException(), isNull);
        await controller.signOut();
        await store.saveNow();
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('failed login clears password and keeps the local question', (
    tester,
  ) async {
    final store = WorkspaceStore(
      MemoryWorkspaceRepository(),
      initialData: WorkspaceData.demo(),
    );
    store.updateAssistantDraft('Локальный черновик вопроса');
    final api = MockNativeAssistantApi()
      ..loginError = const AssistantApiException(
        'Неверный пароль.',
        statusCode: 401,
      );
    final controller = AssistantController(store: store, api: api);
    addTearDown(controller.dispose);
    addTearDown(store.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: constructionTheme(),
        home: Scaffold(
          body: AssistantScreen(store: store, controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final password = find.byKey(const ValueKey('assistant-password'));
    await reveal(tester, password);
    await tester.enterText(password, 'incorrect-test-password');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(controller.authenticated, isFalse);
    expect(tester.widget<TextField>(password).controller!.text, isEmpty);
    expect(find.text('Неверный пароль.'), findsOneWidget);
    expect(store.activeAssistantThread.draft, 'Локальный черновик вопроса');
    expect(api.requests, isEmpty);
    expect(tester.takeException(), isNull);
    await store.saveNow();
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
