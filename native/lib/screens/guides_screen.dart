import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/manual_library.dart';
import 'manual_library_panel.dart';
import 'pdf_document_screen.dart';

const _navy = Color(0xff18352b);
const _lime = Color(0xffc6f246);
const _canvas = Color(0xfff5f6f3);
const _muted = Color(0xff647366);
const _border = Color(0xffe1e7dd);

/// Native, offline library. No HTML renderer, WebView, or browser is involved.
class GuidesScreen extends StatefulWidget {
  const GuidesScreen({
    super.key,
    this.initialProfileId,
    required this.manualLibrary,
  });

  final String? initialProfileId;
  final ManualLibrary manualLibrary;

  @override
  State<GuidesScreen> createState() => _GuidesScreenState();
}

class _GuidesScreenState extends State<GuidesScreen> {
  late Future<List<_GuideCategory>> _catalog;
  String? _categoryId;
  String? _profileId;
  String _manufacturer = '';
  String _query = '';
  int _stageIndex = 2;
  bool _expanded = false;
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _profileId = _normaliseProfile(widget.initialProfileId);
    _catalog = _loadCatalog();
  }

  @override
  void didUpdateWidget(covariant GuidesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialProfileId != widget.initialProfileId) {
      _profileId = _normaliseProfile(widget.initialProfileId);
      _categoryId = null;
      _manufacturer = '';
      _query = '';
      _stageIndex = 2;
      _searchController.clear();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String? _normaliseProfile(String? id) =>
      id == 'mp-shipboard-226' ? 'mp-shipboard-226-manual' : id;

  Future<List<_GuideCategory>> _loadCatalog() async {
    final raw = await rootBundle.loadString('assets/data/guide-catalog.json');
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final categories = (json['categories'] as List<dynamic>)
        .map((value) => _GuideCategory.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
    if (categories.isEmpty) throw const FormatException('Каталог пуст');
    return categories;
  }

  void _chooseCategory(_GuideCategory category) {
    setState(() {
      _categoryId = category.id;
      _profileId = category.profiles.first.id;
      _manufacturer = '';
      _query = '';
      _stageIndex = 2;
      _expanded = false;
      _searchController.clear();
    });
    _scrollToReader();
  }

  void _chooseProfile(_GuideProfile profile) {
    setState(() {
      _profileId = profile.id;
      _stageIndex = 2;
    });
    _scrollToReader();
  }

  void _scrollToReader() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.manualLibrary,
    builder: (context, _) => _buildCatalog(context),
  );

  Widget _buildCatalog(BuildContext context) {
    return FutureBuilder<List<_GuideCategory>>(
      future: _catalog,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.menu_book_rounded, size: 40, color: _muted),
                  const SizedBox(height: 16),
                  const Text(
                    'Не удалось открыть библиотеку',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  const Text('Проверьте наличие файлов инструкций в сборке.'),
                  const SizedBox(height: 16),
                  OutlinedButton(
                    onPressed: () => setState(() => _catalog = _loadCatalog()),
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final categories = snapshot.data!;
        final requested = categories
            .expand((category) => category.profiles)
            .where((profile) => profile.id == _profileId)
            .firstOrNull;
        final category = requested == null
            ? categories.where((item) => item.id == _categoryId).firstOrNull ??
                  categories
                      .where((item) => item.id == 'metal-siding')
                      .firstOrNull ??
                  categories.first
            : categories.firstWhere(
                (item) => item.profiles.contains(requested),
              );
        final profile = requested ?? category.profiles.first;
        final manufacturers = category.profiles
            .map((profile) => profile.manufacturer)
            .toSet()
            .toList(growable: false);
        final validManufacturer = manufacturers.contains(_manufacturer)
            ? _manufacturer
            : '';
        final matching = category.profiles
            .where((item) {
              final text =
                  '${item.name} ${item.manufacturer} ${item.familyName}'
                      .toLowerCase();
              return (_query.isEmpty || text.contains(_query.toLowerCase())) &&
                  (validManufacturer.isEmpty ||
                      validManufacturer == item.manufacturer);
            })
            .toList(growable: false);
        final visible =
            _expanded || _query.isNotEmpty || validManufacturer.isNotEmpty
            ? matching
            : matching.take(6).toList(growable: false);

        return LayoutBuilder(
          builder: (context, constraints) {
            final desktop = constraints.maxWidth >= 1000;
            final content = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _reader(context, profile),
                const SizedBox(height: 26),
                Text(
                  category.name,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: _navy,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  category.description,
                  style: const TextStyle(
                    color: _muted,
                    fontSize: 14,
                    height: 1.6,
                  ),
                ),
                const SizedBox(height: 16),
                LayoutBuilder(
                  builder: (context, inner) {
                    final search = TextField(
                      controller: _searchController,
                      onChanged: (value) =>
                          setState(() => _query = value.trim()),
                      decoration: const InputDecoration(
                        labelText: 'Найти профиль или производителя',
                        prefixIcon: Icon(Icons.search_rounded),
                        border: OutlineInputBorder(),
                        filled: true,
                        fillColor: Colors.white,
                      ),
                    );
                    final maker = _select(
                      label: 'Производитель',
                      value: validManufacturer,
                      items: {
                        '': 'Все производители',
                        for (final name in manufacturers) name: name,
                      },
                      onChanged: (value) =>
                          setState(() => _manufacturer = value),
                    );
                    return inner.maxWidth >= 620
                        ? Row(
                            children: [
                              Expanded(child: search),
                              const SizedBox(width: 16),
                              Expanded(child: maker),
                            ],
                          )
                        : Column(
                            children: [
                              search,
                              const SizedBox(height: 12),
                              maker,
                            ],
                          );
                  },
                ),
                const SizedBox(height: 18),
                if (matching.isEmpty)
                  _panel(
                    const Column(
                      children: [
                        Icon(Icons.search_off_rounded, size: 36, color: _muted),
                        SizedBox(height: 12),
                        Text(
                          'Профиль не найден',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        SizedBox(height: 8),
                        Text('Попробуйте другое название или производителя.'),
                      ],
                    ),
                  )
                else
                  LayoutBuilder(
                    builder: (context, inner) {
                      final columns = inner.maxWidth >= 680 ? 2 : 1;
                      final width =
                          (inner.maxWidth - (columns - 1) * 16) / columns;
                      return Wrap(
                        spacing: 16,
                        runSpacing: 16,
                        children: visible
                            .map(
                              (item) => SizedBox(
                                width: width,
                                child: _profileCard(
                                  item,
                                  item.id == profile.id,
                                ),
                              ),
                            )
                            .toList(growable: false),
                      );
                    },
                  ),
                if (matching.length > 6 &&
                    _query.isEmpty &&
                    validManufacturer.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 18),
                    child: Center(
                      child: OutlinedButton.icon(
                        onPressed: () => setState(() => _expanded = !_expanded),
                        icon: Icon(
                          _expanded ? Icons.expand_less : Icons.expand_more,
                        ),
                        label: Text(
                          _expanded
                              ? 'Показать меньше'
                              : 'Все ${matching.length} профилей',
                        ),
                      ),
                    ),
                  ),
              ],
            );
            return SingleChildScrollView(
              key: const PageStorageKey('native-guide-library'),
              controller: _scrollController,
              padding: EdgeInsets.all(desktop ? 24 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _heading(categories.length),
                  const SizedBox(height: 20),
                  if (desktop)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 210,
                          child: _categoryRail(categories, category),
                        ),
                        const SizedBox(width: 24),
                        Expanded(child: content),
                      ],
                    )
                  else ...[
                    _select(
                      label: 'Категория материала',
                      value: category.id,
                      items: {
                        for (final item in categories) item.id: item.name,
                      },
                      onChanged: (id) => _chooseCategory(
                        categories.firstWhere((item) => item.id == id),
                      ),
                    ),
                    const SizedBox(height: 16),
                    content,
                  ],
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _heading(int count) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'БИБЛИОТЕКА МОНТАЖА',
        style: TextStyle(
          fontSize: 12,
          letterSpacing: 1.4,
          color: _muted,
          fontWeight: FontWeight.w700,
        ),
      ),
      const SizedBox(height: 10),
      const Text(
        'Понятный монтаж\nдля выбранного материала.',
        style: TextStyle(
          fontSize: 29,
          height: 1.2,
          color: _navy,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 12),
      _badge(
        '$count категорий · памятки доступны офлайн',
        icon: Icons.offline_pin_outlined,
      ),
      const SizedBox(height: 12),
      const Text(
        'В каталоге есть краткие памятки и источники. Подробный иллюстрированный образец — для конкретных изделий «Металл Профиль».',
        style: TextStyle(color: _muted, fontSize: 14, height: 1.7),
      ),
    ],
  );

  Widget _categoryRail(
    List<_GuideCategory> categories,
    _GuideCategory selected,
  ) => _panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Материалы',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
        ),
        const SizedBox(height: 14),
        for (final item in categories)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Material(
              color: item.id == selected.id
                  ? const Color(0xffeef5df)
                  : Colors.white,
              borderRadius: BorderRadius.circular(9),
              child: InkWell(
                onTap: () => _chooseCategory(item),
                borderRadius: BorderRadius.circular(9),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 13,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.name,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.4,
                            color: _navy,
                            fontWeight: item.id == selected.id
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        '${item.profiles.length}',
                        style: const TextStyle(fontSize: 12, color: _muted),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
    padding: 14,
  );

  Widget _reader(BuildContext context, _GuideProfile profile) {
    final illustrated = profile.manualPage != null;
    final stage = _stages[_stageIndex];
    final page = stage.page ?? profile.manualPage ?? 17;
    final steps = illustrated
        ? _manualSteps(profile, _stageIndex)
        : profile.mounting;
    final notes = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          illustrated ? 'ЭТАП ${_stageIndex + 1} ИЗ 5' : 'ПОСЛЕДОВАТЕЛЬНОСТЬ',
          style: const TextStyle(
            fontSize: 12,
            letterSpacing: 1.1,
            color: _muted,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          illustrated ? stage.title : 'Основные шаги монтажа',
          style: const TextStyle(
            fontSize: 20,
            height: 1.35,
            fontWeight: FontWeight.w700,
            color: _navy,
          ),
        ),
        const SizedBox(height: 18),
        if (steps.isEmpty)
          const Text(
            'Для этого варианта требуется точная инструкция производителя.',
            style: TextStyle(fontSize: 14, height: 1.7, color: _muted),
          ),
        for (var index = 0; index < steps.length; index++)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0xffeef5df),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${index + 1}',
                    style: const TextStyle(
                      fontSize: 13,
                      color: _navy,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    steps[index],
                    style: const TextStyle(
                      fontSize: 14,
                      height: 1.8,
                      color: _navy,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (illustrated) ...[
          const SizedBox(height: 6),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ManualReader(initialPage: page),
              ),
            ),
            icon: const Icon(Icons.fullscreen_rounded),
            label: Text('Читать на устройстве · стр. $page'),
            style: FilledButton.styleFrom(
              backgroundColor: _lime,
              foregroundColor: _navy,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
            ),
          ),
          const SizedBox(height: 15),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xfff7f3e7),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text(
              'Металл Профиль · 3-е издание, 2019.\nРедакцию и применимость к вашему заказу проверить перед монтажом.',
              style: TextStyle(
                color: Color(0xff76603d),
                fontSize: 13,
                height: 1.7,
              ),
            ),
          ),
        ],
      ],
    );
    return _panel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _badge(
            illustrated
                ? 'Иллюстрированный образец'
                : profile.sources.isEmpty
                ? 'Памятка · источник не указан'
                : 'Краткая памятка',
            icon: illustrated ? Icons.menu_book_rounded : Icons.notes_rounded,
          ),
          const SizedBox(height: 14),
          Text(
            profile.familyName,
            style: const TextStyle(
              fontSize: 25,
              fontWeight: FontWeight.w700,
              color: _navy,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${profile.manufacturer} · ${profile.name}',
            style: const TextStyle(color: _muted, fontSize: 14, height: 1.6),
          ),
          const SizedBox(height: 20),
          if (illustrated) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (var index = 0; index < _stages.length; index++)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(_stages[index].label),
                        selected: _stageIndex == index,
                        showCheckmark: false,
                        onSelected: (_) => setState(() => _stageIndex = index),
                        selectedColor: const Color(0xffe9f4d2),
                        labelStyle: const TextStyle(fontSize: 13, color: _navy),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 22),
          ],
          LayoutBuilder(
            builder: (context, inner) {
              if (!illustrated) return notes;
              final illustration = Semantics(
                button: true,
                label:
                    'Открыть оригинальную страницу $page инструкции Металл Профиль',
                child: InkWell(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ManualReader(initialPage: page),
                    ),
                  ),
                  borderRadius: BorderRadius.circular(10),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.asset(
                      _pageAsset(page),
                      fit: BoxFit.contain,
                      semanticLabel:
                          'Страница $page инструкции: ${stage.label}',
                      errorBuilder: (_, error, stack) => const SizedBox(
                        height: 250,
                        child: Center(
                          child: Text('Страница не найдена в сборке'),
                        ),
                      ),
                    ),
                  ),
                ),
              );
              if (inner.maxWidth >= 660) {
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: illustration),
                    const SizedBox(width: 24),
                    Expanded(child: notes),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 420,
                    width: double.infinity,
                    child: illustration,
                  ),
                  const SizedBox(height: 24),
                  notes,
                ],
              );
            },
          ),
          const SizedBox(height: 20),
          ManualLibraryPanel(
            key: ValueKey('manual-library-${profile.id}'),
            profileId: profile.id,
            profileName: profile.name,
            library: widget.manualLibrary,
            sources: [
              for (final source in profile.sources)
                if (!source.userProvided)
                  if (_pdfSourceUrl(source.url) case final Uri url)
                    ManualDownloadSource(
                      title: source.title,
                      url: url,
                      downloadable: source.availability != 'unavailable',
                    ),
            ],
          ),
          const SizedBox(height: 22),
          const Divider(color: _border),
          ExpansionTile(
            key: PageStorageKey('guide-accessories-${profile.id}'),
            tilePadding: EdgeInsets.zero,
            title: const Text(
              'Комплектующие и область применения',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
            children: [
              _bullets('Комплектующие', profile.accessories),
              _bullets('Что проверить', profile.limitations),
            ],
          ),
          ExpansionTile(
            key: PageStorageKey('guide-sources-${profile.id}'),
            tilePadding: EdgeInsets.zero,
            title: const Text(
              'Источники и редакции',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
            children: [
              if (profile.sources.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Источник требует уточнения.'),
                ),
              for (final source in profile.sources) _source(context, source),
            ],
          ),
        ],
      ),
    );
  }

  Widget _profileCard(_GuideProfile profile, bool selected) {
    final pdfCount = widget.manualLibrary.recordsFor(profile.id).length;
    return Container(
      key: ValueKey('guide-card-${profile.id}'),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: selected ? const Color(0xff9dbe66) : _border,
          width: selected ? 1.5 : 1,
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            profile.manufacturer.toUpperCase(),
            style: const TextStyle(
              fontSize: 12,
              letterSpacing: 1,
              color: _muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            profile.name,
            style: const TextStyle(
              fontSize: 17,
              height: 1.45,
              color: _navy,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          _badge(
            profile.manualPage != null
                ? 'С иллюстрациями · PDF 2019'
                : profile.sources.isEmpty
                ? 'Памятка · источник не указан'
                : 'Краткая памятка и источники',
          ),
          if (pdfCount > 0) ...[
            const SizedBox(height: 10),
            _badge(
              'PDF на устройстве: $pdfCount',
              icon: Icons.offline_pin_outlined,
            ),
          ],
          const SizedBox(height: 18),
          OutlinedButton.icon(
            key: ValueKey('guide-select-${profile.id}'),
            onPressed: () => _chooseProfile(profile),
            icon: Icon(
              selected ? Icons.check_rounded : Icons.arrow_forward_rounded,
              size: 18,
            ),
            label: Text(
              selected
                  ? (profile.sources.isEmpty
                        ? 'Памятка выбрана'
                        : 'Инструкция выбрана')
                  : (profile.sources.isEmpty
                        ? 'Открыть памятку'
                        : 'Читать инструкцию'),
            ),
          ),
        ],
      ),
    );
  }
}

/// All pages are bundled renderings of the original PDF and work without network.
class ManualReader extends StatefulWidget {
  const ManualReader({super.key, this.initialPage = 17});

  final int initialPage;

  @override
  State<ManualReader> createState() => _ManualReaderState();
}

class _ManualReaderState extends State<ManualReader> {
  late int _page;
  final _transform = TransformationController();

  @override
  void initState() {
    super.initState();
    _page = widget.initialPage.clamp(1, 26);
  }

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  void _go(int page) {
    setState(() {
      _page = page.clamp(1, 26);
      _transform.value = Matrix4.identity();
    });
  }

  Future<void> _openOriginalPdf() async {
    final initialPage = _page;
    try {
      final data = await rootBundle.load('assets/manual/manual.pdf');
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PdfDocumentScreen(
            bytes: data.buffer.asUint8List(
              data.offsetInBytes,
              data.lengthInBytes,
            ),
            title: 'Металл Профиль · 3-е издание, 2019',
            initialPage: initialPage,
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Не удалось открыть PDF. Страницы инструкции доступны в этом просмотрщике.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xff26342e),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _navy,
        title: const Text(
          'Инструкция «Металл Профиль»',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        actions: [
          IconButton(
            key: const ValueKey('original-manual-pdf'),
            tooltip: 'Открыть оригинальный PDF',
            onPressed: _openOriginalPdf,
            icon: const Icon(Icons.picture_as_pdf_outlined),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Image.asset(
              'assets/brand/logo-sl-approved-light.png',
              width: 72,
              fit: BoxFit.contain,
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: InteractiveViewer(
                transformationController: _transform,
                minScale: 1,
                maxScale: 5,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Image.asset(
                      _pageAsset(_page),
                      key: ValueKey('manual-page-$_page'),
                      fit: BoxFit.contain,
                      semanticLabel:
                          'Оригинальная инструкция Металл Профиль, страница $_page из 26',
                      errorBuilder: (_, error, stack) => const Center(
                        child: Text(
                          'Изображение страницы не найдено',
                          style: TextStyle(color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Предыдущая страница',
                        onPressed: _page > 1 ? () => _go(_page - 1) : null,
                        icon: const Icon(Icons.chevron_left_rounded),
                      ),
                      Expanded(
                        child: Slider(
                          value: _page.toDouble(),
                          min: 1,
                          max: 26,
                          divisions: 25,
                          semanticFormatterCallback: (value) =>
                              'Страница ${value.round()}',
                          label: 'Страница $_page',
                          onChanged: (value) => _go(value.round()),
                        ),
                      ),
                      Text(
                        '$_page / 26',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Следующая страница',
                        onPressed: _page < 26 ? () => _go(_page + 1) : null,
                        icon: const Icon(Icons.chevron_right_rounded),
                      ),
                      IconButton(
                        tooltip: 'Сбросить масштаб',
                        onPressed: () => _transform.value = Matrix4.identity(),
                        icon: const Icon(Icons.fit_screen_rounded),
                      ),
                    ],
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 10),
                    child: Text(
                      '3-е издание, 2019 · Все страницы на устройстве. Масштабируйте жестом или мышью.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: _muted,
                        height: 1.6,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Widget _panel(Widget child, {double padding = 22}) => Container(
  width: double.infinity,
  padding: EdgeInsets.all(padding),
  decoration: BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: _border),
  ),
  child: Material(type: MaterialType.transparency, child: child),
);

Widget _badge(String label, {IconData? icon}) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
  decoration: BoxDecoration(
    color: const Color(0xffedf4e0),
    borderRadius: BorderRadius.circular(8),
  ),
  child: Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      if (icon != null) ...[
        Icon(icon, size: 17, color: Color(0xff557333)),
        const SizedBox(width: 6),
      ],
      Flexible(
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xff49632d),
            fontSize: 12,
            height: 1.4,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    ],
  ),
);

Widget _select({
  required String label,
  required String value,
  required Map<String, String> items,
  required ValueChanged<String> onChanged,
}) => InputDecorator(
  decoration: InputDecoration(
    labelText: label,
    border: const OutlineInputBorder(),
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
  ),
  child: DropdownButtonHideUnderline(
    child: DropdownButton<String>(
      value: value,
      isExpanded: true,
      style: const TextStyle(color: _navy, fontSize: 14, height: 1.5),
      items: items.entries
          .map(
            (item) => DropdownMenuItem(
              value: item.key,
              child: Text(
                item.value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(growable: false),
      onChanged: (value) {
        if (value != null) onChanged(value);
      },
    ),
  ),
);

Widget _bullets(String title, List<String> values) => Padding(
  padding: const EdgeInsets.only(bottom: 18),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 10),
      for (final value in values)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('•  ', style: TextStyle(fontSize: 15, color: _muted)),
              Expanded(
                child: Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.7,
                    color: _muted,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  ),
);

Widget _source(BuildContext context, _GuideSource source) {
  final local = source.url == 'assets/manual/manual.pdf';
  final checkLabel = source.userProvided
      ? 'Файл пользователя изучен'
      : source.availability == 'unavailable'
      ? 'Ссылка недоступна при проверке'
      : source.evidence == 'indexedExcerpt'
      ? 'Проверен фрагмент'
      : 'Проверка в исходном каталоге';
  return Container(
    margin: const EdgeInsets.only(bottom: 14),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: _canvas,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          source.title,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            height: 1.6,
          ),
        ),
        if (source.pages.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            'Страницы: ${source.pages}',
            style: const TextStyle(fontSize: 13, color: _muted, height: 1.6),
          ),
        ],
        const SizedBox(height: 6),
        Text(
          '$checkLabel: ${source.checked.isEmpty ? 'дата не указана' : source.checked}',
          style: const TextStyle(fontSize: 13, color: _muted, height: 1.6),
        ),
        if (local) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const ManualReader(initialPage: 1),
              ),
            ),
            icon: const Icon(Icons.menu_book_rounded, size: 18),
            label: const Text('Полная инструкция · 26 страниц'),
          ),
        ] else if (source.url.isNotEmpty) ...[
          const SizedBox(height: 10),
          SelectableText(
            key: PageStorageKey(
              'guide-source-url-${source.url}-${source.title}',
            ),
            source.url,
            style: const TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Color(0xff41642f),
            ),
          ),
          TextButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: source.url));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Ссылка на источник скопирована')),
              );
            },
            icon: const Icon(Icons.copy_rounded, size: 17),
            label: const Text('Скопировать ссылку'),
          ),
        ],
      ],
    ),
  );
}

String _pageAsset(int page) =>
    'assets/manual/page-${page.toString().padLeft(2, '0')}.png';

class _Stage {
  const _Stage(this.label, this.title, this.page);
  final String label;
  final String title;
  final int? page;
}

const _stages = [
  _Stage('Подготовка', 'Подготовьте основание и комплект', 10),
  _Stage('Подсистема', 'Соберите предусмотренную подсистему', 13),
  _Stage('Панели', 'Установите выбранный профиль', null),
  _Stage('Проёмы', 'Оформите окна, двери и примыкания', 22),
  _Stage('Завершение', 'Проверьте завершение фасада', 23),
];

List<String> _manualSteps(_GuideProfile profile, int index) => switch (index) {
  0 => [
    'Сверьте маркировку профиля, комплектующие и применимость документа к вашему заказу.',
    'По проекту определите состав фасадной системы: основание, подсистема и необходимые защитные слои.',
    'До начала монтажа проверьте состояние панелей и выбранные узлы проёмов, углов и отливов.',
  ],
  1 => [
    'Установите предусмотренные проектом крепёжные кронштейны. Утеплитель и мембрану включайте только в составе выбранной системы.',
    'Расположение направляющих и крепление к основанию сверяйте с проектом и документацией системы.',
    'Геометрию подсистемы проверьте до монтажа облицовки.',
  ],
  2 => profile.mounting,
  3 => [
    'Примерьте панель у проёма и перенесите линии реза по схеме производителя.',
    'Подрежьте панель, сохраняя предусмотренные инструкцией сопряжения.',
    'Установите совместимые откосы, отлив и обрамление. Последовательность и размеры показаны на странице 22.',
  ],
  _ => [
    'Проверьте завершение верхнего края и совместимость завершающих элементов.',
    'Сверьте обрамления проёмов, крепёж и состояние защитного покрытия с документацией.',
    'Проверьте предусмотренную проектом вентиляцию и водоотведение.',
  ],
};

List<String> _strings(dynamic value) => value is List
    ? value.map((item) => item.toString()).toList(growable: false)
    : const [];

class _GuideCategory {
  const _GuideCategory({
    required this.id,
    required this.name,
    required this.description,
    required this.profiles,
  });
  factory _GuideCategory.fromJson(Map<String, dynamic> json) => _GuideCategory(
    id: json['id'] as String,
    name: json['name'] as String,
    description: json['description'] as String? ?? '',
    profiles: (json['profiles'] as List<dynamic>)
        .map((value) => _GuideProfile.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
  );
  final String id;
  final String name;
  final String description;
  final List<_GuideProfile> profiles;
}

class _GuideProfile {
  const _GuideProfile({
    required this.id,
    required this.name,
    required this.manufacturer,
    required this.familyName,
    required this.mounting,
    required this.accessories,
    required this.limitations,
    required this.sources,
    this.manualPage,
  });
  factory _GuideProfile.fromJson(Map<String, dynamic> json) => _GuideProfile(
    id: json['id'] as String,
    name: json['name'] as String,
    manufacturer: json['manufacturer'] as String? ?? 'Производитель не указан',
    familyName: json['familyName'] as String? ?? json['name'] as String,
    mounting: _strings(json['mounting']),
    accessories: _strings(json['accessories']),
    limitations: _strings(json['limitations']),
    sources: (json['sources'] as List<dynamic>? ?? const [])
        .map((value) => _GuideSource.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
    manualPage: (json['manual'] as Map<String, dynamic>?)?['page'] as int?,
  );
  final String id;
  final String name;
  final String manufacturer;
  final String familyName;
  final List<String> mounting;
  final List<String> accessories;
  final List<String> limitations;
  final List<_GuideSource> sources;
  final int? manualPage;
}

class _GuideSource {
  const _GuideSource({
    required this.title,
    required this.url,
    required this.pages,
    required this.checked,
    required this.userProvided,
    required this.availability,
    required this.evidence,
  });
  factory _GuideSource.fromJson(Map<String, dynamic> json) => _GuideSource(
    title: json['title'] as String? ?? 'Документация производителя',
    url: json['url'] as String? ?? '',
    pages: json['pages']?.toString() ?? '',
    checked: json['checked'] as String? ?? '',
    userProvided: json['userProvided'] == true,
    availability: json['availability'] as String? ?? '',
    evidence: json['evidence'] as String? ?? '',
  );
  final String title;
  final String url;
  final String pages;
  final String checked;
  final bool userProvided;
  final String availability, evidence;
}

Uri? _pdfSourceUrl(String value) {
  final uri = Uri.tryParse(value);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      !uri.path.toLowerCase().endsWith('.pdf')) {
    return null;
  }
  return uri;
}
