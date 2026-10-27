import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:svoi_lyudi_native/domain/siding_calculator.dart';
import 'package:svoi_lyudi_native/services/document_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'PDF embeds branding and remains self-contained with unknown prices',
    () async {
      final draft = CalculationDraft.example();
      final result = calculateSiding(draft);
      expect(result.materialsKopecks, isNull);
      expect(result.workKopecks, isNull);
      final bytes = await createCalculationPdf(
        objectName: 'Демонстрационный объект',
        address: '',
        createdAt: DateTime.utc(2026, 10, 26, 18),
        draft: draft,
        result: result,
      );
      expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
      final structure = latin1.decode(bytes);
      expect(RegExp(r'/Subtype\s*/Image').hasMatch(structure), isTrue);
      expect(structure.contains('/FontFile2'), isTrue);
      expect(structure.contains('%%EOF'), isTrue);
      final directory = Directory('build/validation')
        ..createSync(recursive: true);
      await File('${directory.path}/calculation-unknown.pdf')
          .writeAsBytes(bytes);
    },
  );

  test(
    'priced PDF uses the client work amount from the exact calculator',
    () async {
      final draft = CalculationDraft.example().copyWith(
        panelPrice: '500',
        workPrice: '1000',
        workPriceMode: 'base',
      );
      final result = calculateSiding(draft);
      expect(result.moneyComplete, isTrue);
      expect(result.materialsKopecks, isNotNull);
      expect(result.workKopecks, isNot(result.baseWorkKopecks));
      final bytes = await createCalculationPdf(
        objectName: 'Контрольный фасад',
        address: 'Иркутск · пример',
        createdAt: DateTime.utc(2026, 10, 26),
        draft: draft,
        result: result,
      );
      expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
      final directory = Directory('build/validation')
        ..createSync(recursive: true);
      await File('${directory.path}/calculation-known.pdf').writeAsBytes(bytes);
    },
  );
}
