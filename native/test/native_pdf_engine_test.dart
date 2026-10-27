import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:svoi_lyudi_native/screens/pdf_document_screen.dart';
import 'package:svoi_lyudi_native/theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final module = File(
      Platform.isWindows
          ? 'build/windows/x64/runner/Release/pdfium.dll'
          : 'build/native_assets/${Platform.operatingSystem}/${Platform.isMacOS ? 'libpdfium.dylib' : 'libpdfium.so'}',
    );
    // Flutter's test executable lives in the SDK, outside the application bundle.
    // Point the documented test override at the real build-produced native library.
    expect(
      await module.exists(),
      isTrue,
      reason: 'The native PDFium build asset must exist',
    );
    Pdfrx.pdfiumModulePath = module.absolute.path;
    Pdfrx.cacheDirectoryPath = Directory.systemTemp.path;
    await pdfrxInitialize();
    final fonts = FontLoader('DejaVu')
      ..addFont(rootBundle.load('assets/fonts/DejaVuSans.ttf'))
      ..addFont(rootBundle.load('assets/fonts/DejaVuSans-Bold.ttf'));
    await fonts.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  test('native PDFium opens all 26 supplied pages and renders the actual mounting page', () async {
    final bytes = await File('assets/manual/manual.pdf').readAsBytes();
    final document = await PdfDocument.openData(
      bytes,
      sourceName: 'supplied-mp-2019',
    );
    try {
      expect(document.pages.length, 26);
      final page = document.pages[16];
      expect(page.width, greaterThan(0));
      final height = (360 * page.height / page.width).round();
      final rendered = await page.render(
        width: 360,
        height: height,
        fullWidth: 360,
        fullHeight: height.toDouble(),
        backgroundColor: 0xffffffff,
      );
      expect(rendered, isNotNull);
      try {
        expect(rendered!.pixels.length, 360 * height * 4);
        var inkPixels = 0;
        for (var i = 0; i < rendered.pixels.length; i += 4) {
          if (rendered.pixels[i] < 200 ||
              rendered.pixels[i + 1] < 200 ||
              rendered.pixels[i + 2] < 200) {
            inkPixels++;
          }
        }
        expect(inkPixels, greaterThan(100));
        final image = await rendered.createImage();
        try {
          final png = await image.toByteData(format: ui.ImageByteFormat.png);
          final folder = Directory('build/validation')
            ..createSync(recursive: true);
          await File('${folder.path}/native-pdf-mp-page17.png')
              .writeAsBytes(png!.buffer.asUint8List());
        } finally {
          image.dispose();
        }
      } finally {
        rendered?.dispose();
      }
    } finally {
      await document.dispose();
    }
  });

  test(
    'native PDFium rejects a truncated file even when its header says PDF',
    () async {
      final bytes = Uint8List.fromList('%PDF-1.7\nnot-a-document'.codeUnits);
      await expectLater(
        PdfDocument.openData(bytes, sourceName: 'broken-file'),
        throwsA(isA<Exception>()),
      );
    },
  );

  testWidgets(
    'real native PDF screen opens the mapped page and changes pages at iPhone width',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bytes = await tester.runAsync(
        () => File('assets/manual/manual.pdf').readAsBytes(),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: constructionTheme(),
          home: RepaintBoundary(
            key: const ValueKey('real-pdf-evidence'),
            child: PdfDocumentScreen(
              bytes: bytes!,
              title: 'Металл Профиль · 2019',
              initialPage: 17,
            ),
          ),
        ),
      );
      Future<void> waitForPage(int page) async {
        for (var attempt = 0; attempt < 80; attempt++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 80)),
          );
          await tester.pump(const Duration(milliseconds: 80));
          if (find.text('Страница $page из 26').evaluate().isNotEmpty) return;
        }
        fail('PDF page $page was not ready');
      }

      await waitForPage(17);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(const ValueKey('real-pdf-evidence')),
      );
      // A ready document/page counter does not prove its pixels have been painted.
      // Keep advancing frames while PDFium and Flutter decode the page image.
      var inkPixels = 0;
      for (var attempt = 0; attempt < 80 && inkPixels < 1000; attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump(const Duration(milliseconds: 100));
        inkPixels = (await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          try {
            final rgba = await image.toByteData();
            var ink = 0;
            // Exclude toolbar and page-edge shadows: inspect the document itself.
            for (var y = 250; y < 730; y++) {
              for (var x = 20; x < 370; x++) {
                final offset = (y * image.width + x) * 4;
                if (rgba!.getUint8(offset) < 160 ||
                    rgba.getUint8(offset + 1) < 160 ||
                    rgba.getUint8(offset + 2) < 160) {
                  ink++;
                }
              }
            }
            if (ink >= 1000) {
              final png = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              final dir = Directory('build/previews')
                ..createSync(recursive: true);
              await File('${dir.path}/native-iphone-original-pdf.png')
                  .writeAsBytes(png!.buffer.asUint8List());
            }
            return ink;
          } finally {
            image.dispose();
          }
        }))!;
      }
      expect(
        inkPixels,
        greaterThanOrEqualTo(1000),
        reason: 'The visible PDF page must contain rendered document content',
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('pdf-next-page')));
      await waitForPage(18);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    },
  );
}
