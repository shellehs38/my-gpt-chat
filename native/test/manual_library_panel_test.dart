import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:svoi_lyudi_native/screens/manual_library_panel.dart';
import 'package:svoi_lyudi_native/screens/pdf_document_screen.dart';
import 'package:svoi_lyudi_native/services/manual_library.dart';
import 'package:svoi_lyudi_native/theme.dart';

Uint8List _pdf(String name) =>
    Uint8List.fromList(utf8.encode('%PDF-1.7\n$name'));

Widget _host(Widget child) => MaterialApp(
  theme: constructionTheme(),
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

Future<ManualLibrary> _library() async {
  // Create the queue and its futures inside the widget test's fake-async zone.
  final library = ManualLibrary(MemoryManualRepository());
  addTearDown(library.dispose);
  await library.initialize();
  return library;
}

class _FakePage implements PdfPage {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeDocument implements PdfDocument {
  @override
  final List<PdfPage> pages = List.generate(3, (_) => _FakePage());
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _DamagedRepository extends MemoryManualRepository {
  @override
  Future<List<ManualRecord>> readRecords() async =>
      throw const FormatException('PRIVATE_FILE_DIAGNOSTICS');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final width in [390.0, 1440.0]) {
    testWidgets(
      'manual panel at $width imports, opens natively and removes attachment',
      (tester) async {
        final library = await _library();
        tester.view.physicalSize = Size(width, 1100);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var rendererUsed = false;
        await tester.pumpWidget(
          _host(
            ManualLibraryPanel(
              library: library,
              profileId: 'first',
              profileName: 'Выбранная коллекция',
              sources: [
                ManualDownloadSource(
                  title: 'Недоступный источник',
                  url: Uri.parse(
                    'https://manufacturer.example/instruction.pdf',
                  ),
                  downloadable: false,
                ),
              ],
              picker: () async => ManualPickedPdf(
                fileName: 'Моя инструкция.pdf',
                bytes: _pdf('user manual'),
              ),
              pdfViewerBuilder: (context, bytes, controller, params) {
                rendererUsed = true;
                expect(params.linkHandlerParams, isNull);
                expect(bytes, orderedEquals(_pdf('user manual')));
                return const Center(child: Text('Нативный PDF-просмотр'));
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('manual-library-empty')),
          findsOneWidget,
        );
        expect(
          tester
              .widget<TextButton>(
                find.byKey(const ValueKey('manual-download-0')),
              )
              .onPressed,
          isNull,
        );
        await tester.tap(find.byKey(const ValueKey('manual-import-pdf')));
        await tester.pumpAndSettle();
        final record = library.recordsFor('first').single;
        expect(record.origin, 'user');
        expect(find.textContaining('Добавлено вами'), findsOneWidget);
        await tester.ensureVisible(
          find.byKey(ValueKey('manual-open-${record.id}')),
        );
        await tester.tap(find.byKey(ValueKey('manual-open-${record.id}')));
        await tester.pumpAndSettle();
        expect(find.byType(PdfDocumentScreen), findsOneWidget);
        expect(find.text('Нативный PDF-просмотр'), findsOneWidget);
        expect(rendererUsed, isTrue);
        await tester.pageBack();
        await tester.pumpAndSettle();
        await tester.ensureVisible(
          find.byKey(ValueKey('manual-remove-${record.id}')),
        );
        await tester.tap(find.byKey(ValueKey('manual-remove-${record.id}')));
        await tester.pumpAndSettle();
        expect(library.recordsFor('first'), isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('file picker completion attaches PDF to the captured profile', (
    tester,
  ) async {
    final library = await _library();
    final selection = Completer<ManualPickedPdf?>();
    Widget panel(String id, String name) => _host(
      ManualLibraryPanel(
        key: const ValueKey('manual-panel'),
        library: library,
        profileId: id,
        profileName: name,
        sources: const [],
        picker: () => selection.future,
      ),
    );
    await tester.pumpWidget(panel('first', 'Первый профиль'));
    await tester.tap(find.byKey(const ValueKey('manual-import-pdf')));
    await tester.pump();
    await tester.pumpWidget(panel('second', 'Второй профиль'));
    selection.complete(
      ManualPickedPdf(fileName: 'Первый.pdf', bytes: _pdf('first')),
    );
    await tester.pumpAndSettle();
    expect(library.recordsFor('first').length, 1);
    expect(library.recordsFor('second'), isEmpty);
    expect(
      find.text('PDF сохранён для профиля «Первый профиль».'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('invalid imported bytes show a safe error and add no record', (
    tester,
  ) async {
    final library = await _library();
    await tester.pumpWidget(
      _host(
        ManualLibraryPanel(
          library: library,
          profileId: 'first',
          profileName: 'Профиль',
          sources: const [],
          picker: () async => ManualPickedPdf(
            fileName: 'Ложный.pdf',
            bytes: Uint8List.fromList(utf8.encode('<html>not a PDF</html>')),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('manual-import-pdf')));
    await tester.pumpAndSettle();
    expect(library.recordsFor('first'), isEmpty);
    expect(find.textContaining('PDF', findRichText: true), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'damaged library disables changes and does not expose raw diagnostics',
    (tester) async {
      final damaged = ManualLibrary(_DamagedRepository());
      await damaged.initialize();
      addTearDown(damaged.dispose);
      await tester.pumpWidget(
        _host(
          ManualLibraryPanel(
            library: damaged,
            profileId: 'first',
            profileName: 'Профиль',
            sources: const [],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('manual-import-pdf')),
            )
            .onPressed,
        isNull,
      );
      expect(find.textContaining('Исходные файлы сохранены'), findsOneWidget);
      expect(find.textContaining('PRIVATE_FILE_DIAGNOSTICS'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('viewer clamps initial page and keeps PDF links disabled', (
    tester,
  ) async {
    var sent = false;
    await tester.pumpWidget(
      MaterialApp(
        home: PdfDocumentScreen(
          title: 'Точный раздел',
          bytes: _pdf('manual'),
          initialPage: 999,
          viewerBuilder: (context, bytes, controller, params) {
            expect(params.linkHandlerParams, isNull);
            if (!sent) {
              sent = true;
              WidgetsBinding.instance.addPostFrameCallback(
                (_) => params.onDocumentChanged!(_FakeDocument()),
              );
            }
            return const SizedBox();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Страница 3 из 3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('viewer error hides raw engine details and explains failure', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PdfDocumentScreen(
          title: 'Повреждённый файл',
          bytes: _pdf('bad'),
          viewerBuilder: (context, bytes, controller, params) =>
              params.errorBannerBuilder!(
                context,
                const FormatException('RAW_ENGINE_SECRET'),
                null,
                PdfDocumentRefData(bytes, sourceName: 'test'),
              ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Не удалось открыть PDF'), findsOneWidget);
    expect(find.text('PDF не открыт'), findsOneWidget);
    expect(find.textContaining('RAW_ENGINE_SECRET'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
