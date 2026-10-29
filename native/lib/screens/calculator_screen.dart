import 'package:flutter/material.dart';

import '../domain/siding_calculator.dart';

/// A project selector entry. Business records remain owned by the app store.
class CalculatorProject {
  const CalculatorProject({required this.id, required this.name});

  final String id;
  final String name;
}

/// Native, offline siding calculation for iPhone and Windows.
///
/// The parent uses a key tied to the active project so that every project keeps
/// its own draft. Controllers are retained while typing; recalculating a result
/// never replaces an input field or its selection.
class CalculatorScreen extends StatefulWidget {
  const CalculatorScreen({
    super.key,
    required this.initialDraft,
    required this.projects,
    required this.activeProjectId,
    required this.onProjectChanged,
    required this.onDraftChanged,
    required this.onSave,
    required this.onGuide,
  });

  final CalculationDraft initialDraft;
  final List<CalculatorProject> projects;
  final String? activeProjectId;
  final ValueChanged<String> onProjectChanged;
  final ValueChanged<CalculationDraft> onDraftChanged;
  final Future<bool> Function(CalculationDraft draft, CalculationResult result)
  onSave;
  final ValueChanged<String> onGuide;

  @override
  State<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends State<CalculatorScreen> {
  static const _ink = Color(0xff18352b);
  static const _muted = Color(0xff63746b);
  static const _line = Color(0xffe1e8dc);
  static const _lime = Color(0xffc6f246);
  static const _pale = Color(0xfff0f6e8);

  late CalculationDraft _draft;
  late final TextEditingController _length;
  late final TextEditingController _reserve;
  late final TextEditingController _panelPrice;
  late final TextEditingController _workPrice;
  final List<_WallControllers> _walls = [];
  final List<_OpeningControllers> _openings = [];
  int _rowSequence = 0;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _draft = widget.initialDraft;
    _length = TextEditingController(text: _draft.panelLength);
    _reserve = TextEditingController(text: _draft.reserve);
    _panelPrice = TextEditingController(text: _draft.panelPrice);
    _workPrice = TextEditingController(text: _draft.workPrice);
    _createRowControllers();
  }

  void _createRowControllers() {
    for (final wall in _draft.walls) {
      _walls.add(_WallControllers(_rowSequence++, wall));
    }
    for (final opening in _draft.openings) {
      _openings.add(_OpeningControllers(_rowSequence++, opening));
    }
  }

  @override
  void dispose() {
    _length.dispose();
    _reserve.dispose();
    _panelPrice.dispose();
    _workPrice.dispose();
    for (final wall in _walls) {
      wall.dispose();
    }
    for (final opening in _openings) {
      opening.dispose();
    }
    super.dispose();
  }

  void _notifyInputs({bool geometryChanged = false}) {
    final next = _draft.copyWith(
      isExample: geometryChanged ? false : _draft.isExample,
      panelLength: _length.text,
      reserve: _reserve.text,
      panelPrice: _panelPrice.text,
      workPrice: _workPrice.text,
      walls: _walls
          .map(
            (wall) =>
                WallInput(width: wall.width.text, height: wall.height.text),
          )
          .toList(growable: false),
      openings: _openings
          .map(
            (opening) => OpeningInput(
              width: opening.width.text,
              height: opening.height.text,
              count: opening.count.text,
            ),
          )
          .toList(growable: false),
    );
    setState(() => _draft = next);
    widget.onDraftChanged(next);
  }

  void _changeDraft(CalculationDraft draft) {
    setState(() => _draft = draft);
    widget.onDraftChanged(draft);
  }

  void _loadPreset(CalculationDraft draft) {
    FocusManager.instance.primaryFocus?.unfocus();
    for (final wall in _walls) {
      wall.dispose();
    }
    for (final opening in _openings) {
      opening.dispose();
    }
    _walls.clear();
    _openings.clear();
    _draft = draft;
    _length.text = draft.panelLength;
    _reserve.text = draft.reserve;
    _panelPrice.text = draft.panelPrice;
    _workPrice.text = draft.workPrice;
    _createRowControllers();
    setState(() {});
    widget.onDraftChanged(draft);
  }

  Future<void> _save(CalculationResult result) async {
    if (_saving || !result.complete || widget.activeProjectId == null) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _saving = true);
    try {
      final saved = await widget.onSave(_draft, result);
      if (!mounted) return;
      if (saved) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Расчёт сохранён в объекте.')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Не удалось сохранить расчёт. Попробуйте ещё раз.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = calculateSiding(_draft);
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 1000;
        final padding = constraints.maxWidth < 600 ? 16.0 : 28.0;
        return SingleChildScrollView(
          key: const PageStorageKey('siding-calculator-scroll'),
          padding: EdgeInsets.fromLTRB(padding, 22, padding, 40),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1320),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _heading(wide),
                  const SizedBox(height: 26),
                  if (wide)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(flex: 7, child: _form()),
                        const SizedBox(width: 24),
                        Expanded(flex: 4, child: _summary(result)),
                      ],
                    )
                  else ...[
                    _form(),
                    const SizedBox(height: 22),
                    _summary(result),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _heading(bool wide) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          const Expanded(child: _Eyebrow('НАПРАВЛЕНИЕ 01 / ФАСАДЫ')),
          _tag('Доступно без сети', Icons.offline_bolt_outlined),
        ],
      ),
      const SizedBox(height: 12),
      Text(
        'Калькулятор сайдинга',
        style: TextStyle(
          color: _ink,
          fontSize: wide ? 30 : 25,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.8,
          height: 1.2,
        ),
      ),
      const SizedBox(height: 10),
      const Text(
        'От размеров стены — к понятному количеству материалов.',
        style: TextStyle(color: _muted, fontSize: 14, height: 1.6),
      ),
    ],
  );

  Widget _form() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _materialSection(),
      const SizedBox(height: 20),
      _geometrySection(),
      const SizedBox(height: 20),
      _pricesSection(),
      const SizedBox(height: 16),
      Wrap(
        spacing: 10,
        runSpacing: 8,
        children: [
          TextButton.icon(
            key: const ValueKey('calc-empty'),
            onPressed: () => _loadPreset(CalculationDraft.empty()),
            icon: const Icon(Icons.restart_alt, size: 19),
            label: const Text('Начать пустой расчёт'),
          ),
          TextButton(
            key: const ValueKey('calc-example'),
            onPressed: () => _loadPreset(CalculationDraft.example()),
            child: const Text('Загрузить пример'),
          ),
        ],
      ),
    ],
  );

  Widget _materialSection() {
    final validProject = widget.projects.any(
      (project) => project.id == widget.activeProjectId,
    );
    final profile = sidingProfiles.firstWhere(
      (profile) => profile.id == _draft.profileId,
      orElse: () => sidingProfiles.first,
    );
    return _panel(
      children: [
        _sectionTitle('01 / ОБЪЕКТ И МАТЕРИАЛ', 'Что рассчитываем'),
        const SizedBox(height: 22),
        _responsivePair(
          _label(
            'Объект',
            DropdownButtonFormField<String>(
              key: ValueKey('calc-object-${widget.activeProjectId}'),
              initialValue: validProject ? widget.activeProjectId : '',
              isExpanded: true,
              decoration: _decoration(),
              items: [
                const DropdownMenuItem(
                  value: '',
                  child: Text('Выберите объект'),
                ),
                ...widget.projects.map(
                  (project) => DropdownMenuItem(
                    value: project.id,
                    child: Text(
                      project.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
              onChanged: widget.projects.isEmpty
                  ? null
                  : (value) {
                      if (value != null && value.isNotEmpty) {
                        widget.onProjectChanged(value);
                      }
                    },
            ),
          ),
          _label(
            'Профиль · Металл Профиль',
            DropdownButtonFormField<String>(
              key: ValueKey('calc-profile-${_draft.profileId}'),
              initialValue: profile.id,
              isExpanded: true,
              decoration: _decoration(),
              items: sidingProfiles
                  .map(
                    (profile) => DropdownMenuItem(
                      value: profile.id,
                      child: Text(
                        profile.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (value) {
                if (value != null) {
                  _changeDraft(_draft.copyWith(profileId: value));
                }
              },
            ),
          ),
        ),
        const SizedBox(height: 18),
        _responsivePair(
          _numberField(
            key: const ValueKey('calc-panel-length'),
            label: 'Длина панели, м',
            controller: _length,
            hint: 'По заказу, до 6 м',
          ),
          _numberField(
            key: const ValueKey('calc-reserve'),
            label: 'Задайте запас, %',
            controller: _reserve,
            hint: 'Введите значение',
            helper: '0 — расчёт без запаса',
          ),
        ),
        const SizedBox(height: 18),
        Text(
          'Полезная ширина: ${profile.width.replaceAll('.', ',')} м. '
          'Размеры — из документа производителя, стр. 6.',
          style: const TextStyle(color: _muted, fontSize: 13, height: 1.65),
        ),
        if (widget.projects.isEmpty) ...[
          const SizedBox(height: 12),
          const Text(
            'Создайте объект в разделе «Объекты», чтобы сохранить результат.',
            style: TextStyle(color: Color(0xff806330), fontSize: 13),
          ),
        ],
      ],
    );
  }

  Widget _geometrySection() => _panel(
    children: [
      _sectionTitle('02 / ГЕОМЕТРИЯ', 'Размеры стен'),
      const SizedBox(height: 12),
      if (_draft.isExample) ...[
        _notice(
          'Пример размеров',
          'Показаны демонстрационные замеры и расчёт без запаса. '
              'Замените их своими или начните пустой расчёт.',
          amber: true,
        ),
        const SizedBox(height: 18),
      ],
      for (var index = 0; index < _walls.length; index++) ...[
        _wallRow(index),
        if (index != _walls.length - 1) const SizedBox(height: 12),
      ],
      const SizedBox(height: 10),
      TextButton.icon(
        key: const ValueKey('calc-add-wall'),
        onPressed: _walls.length >= 30
            ? null
            : () {
                _walls.add(_WallControllers(_rowSequence++, const WallInput()));
                _notifyInputs(geometryChanged: true);
              },
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Добавить стену'),
      ),
      const SizedBox(height: 24),
      const Text(
        'Окна и двери',
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      const Text(
        'Проёмы вычитаются из площади один раз.',
        style: TextStyle(fontSize: 13, color: _muted, height: 1.6),
      ),
      const SizedBox(height: 18),
      if (_openings.isEmpty)
        const Text(
          'Проёмы не добавлены. Укажите их, если они есть на этих стенах.',
          style: TextStyle(color: _muted, fontSize: 13, height: 1.65),
        ),
      for (var index = 0; index < _openings.length; index++) ...[
        _openingRow(index),
        if (index != _openings.length - 1) const SizedBox(height: 12),
      ],
      const SizedBox(height: 10),
      TextButton.icon(
        key: const ValueKey('calc-add-opening'),
        onPressed: _openings.length >= 30
            ? null
            : () {
                _openings.add(
                  _OpeningControllers(_rowSequence++, const OpeningInput()),
                );
                _notifyInputs(geometryChanged: true);
              },
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Добавить проём'),
      ),
    ],
  );

  Widget _wallRow(int index) {
    final wall = _walls[index];
    return _dimensionBox(
      key: ValueKey('wall-row-${wall.id}'),
      title: 'Стена ${index + 1}',
      onRemove: _walls.length <= 1
          ? null
          : () {
              _walls.removeAt(index).dispose();
              _notifyInputs(geometryChanged: true);
            },
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _numberField(
                key: ValueKey('calc-wall-$index-width'),
                label: 'Ширина, м',
                controller: wall.width,
                hint: '0,00',
                geometry: true,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                key: ValueKey('calc-wall-$index-height'),
                label: 'Высота, м',
                controller: wall.height,
                hint: '0,00',
                geometry: true,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _openingRow(int index) {
    final opening = _openings[index];
    return _dimensionBox(
      key: ValueKey('opening-row-${opening.id}'),
      title: 'Проём ${index + 1}',
      onRemove: () {
        _openings.removeAt(index).dispose();
        _notifyInputs(geometryChanged: true);
      },
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _numberField(
                key: ValueKey('calc-opening-$index-width'),
                label: 'Ширина, м',
                controller: opening.width,
                hint: '0,00',
                geometry: true,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                key: ValueKey('calc-opening-$index-height'),
                label: 'Высота, м',
                controller: opening.height,
                hint: '0,00',
                geometry: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 190),
            child: _numberField(
              key: ValueKey('calc-opening-$index-count'),
              label: 'Количество, шт.',
              controller: opening.count,
              hint: '1',
              geometry: true,
              integer: true,
            ),
          ),
        ),
      ],
    );
  }

  Widget _pricesSection() => _panel(
    children: [
      _sectionTitle('03 / НЕОБЯЗАТЕЛЬНО', 'Ваши расценки'),
      const SizedBox(height: 10),
      const Text(
        'Готовые цены не подставляются. Введите подтверждённую стоимость.',
        style: TextStyle(color: _muted, fontSize: 13, height: 1.65),
      ),
      const SizedBox(height: 20),
      _responsivePair(
        _numberField(
          key: const ValueKey('calc-panel-price'),
          label: 'Цена панели, ₽/шт.',
          controller: _panelPrice,
          hint: 'Цена не предоставлена',
        ),
        _numberField(
          key: const ValueKey('calc-work-price'),
          label: 'Ставка работ, ₽/м²',
          controller: _workPrice,
          hint: 'Цена не предоставлена',
        ),
      ),
      const SizedBox(height: 20),
      _label(
        'Как введена ставка работ',
        DropdownButtonFormField<String>(
          key: ValueKey('calc-work-mode-${_draft.workPriceMode}'),
          initialValue: _draft.workPriceMode == 'client' ? 'client' : 'base',
          decoration: _decoration(),
          isExpanded: true,
          items: const [
            DropdownMenuItem(
              value: 'base',
              child: Text(
                'Базовая — применить +40%',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            DropdownMenuItem(
              value: 'client',
              child: Text(
                'Клиентская — уже включает надбавку',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          onChanged: (value) {
            if (value != null) {
              _changeDraft(_draft.copyWith(workPriceMode: value));
            }
          },
        ),
      ),
      const SizedBox(height: 14),
      const Text(
        'Правило компании применяется к базовой работе. '
        'На материалы надбавка не начисляется.',
        style: TextStyle(color: _muted, fontSize: 13, height: 1.65),
      ),
    ],
  );

  Widget _summary(CalculationResult result) {
    final canSave = result.complete && widget.activeProjectId != null;
    return _panel(
      children: [
        _sectionTitle('РЕЗУЛЬТАТ', 'Фасад в цифрах'),
        const SizedBox(height: 20),
        Semantics(
          label:
              'Условная схема фасада с двумя окнами. '
              'Размеры задаются в форме.',
          child: Container(
            height: 180,
            width: double.infinity,
            decoration: BoxDecoration(
              color: const Color(0xfff6f9f1),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: _line),
            ),
            padding: const EdgeInsets.all(18),
            child: const CustomPaint(painter: _FacadePainter()),
          ),
        ),
        const SizedBox(height: 18),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _metric(
                'Чистая площадь',
                formatArea(result.netArea),
                'м²',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _metric(
                'Панелей к заказу',
                result.panelCount?.toString() ?? '—',
                'шт.',
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        _valueRow('Площадь стен', '${formatArea(result.wallArea)} м²'),
        _valueRow('Проёмы', '${formatArea(result.openingArea)} м²'),
        _valueRow(
          'Полезная площадь панели',
          '${formatArea(result.usefulPanelArea, digits: 3)} м²',
        ),
        if (result.orderArea != null)
          _valueRow(
            'Площадь заказанных панелей',
            '${formatArea(result.orderArea)} м²',
          ),
        const SizedBox(height: 22),
        const Divider(color: _line, height: 1),
        const SizedBox(height: 22),
        const Text(
          'Стоимость',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        _valueRow('Материалы · панели', formatMoney(result.materialsKopecks)),
        _valueRow('Работы · облицовка', formatMoney(result.workKopecks)),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: _pale,
            border: Border.all(color: const Color(0xffdde9ce)),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                result.moneyComplete
                    ? 'Итог указанных позиций'
                    : 'Известный подытог',
                style: const TextStyle(color: _muted, fontSize: 13),
              ),
              const SizedBox(height: 8),
              Text(
                result.knownKopecks == null
                    ? 'Не определён'
                    : formatMoney(result.knownKopecks),
                style: const TextStyle(
                  color: Color(0xff4b6d35),
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text(
          result.moneyComplete
              ? 'Доборные элементы, подсистема, утепление, крепёж и доставка '
                    'уточняются отдельно.'
              : 'Полный итог не определён. Заполните цены: '
                    'неизвестные значения не равны нулю.',
          style: const TextStyle(color: _muted, fontSize: 13, height: 1.7),
        ),
        if (result.errors.isNotEmpty) ...[
          const SizedBox(height: 18),
          _notice('Нужно исправить', result.errors.join('\n'), amber: true),
        ],
        if (result.errors.isEmpty && result.missing.isNotEmpty) ...[
          const SizedBox(height: 18),
          Text(
            'Ещё нужно: ${result.missing.join(' · ')}.',
            style: const TextStyle(color: _muted, fontSize: 13, height: 1.7),
          ),
        ],
        const SizedBox(height: 16),
        Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 12),
            title: const Text(
              'Формула и основание расчёта',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
            children: [
              _formulaText(result.formula),
              _formulaText(
                'Чистая площадь = сумма площадей стен − сумма площадей '
                'проёмов. Запас материала не увеличивает объём труда.',
              ),
              _formulaText(
                'Расчёт количества по площади предварительный. '
                'Раскладка, раскрой, стыки и доборные элементы проверяются отдельно.',
              ),
              _formulaText(
                'Размеры: «Металл Профиль. Инструкция по монтажу», '
                '3-е издание, 2019, стр. 6. '
                'Редакцию и размеры заказа проверьте перед закупкой.',
              ),
              if (_draft.workPrice.isNotEmpty)
                _formulaText(
                  _draft.workPriceMode == 'client'
                      ? 'Указана клиентская ставка. Повторная надбавка не начисляется.'
                      : 'Внутренний расчёт работ: база '
                            '${formatMoney(result.baseWorkKopecks)}, '
                            'надбавка 40% ${formatMoney(result.markupKopecks)}, '
                            'клиентская стоимость ${formatMoney(result.workKopecks)}.',
                ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const ValueKey('calc-save'),
            style: FilledButton.styleFrom(
              backgroundColor: _lime,
              foregroundColor: _ink,
              disabledBackgroundColor: const Color(0xffe8eddf),
              disabledForegroundColor: const Color(0xff8b9685),
              minimumSize: const Size(0, 50),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            onPressed: canSave && !_saving ? () => _save(result) : null,
            icon: _saving
                ? const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_outlined, size: 20),
            label: Text(_saving ? 'Сохраняем…' : 'Сохранить расчёт'),
          ),
        ),
        if (widget.activeProjectId == null) ...[
          const SizedBox(height: 10),
          const Text(
            'Выберите объект для сохранения.',
            style: TextStyle(color: _muted, fontSize: 13),
          ),
        ],
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const ValueKey('calc-guide'),
            onPressed: () => widget.onGuide(_draft.profileId),
            icon: const Icon(Icons.menu_book_outlined, size: 20),
            label: const Text('Инструкция по монтажу'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _ink,
              side: const BorderSide(color: _line),
              minimumSize: const Size(0, 50),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),
        ),
        const SizedBox(height: 15),
        const Text(
          'Предварительный расчёт количества. Состав системы '
          'и необходимые узлы уточняются для вашего объекта.',
          style: TextStyle(color: _muted, fontSize: 13, height: 1.7),
        ),
      ],
    );
  }

  Widget _panel({required List<Widget> children}) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: _line),
      borderRadius: BorderRadius.circular(18),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0418352b),
          blurRadius: 18,
          offset: Offset(0, 5),
        ),
      ],
    ),
    child: Material(
      type: MaterialType.transparency,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );

  Widget _sectionTitle(String eyebrow, String title) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _Eyebrow(eyebrow),
      const SizedBox(height: 8),
      Text(
        title,
        style: const TextStyle(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          color: _ink,
        ),
      ),
    ],
  );

  Widget _label(String label, Widget input) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        label,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: _muted,
        ),
      ),
      const SizedBox(height: 9),
      input,
    ],
  );

  Widget _numberField({
    required Key key,
    required String label,
    required TextEditingController controller,
    required String hint,
    String? helper,
    bool geometry = false,
    bool integer = false,
  }) => _label(
    label,
    TextField(
      key: key,
      controller: controller,
      keyboardType: TextInputType.numberWithOptions(decimal: !integer),
      textInputAction: TextInputAction.next,
      style: const TextStyle(fontSize: 14, color: _ink),
      decoration: _decoration(hint: hint, helper: helper),
      onChanged: (_) => _notifyInputs(geometryChanged: geometry),
    ),
  );

  InputDecoration _decoration({String? hint, String? helper}) =>
      InputDecoration(
        hintText: hint,
        helperText: helper,
        helperMaxLines: 2,
        hintStyle: const TextStyle(fontSize: 13, color: Color(0xff879283)),
        helperStyle: const TextStyle(fontSize: 12, color: _muted),
        filled: true,
        fillColor: const Color(0xfffcfdf9),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 15,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: _line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: _line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: Color(0xff86a64a), width: 1.5),
        ),
      );

  Widget _responsivePair(Widget first, Widget second) => LayoutBuilder(
    builder: (context, constraints) => constraints.maxWidth >= 500
        ? Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: first),
              const SizedBox(width: 16),
              Expanded(child: second),
            ],
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [first, const SizedBox(height: 18), second],
          ),
  );

  Widget _dimensionBox({
    required Key key,
    required String title,
    required VoidCallback? onRemove,
    required List<Widget> children,
  }) => Container(
    key: key,
    padding: const EdgeInsets.fromLTRB(14, 8, 14, 16),
    decoration: BoxDecoration(
      color: const Color(0xfff8faf4),
      border: Border.all(color: _line),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            IconButton(
              onPressed: onRemove,
              tooltip: 'Удалить ${title.toLowerCase()}',
              icon: const Icon(Icons.delete_outline, size: 20),
              color: _muted,
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            ),
          ],
        ),
        const SizedBox(height: 2),
        ...children,
      ],
    ),
  );

  Widget _metric(String label, String value, String unit) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: _pale,
      border: Border.all(color: _line),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: _muted, fontSize: 12, height: 1.5),
        ),
        const SizedBox(height: 12),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: value,
                style: const TextStyle(
                  color: Color(0xff587b3d),
                  fontSize: 25,
                  height: 1.2,
                  fontWeight: FontWeight.w800,
                ),
              ),
              TextSpan(
                text: ' $unit',
                style: const TextStyle(color: _muted, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _valueRow(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 11),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          flex: 5,
          child: Text(
            label,
            style: const TextStyle(color: _muted, fontSize: 13, height: 1.65),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          flex: 4,
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: _ink,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 1.65,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _notice(String title, String message, {bool amber = false}) =>
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: amber ? const Color(0xfffaf5e8) : _pale,
          border: Border.all(color: amber ? const Color(0xffeee1bf) : _line),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                color: amber ? const Color(0xff806330) : _ink,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              message,
              style: TextStyle(
                color: amber ? const Color(0xff806330) : _muted,
                fontSize: 13,
                height: 1.7,
              ),
            ),
          ],
        ),
      );

  Widget _formulaText(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(
        text,
        style: const TextStyle(color: _muted, fontSize: 13, height: 1.75),
      ),
    ),
  );

  Widget _tag(String text, IconData icon) => Container(
    decoration: BoxDecoration(
      color: _pale,
      borderRadius: BorderRadius.circular(7),
    ),
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: const Color(0xff59773f)),
        const SizedBox(width: 6),
        Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Color(0xff59773f),
          ),
        ),
      ],
    ),
  );
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      color: Color(0xff71835f),
      fontSize: 10,
      height: 1.5,
      letterSpacing: 1.1,
      fontWeight: FontWeight.w700,
    ),
  );
}

class _WallControllers {
  _WallControllers(this.id, WallInput wall)
    : width = TextEditingController(text: wall.width),
      height = TextEditingController(text: wall.height);
  final int id;
  final TextEditingController width;
  final TextEditingController height;

  void dispose() {
    width.dispose();
    height.dispose();
  }
}

class _OpeningControllers {
  _OpeningControllers(this.id, OpeningInput opening)
    : width = TextEditingController(text: opening.width),
      height = TextEditingController(text: opening.height),
      count = TextEditingController(text: opening.count);
  final int id;
  final TextEditingController width;
  final TextEditingController height;
  final TextEditingController count;

  void dispose() {
    width.dispose();
    height.dispose();
    count.dispose();
  }
}

/// A schematic illustration, never used as the company's brand mark.
class _FacadePainter extends CustomPainter {
  const _FacadePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 360;
    final height = size.height / scale;
    canvas.save();
    canvas.scale(scale);
    canvas.translate(0, (height - 140) / 2);
    final stroke = Paint()
      ..color = const Color(0xff637f78)
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;
    final wall = Path()
      ..moveTo(35, 59)
      ..lineTo(180, 10)
      ..lineTo(325, 59)
      ..lineTo(325, 130)
      ..lineTo(35, 130)
      ..close();
    canvas.drawPath(wall, Paint()..color = const Color(0xffe7eeea));
    canvas.save();
    canvas.clipPath(wall);
    final siding = Paint()
      ..color = const Color(0xffc2d0c5)
      ..strokeWidth = 1;
    for (var y = 24.0; y < 136; y += 10) {
      canvas.drawLine(Offset(32, y), Offset(328, y), siding);
    }
    canvas.restore();
    canvas.drawPath(wall, stroke);
    final roof = Path()
      ..moveTo(22, 58)
      ..lineTo(180, 4)
      ..lineTo(338, 58);
    canvas.drawPath(
      roof,
      Paint()
        ..color = const Color(0xff284d41)
        ..strokeWidth = 2.7
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round,
    );
    for (final x in [78.0, 232.0]) {
      final window = Rect.fromLTWH(x, 75, 50, 40);
      canvas.drawRect(window, Paint()..color = const Color(0xfffbfdf8));
      canvas.drawRect(window, stroke);
      canvas.drawLine(Offset(x + 25, 75), Offset(x + 25, 115), stroke);
      canvas.drawLine(Offset(x, 95), Offset(x + 50, 95), stroke);
    }
    canvas.drawLine(
      const Offset(27, 131),
      const Offset(333, 131),
      Paint()
        ..color = const Color(0xff284d41)
        ..strokeWidth = 2.5,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
