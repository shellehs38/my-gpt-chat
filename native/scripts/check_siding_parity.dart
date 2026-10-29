// Compare the native Dart port against captured results of the existing engine.
// Run: dart scripts/check_siding_parity.dart
import 'dart:convert';
import 'dart:io';

import 'package:svoi_lyudi_native/domain/siding_calculator.dart';

void main() {
  final referenceFile = File.fromUri(
    Platform.script.resolve('fixtures/siding-reference.json'),
  );
  final reference =
      jsonDecode(referenceFile.readAsStringSync()) as Map<String, dynamic>;
  final cases = reference['cases'] as List<dynamic>;
  var mismatches = 0;
  for (var index = 0; index < cases.length; index++) {
    final input = cases[index] as Map<String, dynamic>;
    final draft = CalculationDraft.fromJson(
      input['draft'] as Map<String, dynamic>,
    );
    final actual = calculateSiding(draft).toJson();
    final expected = input['expected'] as Map<String, dynamic>;
    final keys = {...actual.keys, ...expected.keys};
    for (final key in keys) {
      if (jsonEncode(actual[key]) != jsonEncode(expected[key]) ||
          actual.containsKey(key) != expected.containsKey(key)) {
        stderr.writeln(
          'Case $index, $key: actual=${actual[key]}, expected=${expected[key]}',
        );
        mismatches++;
      }
    }
  }
  if (mismatches > 0) {
    stderr.writeln('Native calculation parity failed: $mismatches mismatches.');
    exit(1);
  }
  stdout.writeln(
    '${cases.length} native Dart calculations match the existing engine exactly.',
  );
}
