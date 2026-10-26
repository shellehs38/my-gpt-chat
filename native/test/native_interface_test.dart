import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/app.dart';
import 'package:svoi_lyudi_native/models/workspace.dart';
import 'package:svoi_lyudi_native/services/workspace_store.dart';

Future<void> screenshot(WidgetTester tester, String name) async {
  await settleNative(tester);
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('native-preview')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    final directory = Directory('build/previews')..createSync(recursive: true);
    await File('${directory.path}/$name.png')
        .writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> settleNative(WidgetTester tester) async {
  await tester.pump();
  await tester.runAsync(() async {
    await Future<void>.delayed(const Duration(milliseconds: 80));
  });
  for (
    var attempt = 0;
    attempt < 40 &&
        find.byType(CircularProgressIndicator).evaluate().isNotEmpty;
    attempt++
  ) {
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump(const Duration(milliseconds: 50));
  }
  await tester.pumpAndSettle(const Duration(milliseconds: 50));
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
  setUp(() {
    rootBundle.clear();
    PaintingBinding.instance.imageCache.clear();
    PaintingBinding.instance.imageCache.clearLiveImages();
  });
  for (final size in [const Size(1440, 1000), const Size(390, 844)]) {
    testWidgets(
      'native interface at ${size.width.toInt()}px navigates all screens and creates an object',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = size;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final repository = MemoryWorkspaceRepository();
        final store = WorkspaceStore(
          repository,
          initialData: WorkspaceData.demo(),
        );
        await tester.pumpWidget(ConstructionApp(store: store));
        await settleNative(tester);
        expect(tester.takeException(), isNull);
        final target = size.width > 1000 ? 'windows' : 'iphone';
        await screenshot(tester, 'native-$target-overview');
        for (var route = 1; route < 7; route++) {
          if (size.width < 1000) {
            tester
                .state<ScaffoldState>(find.byType(Scaffold).first)
                .openDrawer();
            await settleNative(tester);
          }
          debugPrint('Opening native route $route at ${size.width}');
          await tester.tap(find.byKey(ValueKey('nav-$route')));
          await settleNative(tester);
          expect(
            tester.takeException(),
            isNull,
            reason: 'route $route at ${size.width}',
          );
          if (route == 3) await screenshot(tester, 'native-$target-calculator');
          if (route == 4) await screenshot(tester, 'native-$target-guides');
        }
        if (size.width < 1000) {
          tester.state<ScaffoldState>(find.byType(Scaffold).first).openDrawer();
          await settleNative(tester);
        }
        await tester.tap(find.byKey(const ValueKey('nav-1')));
        await settleNative(tester);
        await tester.tap(find.text('Новый объект').first);
        await settleNative(tester);
        await tester.enterText(
          find.byKey(const ValueKey('project-name')),
          'Контрольный нативный объект',
        );
        await tester.tap(find.text('Сохранить объект'));
        await settleNative(tester);
        expect(tester.takeException(), isNull);
        expect(
          store.data.projects.any(
            (p) => p.name == 'Контрольный нативный объект',
          ),
          isTrue,
        );
        expect(
          repository.data!.activeProject!.name,
          'Контрольный нативный объект',
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await store.saveNow();
        store.dispose();
      },
    );
  }
}
