import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../domain/siding_calculator.dart';

/// Produces a self-contained client document without invoking a browser.
///
/// All line totals come from the calculator. In particular, [result.workKopecks]
/// is already the client work amount; internal management figures are never
/// included in this document. Saving, sharing and printing belong to the caller.
Future<Uint8List> createCalculationPdf({
  required String objectName,
  required String address,
  required DateTime createdAt,
  required CalculationDraft draft,
  required CalculationResult result,
}) async {
  final logoData = await rootBundle.load(
    'assets/brand/logo-sl-approved-light.png',
  );
  final regularData = await rootBundle.load('assets/fonts/DejaVuSans.ttf');
  final boldData = await rootBundle.load('assets/fonts/DejaVuSans-Bold.ttf');
  final logo = pw.MemoryImage(
    logoData.buffer.asUint8List(logoData.offsetInBytes, logoData.lengthInBytes),
  );
  final regular = pw.Font.ttf(regularData);
  final bold = pw.Font.ttf(boldData);
  final document = pw.Document(
    version: PdfVersion.pdf_1_5,
    compress: true,
    title: 'Предварительный расчёт сайдинга — $objectName',
    author: 'ООО «СВОИ ЛЮДИ»',
    creator: 'СВОИ ЛЮДИ — строительное приложение',
  );

  const ink = PdfColor.fromInt(0xff18352b);
  const muted = PdfColor.fromInt(0xff65736b);
  const border = PdfColor.fromInt(0xffdce4d8);
  const paperTint = PdfColor.fromInt(0xfff3f7ed);
  final titleStyle = pw.TextStyle(
    fontSize: 19,
    fontWeight: pw.FontWeight.bold,
    color: ink,
  );
  final headingStyle = pw.TextStyle(
    fontSize: 12,
    fontWeight: pw.FontWeight.bold,
    color: ink,
  );

  pw.Widget sectionTitle(String text) => pw.Padding(
    padding: const pw.EdgeInsets.only(top: 17, bottom: 9),
    child: pw.Text(text, style: headingStyle),
  );

  pw.Widget note(String text) => pw.Container(
    width: double.infinity,
    padding: const pw.EdgeInsets.all(10),
    decoration: pw.BoxDecoration(
      color: paperTint,
      border: pw.Border.all(color: border, width: .5),
      borderRadius: pw.BorderRadius.circular(4),
    ),
    child: pw.Text(
      text,
      style: const pw.TextStyle(fontSize: 9, lineSpacing: 3),
    ),
  );

  pw.Widget keyValueTable(List<(String, String)> rows) => pw.Table(
    columnWidths: const {0: pw.FlexColumnWidth(1.8), 1: pw.FlexColumnWidth(1)},
    border: const pw.TableBorder(
      horizontalInside: pw.BorderSide(color: border, width: .5),
    ),
    children: rows
        .map(
          (row) => pw.TableRow(
            children: [
              _cell(row.$1, color: muted),
              _cell(row.$2, align: pw.TextAlign.right),
            ],
          ),
        )
        .toList(),
  );

  pw.Widget priceTable({
    required String description,
    required String unit,
    required String quantity,
    required String unitPrice,
    required String total,
  }) => pw.Table(
    columnWidths: const {
      0: pw.FlexColumnWidth(2.7),
      1: pw.FlexColumnWidth(.55),
      2: pw.FlexColumnWidth(.8),
      3: pw.FlexColumnWidth(1.15),
      4: pw.FlexColumnWidth(1.3),
    },
    border: const pw.TableBorder(
      horizontalInside: pw.BorderSide(color: border, width: .5),
      bottom: pw.BorderSide(color: border, width: .5),
    ),
    children: [
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: paperTint),
        children: [
          _cell('Позиция', bold: true),
          _cell('Ед.', bold: true),
          _cell('Объём', bold: true, align: pw.TextAlign.right),
          _cell('Цена за ед.', bold: true, align: pw.TextAlign.right),
          _cell('Сумма', bold: true, align: pw.TextAlign.right),
        ],
      ),
      pw.TableRow(
        children: [
          _cell(description),
          _cell(unit),
          _cell(quantity, align: pw.TextAlign.right),
          _cell(unitPrice, align: pw.TextAlign.right),
          _cell(total, align: pw.TextAlign.right),
        ],
      ),
    ],
  );

  final panelQuantity = result.panelCount?.toString() ?? 'Не определён';
  final wallArea = _area(result.wallArea);
  final openingArea = _area(result.openingArea);
  final netArea = _area(result.netArea);
  final knownSubtotal = result.knownKopecks == null
      ? 'Не определён'
      : formatMoney(result.knownKopecks);
  final materialUnitPrice = result.materialsKopecks == null
      ? 'Не предоставлена'
      : _enteredPrice(draft.panelPrice);
  final clientUnitPrice = result.workKopecks == null
      ? 'Не предоставлена'
      : _clientWorkUnitPrice(draft);

  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(42, 30, 42, 35),
      theme: pw.ThemeData.withFont(
        base: regular,
        bold: bold,
        italic: regular,
        boldItalic: bold,
      ).copyWith(defaultTextStyle: const pw.TextStyle(fontSize: 10)),
      header: (context) => pw.Container(
        padding: const pw.EdgeInsets.only(bottom: 12),
        margin: const pw.EdgeInsets.only(bottom: 11),
        decoration: const pw.BoxDecoration(
          border: pw.Border(bottom: pw.BorderSide(color: border, width: .8)),
        ),
        alignment: pw.Alignment.center,
        child: pw.Image(
          logo,
          width: 45 * PdfPageFormat.mm,
          height: 25 * PdfPageFormat.mm,
          fit: pw.BoxFit.contain,
        ),
      ),
      footer: (context) => pw.Container(
        padding: const pw.EdgeInsets.only(top: 10),
        decoration: const pw.BoxDecoration(
          border: pw.Border(top: pw.BorderSide(color: border, width: .5)),
        ),
        child: pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text(
              'Предварительный расчёт · СВОИ ЛЮДИ',
              style: const pw.TextStyle(fontSize: 8, color: muted),
            ),
            pw.Text(
              '${context.pageNumber} / ${context.pagesCount}',
              style: const pw.TextStyle(fontSize: 8, color: muted),
            ),
          ],
        ),
      ),
      build: (context) => [
        pw.Text('Предварительный расчёт сайдинга', style: titleStyle),
        pw.SizedBox(height: 7),
        pw.Text(
          'Количество панелей по полезной площади',
          style: const pw.TextStyle(fontSize: 10, color: muted),
        ),
        pw.SizedBox(height: 14),
        keyValueTable([
          ('Объект', _provided(objectName, 'Не указан')),
          ('Адрес', _provided(address, 'Не указан')),
          ('Дата расчёта', _irkutskDate(createdAt)),
          ('Материал', result.profileName),
        ]),
        if (draft.isExample) ...[
          pw.SizedBox(height: 12),
          note(
            'Использованы демонстрационные размеры. Перед заказом материалов '
            'замените их подтверждёнными замерами объекта.',
          ),
        ],
        sectionTitle('1. Объёмы и параметры'),
        keyValueTable([
          ('Площадь стен, м²', wallArea),
          ('Площадь проёмов, м²', openingArea),
          ('Чистая площадь облицовки, м²', netArea),
          (
            'Полезная ширина панели, м',
            _decimal(result.usefulWidth, digits: 3),
          ),
          ('Длина панели, м', _enteredDecimal(draft.panelLength)),
          (
            'Полезная площадь одной панели, м²',
            _decimal(result.usefulPanelArea, digits: 3),
          ),
          ('Заданный запас, %', _enteredDecimal(draft.reserve)),
          ('Панелей к заказу, шт.', panelQuantity),
        ]),
        sectionTitle('2. Материалы'),
        priceTable(
          description: 'Панели ${result.profileName}',
          unit: 'шт.',
          quantity: panelQuantity,
          unitPrice: materialUnitPrice,
          total: _amount(result.materialsKopecks),
        ),
        sectionTitle('3. Работы'),
        priceTable(
          description: 'Облицовка сайдингом',
          unit: 'м²',
          quantity: netArea,
          unitPrice: clientUnitPrice,
          total: _amount(result.workKopecks),
        ),
        pw.SizedBox(height: 13),
        pw.Container(
          padding: const pw.EdgeInsets.all(12),
          decoration: pw.BoxDecoration(
            color: paperTint,
            borderRadius: pw.BorderRadius.circular(4),
          ),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Expanded(
                child: pw.Text(
                  result.moneyComplete
                      ? 'Итого указанных позиций'
                      : 'Известный подытог',
                  style: headingStyle,
                ),
              ),
              pw.SizedBox(width: 12),
              pw.Text(knownSubtotal, style: headingStyle),
            ],
          ),
        ),
        if (!result.moneyComplete) ...[
          pw.SizedBox(height: 8),
          pw.Text(
            'Полная стоимость не определена: отсутствуют обязательные расценки. '
            'Неизвестные цены не заменены нулём.',
            style: const pw.TextStyle(
              fontSize: 9,
              color: muted,
              lineSpacing: 3,
            ),
          ),
        ],
        sectionTitle('4. Основание и границы расчёта'),
        note(
          'Чистая площадь = сумма площадей стен − сумма площадей проёмов. '
          'Количество панелей = округление вверх '
          '(чистая площадь × (1 + запас / 100) / полезная площадь панели). '
          'Объём работ рассчитан по чистой площади; запас материала его не увеличивает.',
        ),
        pw.SizedBox(height: 9),
        pw.Text(
          'Расчёт по площади не заменяет раскладку и раскрой. '
          'Длины стыков, доборные элементы, крепёж, подсистема, утепление, '
          'доставка и дополнительные работы определяются отдельно. '
          'НДС, условия оплаты и договорная цена этим документом не определяются.',
          style: const pw.TextStyle(fontSize: 9, lineSpacing: 3, color: muted),
        ),
        pw.SizedBox(height: 8),
        pw.Text(
          'Размеры профилей: предоставленная инструкция «Металл Профиль», '
          '3-е издание, 2019, стр. 6. Актуальную редакцию, размеры заказа '
          'и применимость монтажных решений необходимо проверить для выбранного изделия.',
          style: const pw.TextStyle(fontSize: 8, lineSpacing: 3, color: muted),
        ),
      ],
    ),
  );
  return document.save();
}

pw.Widget _cell(
  String text, {
  bool bold = false,
  PdfColor? color,
  pw.TextAlign align = pw.TextAlign.left,
}) => pw.Padding(
  padding: const pw.EdgeInsets.symmetric(vertical: 7, horizontal: 6),
  child: pw.Text(
    text,
    textAlign: align,
    style: pw.TextStyle(
      fontSize: 9,
      color: color,
      fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
      lineSpacing: 2,
    ),
  ),
);

String _provided(String value, String fallback) =>
    value.trim().isEmpty ? fallback : value.trim();

String _irkutskDate(DateTime value) {
  final local = value.toUtc().add(const Duration(hours: 8));
  return '${local.day.toString().padLeft(2, '0')}.'
      '${local.month.toString().padLeft(2, '0')}.${local.year}';
}

String _area(String? value) => _decimal(value);

String _decimal(String? value, {int digits = 2}) =>
    value == null ? 'Не определена' : formatArea(value, digits: digits);

String _enteredDecimal(String value) =>
    value.trim().isEmpty ? 'Не задан' : value.trim().replaceAll('.', ',');

String _amount(String? kopecks) =>
    kopecks == null ? 'Цена не предоставлена' : formatMoney(kopecks);

BigInt? _enteredKopecks(String raw) {
  final value = raw.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d{1,12}(?:\.\d{1,2})?$').hasMatch(value)) return null;
  final parts = value.split('.');
  return BigInt.parse(parts.first) * BigInt.from(100) +
      BigInt.parse(parts.length == 1 ? '0' : parts[1].padRight(2, '0'));
}

String _enteredPrice(String value) {
  final kopecks = _enteredKopecks(value);
  return kopecks == null ? 'Не предоставлена' : formatMoney('$kopecks');
}

String _clientWorkUnitPrice(CalculationDraft draft) {
  final base = _enteredKopecks(draft.workPrice);
  if (base == null) return 'Не предоставлена';
  if (draft.workPriceMode == 'client') return formatMoney('$base');
  // One tenth of a kopeck is kept for the unit rate. Rounding a fractional
  // client rate to two decimals here could contradict the exact line total.
  final thousandthsOfRuble = base * BigInt.from(14);
  final whole = thousandthsOfRuble ~/ BigInt.from(1000);
  final fractional = (thousandthsOfRuble % BigInt.from(1000))
      .toString()
      .padLeft(3, '0');
  final renderedFraction = fractional.endsWith('0')
      ? fractional.substring(0, 2)
      : fractional;
  return '$whole,$renderedFraction ₽';
}
