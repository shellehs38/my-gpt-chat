# Siding engine reference results

`siding-reference.json` records 250 deterministic input/output pairs from the
existing JavaScript calculator, rather than running JavaScript in the native app.
The `source` object records the original source revision, SHA-256 and seed.

The first 40 cases exercise missing or invalid fields, explicit zero prices,
unknown profiles, oversized openings and exact rounding boundaries. The other
210 cases vary valid dimensions, openings, useful panel profiles, lengths,
reserve percentages and prices. No customer records or actual regional prices
are present: these are numerical test fixtures.

Run `dart scripts/check_siding_parity.dart` to verify that every result field
matches the captured original. The Flutter application itself only uses Dart
and does not depend on JavaScript, a browser or a WebView.
