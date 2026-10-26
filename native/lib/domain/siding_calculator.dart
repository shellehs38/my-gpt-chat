/// Native, offline siding quantity and price calculation.
///
/// Geometry uses integer micrometres and square micrometres. Money uses integer
/// kopecks. Unknown input stays unknown and is never silently treated as zero.
library;

class SidingProfile {
  const SidingProfile({
    required this.id,
    required this.name,
    required this.width,
    required this.manualPage,
    this.manufacturer = 'Металл Профиль',
  });

  final String id;
  final String name;
  final String manufacturer;
  final String width;
  final int manualPage;
}

/// Dimensions from the supplied manufacturer manual, table on page 6.
const sidingProfiles = <SidingProfile>[
  SidingProfile(
    id: 'mp-lbrus-240',
    name: 'Lбрус® 15×240',
    width: '0.240',
    manualPage: 19,
  ),
  SidingProfile(
    id: 'mp-lbrus-xl-335',
    name: 'Lбрус® XL 14×335',
    width: '0.335',
    manualPage: 20,
  ),
  SidingProfile(
    id: 'metallprofil-woodstock',
    name: 'Woodstock® 28×330',
    width: '0.330',
    manualPage: 21,
  ),
  SidingProfile(
    id: 'mp-shipboard-226',
    name: 'Корабельная доска МП СК 14×226',
    width: '0.226',
    manualPage: 17,
  ),
];

class WallInput {
  const WallInput({this.width = '', this.height = ''});

  final String width;
  final String height;

  WallInput copyWith({String? width, String? height}) =>
      WallInput(width: width ?? this.width, height: height ?? this.height);

  Map<String, dynamic> toJson() => {'width': width, 'height': height};

  factory WallInput.fromJson(Map<String, dynamic> json) => WallInput(
    width: _jsonString(json, 'width'),
    height: _jsonString(json, 'height'),
  );
}

class OpeningInput {
  const OpeningInput({this.width = '', this.height = '', this.count = '1'});

  final String width;
  final String height;
  final String count;

  OpeningInput copyWith({String? width, String? height, String? count}) =>
      OpeningInput(
        width: width ?? this.width,
        height: height ?? this.height,
        count: count ?? this.count,
      );

  Map<String, dynamic> toJson() => {
    'width': width,
    'height': height,
    'count': count,
  };

  factory OpeningInput.fromJson(Map<String, dynamic> json) => OpeningInput(
    width: _jsonString(json, 'width'),
    height: _jsonString(json, 'height'),
    count: _jsonString(json, 'count'),
  );
}

class CalculationDraft {
  CalculationDraft({
    this.isExample = false,
    this.profileId = 'mp-lbrus-240',
    this.panelLength = '',
    this.reserve = '',
    this.panelPrice = '',
    this.workPrice = '',
    this.workPriceMode = 'base',
    List<WallInput> walls = const [WallInput()],
    List<OpeningInput> openings = const [],
  }) : walls = List.unmodifiable(walls),
       openings = List.unmodifiable(openings);

  factory CalculationDraft.empty() => CalculationDraft();

  factory CalculationDraft.example() => CalculationDraft(
    isExample: true,
    panelLength: '3',
    reserve: '0',
    walls: const [
      WallInput(width: '6', height: '3'),
      WallInput(width: '6', height: '3'),
    ],
    openings: const [OpeningInput(width: '1.2', height: '1.4', count: '2')],
  );

  final bool isExample;
  final String profileId;
  final String panelLength;
  final String reserve;
  final String panelPrice;
  final String workPrice;
  final String workPriceMode;
  final List<WallInput> walls;
  final List<OpeningInput> openings;

  CalculationDraft copyWith({
    bool? isExample,
    String? profileId,
    String? panelLength,
    String? reserve,
    String? panelPrice,
    String? workPrice,
    String? workPriceMode,
    List<WallInput>? walls,
    List<OpeningInput>? openings,
  }) => CalculationDraft(
    isExample: isExample ?? this.isExample,
    profileId: profileId ?? this.profileId,
    panelLength: panelLength ?? this.panelLength,
    reserve: reserve ?? this.reserve,
    panelPrice: panelPrice ?? this.panelPrice,
    workPrice: workPrice ?? this.workPrice,
    workPriceMode: workPriceMode ?? this.workPriceMode,
    walls: walls ?? this.walls,
    openings: openings ?? this.openings,
  );

  Map<String, dynamic> toJson() => {
    'isExample': isExample,
    'profileId': profileId,
    'panelLength': panelLength,
    'reserve': reserve,
    'panelPrice': panelPrice,
    'workPrice': workPrice,
    'workPriceMode': workPriceMode,
    'walls': walls.map((wall) => wall.toJson()).toList(),
    'openings': openings.map((opening) => opening.toJson()).toList(),
  };

  factory CalculationDraft.fromJson(Map<String, dynamic> json) {
    final walls = _jsonRows(json, 'walls');
    final openings = _jsonRows(json, 'openings');
    return CalculationDraft(
      isExample: json['isExample'] == true,
      profileId: _jsonString(json, 'profileId'),
      panelLength: _jsonString(json, 'panelLength'),
      reserve: _jsonString(json, 'reserve'),
      panelPrice: _jsonString(json, 'panelPrice'),
      workPrice: _jsonString(json, 'workPrice'),
      workPriceMode: _jsonString(json, 'workPriceMode', fallback: 'base'),
      walls: walls.map(WallInput.fromJson).toList(),
      openings: openings.map(OpeningInput.fromJson).toList(),
    );
  }
}

class CalculationResult {
  CalculationResult({
    this.profileId,
    this.profileName = '',
    this.manufacturer = '',
    this.wallArea,
    this.openingArea,
    this.netArea,
    this.usefulWidth,
    this.usefulPanelArea,
    this.orderArea,
    this.panelCount,
    this.materialsKopecks,
    this.baseWorkKopecks,
    this.workKopecks,
    this.markupKopecks,
    this.knownKopecks,
    this.workPriceMode = 'base',
    this.complete = false,
    this.geometryComplete = false,
    this.moneyComplete = false,
    this.formula = sidingFormula,
    this.manualPage,
    List<String> errors = const [],
    List<String> missing = const [],
  }) : errors = List.unmodifiable(errors),
       missing = List.unmodifiable(missing);

  final String? profileId;
  final String profileName;
  final String manufacturer;
  final String? wallArea;
  final String? openingArea;
  final String? netArea;
  final String? usefulWidth;
  final String? usefulPanelArea;
  final String? orderArea;
  final int? panelCount;
  final String? materialsKopecks;
  final String? baseWorkKopecks;
  final String? workKopecks;
  final String? markupKopecks;
  final String? knownKopecks;
  final String workPriceMode;
  final bool complete;
  final bool geometryComplete;
  final bool moneyComplete;
  final List<String> errors;
  final List<String> missing;
  final String formula;
  final int? manualPage;
  bool get preliminary => true;

  Map<String, dynamic> toJson() => {
    'profileId': profileId,
    'profileName': profileName,
    'manufacturer': manufacturer,
    'wallArea': wallArea,
    'openingArea': openingArea,
    'netArea': netArea,
    'usefulWidth': usefulWidth,
    'usefulPanelArea': usefulPanelArea,
    'orderArea': orderArea,
    'panelCount': panelCount,
    'materialsKopecks': materialsKopecks,
    'baseWorkKopecks': baseWorkKopecks,
    'workKopecks': workKopecks,
    'markupKopecks': markupKopecks,
    'knownKopecks': knownKopecks,
    'workPriceMode': workPriceMode,
    'complete': complete,
    'geometryComplete': geometryComplete,
    'moneyComplete': moneyComplete,
    'errors': errors,
    'missing': missing,
    'formula': formula,
    'preliminary': true,
    'source': {
      'title': 'Металл Профиль. Сайдинг. Инструкция по монтажу',
      'edition': '3-е издание, 2019',
      'dimensionPage': 6,
      'manualPage': manualPage,
    },
  };

  factory CalculationResult.fromJson(Map<String, dynamic> json) {
    final source = json['source'];
    final page = source is Map ? source['manualPage'] : json['manualPage'];
    return CalculationResult(
      profileId: _jsonNullableString(json, 'profileId'),
      profileName: _jsonString(json, 'profileName'),
      manufacturer: _jsonString(json, 'manufacturer'),
      wallArea: _jsonNullableString(json, 'wallArea'),
      openingArea: _jsonNullableString(json, 'openingArea'),
      netArea: _jsonNullableString(json, 'netArea'),
      usefulWidth: _jsonNullableString(json, 'usefulWidth'),
      usefulPanelArea: _jsonNullableString(json, 'usefulPanelArea'),
      orderArea: _jsonNullableString(json, 'orderArea'),
      panelCount: _jsonNullableInt(json['panelCount'], 'panelCount'),
      materialsKopecks: _jsonNullableString(json, 'materialsKopecks'),
      baseWorkKopecks: _jsonNullableString(json, 'baseWorkKopecks'),
      workKopecks: _jsonNullableString(json, 'workKopecks'),
      markupKopecks: _jsonNullableString(json, 'markupKopecks'),
      knownKopecks: _jsonNullableString(json, 'knownKopecks'),
      workPriceMode: _jsonString(json, 'workPriceMode', fallback: 'base'),
      complete: json['complete'] == true,
      geometryComplete: json['geometryComplete'] == true,
      moneyComplete: json['moneyComplete'] == true,
      formula: _jsonString(json, 'formula', fallback: sidingFormula),
      manualPage: _jsonNullableInt(page, 'manualPage'),
      errors: _jsonStringList(json, 'errors'),
      missing: _jsonStringList(json, 'missing'),
    );
  }
}

const sidingFormula =
    'округление вверх(чистая площадь × (1 + запас / 100) / '
    '(полезная ширина × длина панели))';

final _scale = BigInt.from(1000000);
final _areaScale = _scale * _scale;
final _maximumDimension = BigInt.from(10000) * _scale;

class _Parsed {
  const _Parsed({this.value, this.missing = false, this.invalid = false});
  final BigInt? value;
  final bool missing;
  final bool invalid;
}

_Parsed _parseFixed(String raw, {int decimals = 6}) {
  final value = raw.trim().replaceAll(',', '.');
  if (value.isEmpty) return const _Parsed(missing: true);
  final pattern = RegExp(
    r'^\d{1,12}(?:\.\d{1,' + decimals.toString() + r'})?$',
  );
  if (!pattern.hasMatch(value)) return const _Parsed(invalid: true);
  final parts = value.split('.');
  final fraction = parts.length == 2 ? parts[1] : '';
  return _Parsed(
    value: BigInt.parse(parts.first + fraction.padRight(decimals, '0')),
  );
}

String _decimalString(BigInt value, {BigInt? scale}) {
  final divisor = scale ?? _areaScale;
  final absolute = value.abs();
  final places = divisor.toString().length - 1;
  final integer = absolute ~/ divisor;
  final fraction = (absolute % divisor)
      .toString()
      .padLeft(places, '0')
      .replaceFirst(RegExp(r'0+$'), '');
  return '${value.isNegative ? '-' : ''}$integer'
      '${fraction.isEmpty ? '' : '.$fraction'}';
}

BigInt _roundDivision(BigInt numerator, BigInt denominator) =>
    (numerator + denominator ~/ BigInt.two) ~/ denominator;

BigInt? _dimension(
  String raw,
  String label,
  List<String> errors,
  List<String> missing,
) {
  final parsed = _parseFixed(raw);
  if (parsed.missing) {
    missing.add(label);
    return null;
  }
  if (parsed.invalid ||
      parsed.value! <= BigInt.zero ||
      parsed.value! > _maximumDimension) {
    errors.add(
      '$label: укажите положительное число в метрах '
      '(до 6 знаков после запятой).',
    );
    return null;
  }
  return parsed.value;
}

BigInt? _price(String raw, String label, List<String> errors) {
  final parsed = _parseFixed(raw, decimals: 2);
  if (parsed.invalid) {
    errors.add(
      '$label: укажите цену в рублях, максимум два знака после запятой.',
    );
  }
  return parsed.value;
}

CalculationResult calculateSiding(CalculationDraft draft) {
  final errors = <String>[];
  final missing = <String>[];
  SidingProfile? profile;
  for (final candidate in sidingProfiles) {
    if (candidate.id == draft.profileId) {
      profile = candidate;
      break;
    }
  }
  var wallUnits = BigInt.zero;
  var openingUnits = BigInt.zero;
  var geometryComplete = draft.walls.isNotEmpty;
  if (draft.walls.isEmpty) missing.add('Добавьте хотя бы одну стену');

  for (var index = 0; index < draft.walls.length; index++) {
    final wall = draft.walls[index];
    final width = _dimension(
      wall.width,
      'Ширина стены ${index + 1}',
      errors,
      missing,
    );
    final height = _dimension(
      wall.height,
      'Высота стены ${index + 1}',
      errors,
      missing,
    );
    if (width == null || height == null) {
      geometryComplete = false;
    } else {
      wallUnits += width * height;
    }
  }
  for (var index = 0; index < draft.openings.length; index++) {
    final opening = draft.openings[index];
    final width = _dimension(
      opening.width,
      'Ширина проёма ${index + 1}',
      errors,
      missing,
    );
    final height = _dimension(
      opening.height,
      'Высота проёма ${index + 1}',
      errors,
      missing,
    );
    final rawCount = opening.count.trim();
    final count = RegExp(r'^\d{1,5}$').hasMatch(rawCount)
        ? int.tryParse(rawCount)
        : null;
    if (count == null || count < 1 || count > 10000) {
      if (rawCount.isEmpty) {
        missing.add('Количество проёмов ${index + 1}');
      } else {
        errors.add(
          'Количество проёмов ${index + 1}: '
          'укажите целое число от 1 до 10 000.',
        );
      }
      geometryComplete = false;
    }
    if (width == null || height == null) geometryComplete = false;
    if (width != null &&
        height != null &&
        count != null &&
        count >= 1 &&
        count <= 10000) {
      openingUnits += width * height * BigInt.from(count);
    }
  }

  BigInt? netUnits = geometryComplete ? wallUnits - openingUnits : null;
  if (netUnits != null && netUnits <= BigInt.zero) {
    errors.add(
      'Площадь проёмов должна быть меньше площади стен. '
      'Проверьте размеры и единицы.',
    );
    netUnits = null;
    geometryComplete = false;
  }

  final length = _parseFixed(draft.panelLength);
  if (length.missing) {
    missing.add('Длина панели');
  } else if (length.invalid ||
      length.value! <= BigInt.zero ||
      length.value! > BigInt.from(6) * _scale) {
    errors.add(
      'Длина панели: укажите значение больше 0 и не более 6 м '
      'по выбранному документу.',
    );
  }
  final reserve = _parseFixed(draft.reserve);
  if (reserve.missing) {
    missing.add('Запас материала');
  } else if (reserve.invalid || reserve.value! > BigInt.from(1000) * _scale) {
    errors.add(
      'Запас: укажите число от 0 до 1000%. '
      'Значение выбирается для вашего расчёта.',
    );
  }
  if (profile == null) missing.add('Профиль сайдинга');

  BigInt? usefulPanelUnits;
  int? panelCount;
  BigInt? orderAreaUnits;
  final lengthValid =
      length.value != null &&
      !length.invalid &&
      length.value! > BigInt.zero &&
      length.value! <= BigInt.from(6) * _scale;
  final reserveValid =
      reserve.value != null &&
      !reserve.invalid &&
      reserve.value! <= BigInt.from(1000) * _scale;
  if (profile != null && lengthValid) {
    usefulPanelUnits = _parseFixed(profile.width).value! * length.value!;
  }
  if (geometryComplete &&
      netUnits != null &&
      usefulPanelUnits != null &&
      reserveValid) {
    final numerator = netUnits * (BigInt.from(100) * _scale + reserve.value!);
    final denominator = usefulPanelUnits * BigInt.from(100) * _scale;
    final exactCount = (numerator + denominator - BigInt.one) ~/ denominator;
    if (exactCount > BigInt.from(1000000000)) {
      errors.add(
        'Получено слишком большое количество панелей. '
        'Проверьте единицы и длину панели.',
      );
    } else {
      panelCount = exactCount.toInt();
      orderAreaUnits = usefulPanelUnits * exactCount;
    }
  }

  final panelPrice = _price(draft.panelPrice, 'Цена панели', errors);
  final workPrice = _price(draft.workPrice, 'Ставка работ', errors);
  final workPriceMode = draft.workPriceMode == 'client' ? 'client' : 'base';
  final materialsKopecks = panelCount != null && panelPrice != null
      ? BigInt.from(panelCount) * panelPrice
      : null;
  final baseWorkKopecks = netUnits != null && workPrice != null
      ? _roundDivision(netUnits * workPrice, _areaScale)
      : null;
  final workKopecks = netUnits != null && workPrice != null
      ? _roundDivision(
          netUnits * workPrice * BigInt.from(workPriceMode == 'base' ? 14 : 10),
          _areaScale * BigInt.from(10),
        )
      : null;
  final hasKnownMoney = materialsKopecks != null || workKopecks != null;
  final knownKopecks = hasKnownMoney
      ? (materialsKopecks ?? BigInt.zero) + (workKopecks ?? BigInt.zero)
      : null;
  final markupKopecks =
      workPriceMode == 'base' && workKopecks != null && baseWorkKopecks != null
      ? workKopecks - baseWorkKopecks
      : null;

  return CalculationResult(
    profileId: profile?.id,
    profileName: profile?.name ?? '',
    manufacturer: profile?.manufacturer ?? '',
    wallArea: geometryComplete ? _decimalString(wallUnits) : null,
    openingArea: geometryComplete ? _decimalString(openingUnits) : null,
    netArea: netUnits == null ? null : _decimalString(netUnits),
    usefulWidth: profile?.width,
    usefulPanelArea: usefulPanelUnits == null
        ? null
        : _decimalString(usefulPanelUnits),
    orderArea: orderAreaUnits == null ? null : _decimalString(orderAreaUnits),
    panelCount: panelCount,
    materialsKopecks: materialsKopecks?.toString(),
    baseWorkKopecks: baseWorkKopecks?.toString(),
    workKopecks: workKopecks?.toString(),
    markupKopecks: markupKopecks?.toString(),
    knownKopecks: knownKopecks?.toString(),
    workPriceMode: workPriceMode,
    moneyComplete: materialsKopecks != null && workKopecks != null,
    complete: geometryComplete && panelCount != null && errors.isEmpty,
    geometryComplete: geometryComplete,
    errors: errors,
    missing: missing,
    manualPage: profile?.manualPage,
  );
}

String _groupDigits(String digits) =>
    digits.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '\u202f');

/// Russian display formatting, with exact decimal rounding and no double cast.
String formatArea(String? value, {int digits = 2}) {
  if (value == null) return '—';
  if (digits < 0 || digits > 12) {
    throw RangeError.range(digits, 0, 12, 'digits');
  }
  final text = value.trim().replaceAll(',', '.');
  if (!RegExp(r'^-?\d+(?:\.\d+)?$').hasMatch(text)) return '—';
  final negative = text.startsWith('-');
  final parts = (negative ? text.substring(1) : text).split('.');
  final fraction = parts.length == 2 ? parts[1] : '';
  final scale = BigInt.from(10).pow(digits);
  final padded = fraction.padRight(digits + 1, '0');
  var scaled =
      BigInt.parse(parts[0]) * scale +
      (digits == 0 ? BigInt.zero : BigInt.parse(padded.substring(0, digits)));
  if (int.parse(padded.substring(digits, digits + 1)) >= 5) {
    scaled += BigInt.one;
  }
  final integer = _groupDigits((scaled ~/ scale).toString());
  final tail = digits == 0
      ? ''
      : ',${(scaled % scale).toString().padLeft(digits, '0')}';
  return '${negative && scaled != BigInt.zero ? '-' : ''}$integer$tail';
}

String formatMoney(String? kopecks) {
  if (kopecks == null) return 'Цена не задана';
  final parsed = BigInt.tryParse(kopecks);
  if (parsed == null) return 'Цена не задана';
  final absolute = parsed.abs();
  final integer = _groupDigits((absolute ~/ BigInt.from(100)).toString());
  final cents = (absolute % BigInt.from(100)).toString().padLeft(2, '0');
  return '${parsed.isNegative ? '-' : ''}$integer,$cents ₽';
}

String _jsonString(
  Map<String, dynamic> json,
  String key, {
  String fallback = '',
}) {
  final value = json[key];
  if (value == null) return fallback;
  if (value is! String) throw FormatException('$key должен быть строкой');
  return value;
}

String? _jsonNullableString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) throw FormatException('$key должен быть строкой');
  return value;
}

int? _jsonNullableInt(dynamic value, String key) {
  if (value == null) return null;
  if (value is! int) throw FormatException('$key должен быть целым числом');
  return value;
}

List<Map<String, dynamic>> _jsonRows(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return [];
  if (value is! List) throw FormatException('$key должен быть списком');
  return value.map((row) {
    if (row is! Map) throw FormatException('$key: неправильный формат строки');
    return Map<String, dynamic>.from(row);
  }).toList();
}

List<String> _jsonStringList(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return [];
  if (value is! List || value.any((item) => item is! String)) {
    throw FormatException('$key должен быть списком строк');
  }
  return value.cast<String>();
}
