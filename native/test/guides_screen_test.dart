import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/screens/guides_screen.dart';
import 'package:svoi_lyudi_native/screens/manual_library_panel.dart';
import 'package:svoi_lyudi_native/services/manual_library.dart';

Future<void> settleGuides(WidgetTester tester) async {
  await tester.pump();
  for (var attempt = 0; attempt < 40; attempt++) {
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 40));
    });
    await tester.pump(const Duration(milliseconds: 40));
    if (find.byType(ManualLibraryPanel).evaluate().isNotEmpty) break;
  }
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ManualLibrary library;
  setUp(() async {
    rootBundle.clear();
    PaintingBinding.instance.imageCache.clear();
    PaintingBinding.instance.imageCache.clearLiveImages();
    library = ManualLibrary(MemoryManualRepository());
    await library.initialize();
  });
  tearDown(() => library.dispose());

  Future<void> mount(
    WidgetTester tester,
    String profile, {
    double width = 1440,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = Size(width, 1100);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GuidesScreen(initialProfileId: profile, manualLibrary: library),
        ),
      ),
    );
    await settleGuides(tester);
    expect(tester.takeException(), isNull);
  }

  test(
    'only the four applicable MP profiles point to the original bundled PDF',
    () async {
      final raw = jsonDecode(
        await rootBundle.loadString('assets/data/guide-catalog.json'),
      ) as Map<String, dynamic>;
      final profiles = (raw['categories'] as List)
          .expand((c) => c['profiles'] as List)
          .cast<Map<String, dynamic>>();
      final linked = {
        for (final p in profiles)
          if (p['manual'] != null) p['id']: (p['manual'] as Map)['page'],
      };
      expect(linked, {
        'mp-shipboard-226-manual': 17,
        'mp-lbrus-240': 19,
        'mp-lbrus-xl-335': 20,
        'metallprofil-woodstock': 21,
      });
      for (final profile in profiles.where((p) => p['manual'] != null)) {
        expect(profile['manufacturer'], 'Металл Профиль');
        expect(profile['manual']['pdf'], 'assets/manual/manual.pdf');
        final bytes = await rootBundle.load(profile['manual']['pdf'] as String);
        expect(
          ascii.decode(bytes.buffer.asUint8List(bytes.offsetInBytes, 5)),
          '%PDF-',
        );
      }
      final local = profiles
          .expand((p) => p['sources'] as List)
          .where((s) => (s['url'] as String).startsWith('assets/'));
      expect(local.single['url'], 'assets/manual/manual.pdf');
    },
  );

  for (final width in [390.0, 1440.0]) {
    testWidgets(
      'custom profile has no verified-source or MP illustration claim at ${width.toInt()}px',
      (tester) async {
        await mount(tester, 'custom-shipboard', width: width);
        expect(find.text('Памятка · источник не указан'), findsWidgets);
        expect(find.byType(ChoiceChip), findsNothing);
        expect(find.byType(Image), findsNothing);
        expect(find.text('ЭТАП 3 ИЗ 5'), findsNothing);
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('guide-card-custom-shipboard')),
            matching: find.text('Памятка выбрана'),
          ),
          findsOneWidget,
        );
        final panel = tester.widget<ManualLibraryPanel>(
          find.byType(ManualLibraryPanel),
        );
        expect(panel.profileId, 'custom-shipboard');
        expect(panel.sources, isEmpty);
        expect(find.text('Добавленных PDF пока нет.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'only actual PDF links become download candidates and query strings survive',
    (tester) async {
      await mount(tester, 'alta-vinyl-canada-prestige');
      var panel = tester.widget<ManualLibraryPanel>(
        find.byType(ManualLibraryPanel),
      );
      expect(panel.sources.length, 1);
      expect(
        panel.sources.single.url.path,
        endsWith('inst_montazh_siding_i_paneli.pdf'),
      );
      expect(panel.sources.single.downloadable, isTrue);
      expect(panel.library.records, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      await mount(tester, 'cedral-lap');
      panel = tester.widget<ManualLibraryPanel>(
        find.byType(ManualLibraryPanel),
      );
      expect(panel.sources.length, 2);
      expect(panel.sources.first.url.query, 'v=4a1d92');
      expect(
        panel.sources.every((source) => source.url.scheme == 'https'),
        isTrue,
      );
      expect(panel.library.records, isEmpty);
    },
  );

  testWidgets(
    'profile PDF count updates live without changing catalog evidence',
    (tester) async {
      await mount(tester, 'custom-shipboard');
      final card = find.byKey(const ValueKey('guide-card-custom-shipboard'));
      expect(
        find.descendant(of: card, matching: find.text('PDF на устройстве: 1')),
        findsNothing,
      );
      await tester.runAsync(() async {
        final data = await rootBundle.load('assets/manual/manual.pdf');
        await library.importPdf(
          profileId: 'custom-shipboard',
          title: 'Документ, выбранный пользователем',
          fileName: 'Пример.pdf',
          bytes: data.buffer.asUint8List(
            data.offsetInBytes,
            data.lengthInBytes,
          ),
        );
      });
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: card, matching: find.text('PDF на устройстве: 1')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: card,
          matching: find.text('Памятка · источник не указан'),
        ),
        findsOneWidget,
      );
      await tester.runAsync(() async {
        final data = await rootBundle.load('assets/manual/manual.pdf');
        await library.importPdf(
          profileId: 'alta-vinyl-canada-prestige',
          title: 'Другой выбранный документ',
          fileName: 'Другой.pdf',
          bytes: data.buffer.asUint8List(
            data.offsetInBytes,
            data.lengthInBytes,
          ),
        );
      });
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: card, matching: find.text('PDF на устройстве: 1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('PDF на устройстве: 2')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'excerpt and unavailable evidence remain visible with their original dates',
    (tester) async {
      await mount(tester, 'mp-lbrus-240');
      final panel = tester.widget<ManualLibraryPanel>(
        find.byType(ManualLibraryPanel),
      );
      expect(panel.sources.single.downloadable, isFalse);
      final sources = find.byKey(
        const PageStorageKey('guide-sources-mp-lbrus-240'),
      );
      await tester.ensureVisible(sources);
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: sources,
          matching: find.text('Источники и редакции'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Проверен фрагмент: 2026-10-24'), findsNWidgets(4));
      expect(
        find.text('Ссылка недоступна при проверке: 2026-10-24'),
        findsOneWidget,
      );
      for (var cycle = 0; cycle < 2; cycle++) {
        await tester.ensureVisible(sources);
        await tester.pumpAndSettle();
        await tester.tap(
          find.descendant(
            of: sources,
            matching: find.text('Источники и редакции'),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(sources);
        await tester.pumpAndSettle();
        await tester.tap(
          find.descendant(
            of: sources,
            matching: find.text('Источники и редакции'),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Ссылка недоступна при проверке: 2026-10-24'),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      }
      final disabled = tester.widget<TextButton>(
        find.byKey(const ValueKey('manual-download-0')),
      );
      expect(disabled.onPressed, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'choosing a card changes the profile and scrolls back to its reader',
    (tester) async {
      await mount(tester, 'mp-shipboard-226');
      final button = find.byKey(
        const ValueKey('guide-select-custom-shipboard'),
      );
      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      final scrollable = tester.state<ScrollableState>(
        find.byType(Scrollable).first,
      );
      final before = scrollable.position.pixels;
      expect(before, greaterThan(100));
      await tester.tap(button);
      await tester.pumpAndSettle();
      final panel = tester.widget<ManualLibraryPanel>(
        find.byType(ManualLibraryPanel),
      );
      expect(panel.profileId, 'custom-shipboard');
      expect(scrollable.position.pixels, closeTo(0, 0.01));
      expect(
        find.text('Другой производитель · Свой профиль — размеры по документу'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'calculator alias still opens the correct original MP page and PDF action',
    (tester) async {
      await mount(tester, 'mp-shipboard-226', width: 390);
      final read = find.text('Читать на устройстве · стр. 17');
      expect(read, findsOneWidget);
      await tester.ensureVisible(read);
      await tester.pumpAndSettle();
      await tester.tap(read);
      await tester.pumpAndSettle();
      expect(find.byType(ManualReader), findsOneWidget);
      expect(find.byKey(const ValueKey('manual-page-17')), findsOneWidget);
      expect(find.byKey(const ValueKey('original-manual-pdf')), findsOneWidget);
      expect(find.text('17 / 26'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
