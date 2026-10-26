import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:svoi_lyudi_native/domain/siding_calculator.dart';

void main() {
  group('Native siding quantities', () {
    test('subtracts openings once and rounds panel count up', () {
      final result = calculateSiding(CalculationDraft.example());
      expect(result.wallArea, '36');
      expect(result.openingArea, '3.36');
      expect(result.netArea, '32.64');
      expect(result.usefulPanelArea, '0.72');
      expect(result.panelCount, 46);
      expect(result.complete, isTrue);
      expect(result.moneyComplete, isFalse);
      expect(result.knownKopecks, isNull);
    });

    test('empty dimensions stay unknown', () {
      final result = calculateSiding(CalculationDraft.empty());
      expect(result.netArea, isNull);
      expect(result.panelCount, isNull);
      expect(result.complete, isFalse);
      expect(result.missing, isNotEmpty);
    });

    test('missing reserve does not become a zero reserve', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(reserve: ''),
      );
      expect(result.netArea, '32.64');
      expect(result.panelCount, isNull);
      expect(result.complete, isFalse);
    });

    test('oversized openings invalidate the area', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          openings: const [OpeningInput(width: '30', height: '10')],
        ),
      );
      expect(result.netArea, isNull);
      expect(result.complete, isFalse);
      expect(result.errors, isNotEmpty);
    });

    test('zero net area is not a valid facade', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          walls: const [WallInput(width: '3', height: '3')],
          openings: const [OpeningInput(width: '3', height: '3')],
        ),
      );
      expect(result.geometryComplete, isFalse);
      expect(result.netArea, isNull);
    });

    test('exact decimal boundary does not order an extra panel', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          walls: const [WallInput(width: '0.1', height: '0.3')],
          openings: [],
          panelLength: '0.125',
        ),
      );
      expect(result.netArea, '0.03');
      expect(result.usefulPanelArea, '0.03');
      expect(result.panelCount, 1);
    });

    test('decimal commas are accepted as user input', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          walls: const [WallInput(width: '6,1', height: '3,2')],
          openings: [],
        ),
      );
      expect(result.netArea, '19.52');
    });

    test('fractional opening counts are rejected', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          openings: const [OpeningInput(width: '1', height: '1', count: '1.5')],
        ),
      );
      expect(result.geometryComplete, isFalse);
      expect(result.panelCount, isNull);
      expect(result.errors, isNotEmpty);
    });

    test('unknown profile never falls back to another manufacturer', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(profileId: 'unknown-profile'),
      );
      expect(result.profileId, isNull);
      expect(result.usefulWidth, isNull);
      expect(result.panelCount, isNull);
      expect(result.complete, isFalse);
    });

    test('length and dimension limits are enforced', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          panelLength: '6.000001',
          walls: const [WallInput(width: '10001', height: '3')],
        ),
      );
      expect(result.complete, isFalse);
      expect(result.errors.length, greaterThanOrEqualTo(2));
    });

    test('negative and over-precise dimensions are rejected', () {
      for (final value in ['-1', '0', '1.0000001', '1e3', 'NaN']) {
        final result = calculateSiding(
          CalculationDraft.example().copyWith(
            walls: [WallInput(width: value, height: '3')],
            openings: [],
          ),
        );
        expect(result.complete, isFalse, reason: value);
        expect(result.errors, isNotEmpty, reason: value);
      }
    });

    test('reserve affects panels, not measured work area', () {
      final withReserve = calculateSiding(
        CalculationDraft.example().copyWith(reserve: '10', workPrice: '100'),
      );
      final withoutReserve = calculateSiding(
        CalculationDraft.example().copyWith(reserve: '0', workPrice: '100'),
      );
      expect(withReserve.panelCount, 50);
      expect(withReserve.netArea, withoutReserve.netArea);
      expect(withReserve.workKopecks, withoutReserve.workKopecks);
    });

    test('each profile retains its precise useful width and manual page', () {
      for (final profile in sidingProfiles) {
        final result = calculateSiding(
          CalculationDraft.example().copyWith(profileId: profile.id),
        );
        expect(result.profileId, profile.id);
        expect(result.usefulWidth, profile.width);
        expect(result.manualPage, profile.manualPage);
      }
    });
  });

  group('Exact prices and company work rule', () {
    test('calculates material and base work in integer kopecks', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          panelPrice: '250',
          workPrice: '100',
        ),
      );
      expect(result.materialsKopecks, '1150000');
      expect(result.baseWorkKopecks, '326400');
      expect(result.workKopecks, '456960');
      expect(result.markupKopecks, '130560');
      expect(result.knownKopecks, '1606960');
      expect(result.moneyComplete, isTrue);
    });

    test('client work price is never marked up again', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          workPrice: '100',
          workPriceMode: 'client',
        ),
      );
      expect(result.workKopecks, '326400');
      expect(result.markupKopecks, isNull);
    });

    test('explicit zero prices are known, not missing', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(panelPrice: '0', workPrice: '0'),
      );
      expect(result.materialsKopecks, '0');
      expect(result.workKopecks, '0');
      expect(result.knownKopecks, '0');
      expect(result.moneyComplete, isTrue);
      expect(formatMoney('0'), '0,00 ₽');
    });

    test('invalid money precision is not silently rounded', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(panelPrice: '3.001'),
      );
      expect(result.materialsKopecks, isNull);
      expect(result.complete, isFalse);
      expect(result.errors, isNotEmpty);
    });

    test('work markup does not cross into material prices', () {
      final draft = CalculationDraft.example().copyWith(
        panelPrice: '250',
        workPrice: '100',
      );
      final base = calculateSiding(draft);
      final client = calculateSiding(draft.copyWith(workPriceMode: 'client'));
      final materialsOnly = calculateSiding(draft.copyWith(workPrice: ''));
      expect(base.materialsKopecks, '1150000');
      expect(base.materialsKopecks, client.materialsKopecks);
      expect(base.materialsKopecks, materialsOnly.materialsKopecks);
      expect(materialsOnly.knownKopecks, '1150000');
      expect(materialsOnly.moneyComplete, isFalse);
      expect(
        BigInt.parse(base.knownKopecks!) - BigInt.parse(client.knownKopecks!),
        BigInt.parse(base.markupKopecks!),
      );
    });

    test('work currency rounds only at the final monetary amount', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          walls: const [WallInput(width: '0.1', height: '0.1')],
          openings: [],
          workPrice: '0.50',
        ),
      );
      // 0.01 m² × 0.50 ₽ × 1.4 = 0.007 ₽ -> one kopeck.
      expect(result.workKopecks, '1');
    });

    test('large exact currency values survive without double conversion', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(panelPrice: '999999999999.99'),
      );
      expect(result.materialsKopecks, '4599999999999954');
    });

    test('matches the verified end-to-end reference calculation', () {
      final result = calculateSiding(
        CalculationDraft.empty().copyWith(
          profileId: 'mp-lbrus-xl-335',
          walls: const [WallInput(width: '8', height: '3')],
          openings: const [
            OpeningInput(width: '1.2', height: '1.4', count: '2'),
          ],
          panelLength: '3',
          reserve: '5',
          panelPrice: '500',
          workPrice: '1000',
        ),
      );
      expect(result.netArea, '20.64');
      expect(result.panelCount, 22);
      expect(result.materialsKopecks, '1100000');
      expect(result.workKopecks, '2889600');
      expect(result.knownKopecks, '3989600');
    });
  });

  group('Storage and display', () {
    test('draft round trips through JSON without precision loss', () {
      final draft = CalculationDraft.example().copyWith(
        panelPrice: '1234567890.01',
        reserve: '3.141592',
      );
      final restored = CalculationDraft.fromJson(
        jsonDecode(jsonEncode(draft.toJson())) as Map<String, dynamic>,
      );
      expect(restored.toJson(), draft.toJson());
    });

    test('result round trips through JSON without BigInt values', () {
      final result = calculateSiding(
        CalculationDraft.example().copyWith(
          panelPrice: '250',
          workPrice: '100',
        ),
      );
      final restored = CalculationResult.fromJson(
        jsonDecode(jsonEncode(result.toJson())) as Map<String, dynamic>,
      );
      expect(restored.toJson(), result.toJson());
    });

    test('models cannot be changed through their input lists', () {
      final walls = [const WallInput(width: '1', height: '1')];
      final draft = CalculationDraft(walls: walls);
      walls.clear();
      expect(draft.walls, hasLength(1));
      expect(() => draft.walls.clear(), throwsUnsupportedError);
      expect(
        () => calculateSiding(draft).errors.add('mutated'),
        throwsUnsupportedError,
      );
    });

    test('malformed stored dimensions are rejected at the boundary', () {
      expect(
        () => CalculationDraft.fromJson({
          'walls': [
            {'width': 4, 'height': '3'},
          ],
        }),
        throwsFormatException,
      );
    });

    test('missing imported profile and opening count remain unknown', () {
      final restored = CalculationDraft.fromJson({
        'walls': [
          {'width': '6', 'height': '3'},
        ],
        'openings': [
          {'width': '1', 'height': '1'},
        ],
        'panelLength': '3',
        'reserve': '0',
      });
      final result = calculateSiding(restored);
      expect(restored.profileId, '');
      expect(restored.openings.single.count, '');
      expect(result.profileId, isNull);
      expect(result.geometryComplete, isFalse);
      expect(result.panelCount, isNull);
    });

    test('display formatting uses exact decimal rounding', () {
      expect(formatArea(null), '—');
      expect(formatArea('1.005'), '1,01');
      expect(formatArea('999.999'), '1\u202f000,00');
      expect(formatArea('0.240', digits: 3), '0,240');
      expect(formatArea('25.5', digits: 0), '26');
      expect(formatMoney(null), 'Цена не задана');
      expect(formatMoney('1150000'), '11\u202f500,00 ₽');
      expect(
        formatMoney('123456789012345678901'),
        '1\u202f234\u202f567\u202f890\u202f123\u202f456\u202f789,01 ₽',
      );
    });
  });
}
