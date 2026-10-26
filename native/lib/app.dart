import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'domain/siding_calculator.dart';
import 'models/workspace.dart';
import 'screens/calculator_screen.dart';
import 'screens/guides_screen.dart';
import 'screens/workspace_panels.dart';
import 'services/document_service.dart';
import 'services/native_files.dart';
import 'services/workspace_store.dart';
import 'theme.dart';

const _titles = [
  'Обзор',
  'Объекты',
  'Помощник',
  'Калькуляторы',
  'Инструкции',
  'Документы',
  'Настройки',
];
const _icons = [
  Icons.dashboard_outlined,
  Icons.home_work_outlined,
  Icons.auto_awesome_outlined,
  Icons.calculate_outlined,
  Icons.menu_book_outlined,
  Icons.description_outlined,
  Icons.settings_outlined,
];

class ConstructionApp extends StatelessWidget {
  const ConstructionApp({super.key, required this.store});
  final WorkspaceStore store;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'СВОИ ЛЮДИ',
    theme: constructionTheme(),
    locale: const Locale('ru'),
    supportedLocales: const [Locale('ru')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: WorkspaceShell(store: store),
  );
}

class WorkspaceShell extends StatefulWidget {
  const WorkspaceShell({super.key, required this.store});
  final WorkspaceStore store;
  @override
  State<WorkspaceShell> createState() => _WorkspaceShellState();
}

class _WorkspaceShellState extends State<WorkspaceShell>
    with WidgetsBindingObserver {
  int tab = 0;
  String? guideProfile;
  WorkspaceStore get store => widget.store;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (!store.ready) store.initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      store.saveNow();
    }
  }

  void go(int value) {
    setState(() => tab = value);
  }

  void notify(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: store,
    builder: (context, _) {
      if (!store.ready) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final desktop = MediaQuery.sizeOf(context).width >= 1000;
      return RepaintBoundary(
        key: const ValueKey('native-preview'),
        child: Scaffold(
          appBar: desktop
              ? null
              : AppBar(
                  title: Row(
                    children: [
                      Image.asset(
                        'assets/brand/logo-sl-approved-light.png',
                        width: 68,
                        height: 38,
                        fit: BoxFit.contain,
                      ),
                      const SizedBox(width: 12),
                      Flexible(
                        child: Text(
                          _titles[tab],
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  backgroundColor: Colors.white,
                ),
          drawer: desktop
              ? null
              : Drawer(child: SafeArea(child: _navigation(closeAfter: true))),
          bottomNavigationBar: desktop
              ? null
              : Builder(
                  builder: (context) => NavigationBar(
                    selectedIndex: const [0, 1, 3, 4].contains(tab)
                        ? const [0, 1, 3, 4].indexOf(tab)
                        : 4,
                    onDestinationSelected: (value) {
                      if (value == 4) {
                        Scaffold.of(context).openDrawer();
                      } else {
                        go(const [0, 1, 3, 4][value]);
                      }
                    },
                    destinations: const [
                      NavigationDestination(
                        icon: Icon(Icons.dashboard_outlined),
                        label: 'Обзор',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.home_work_outlined),
                        label: 'Объекты',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.calculate_outlined),
                        label: 'Расчёт',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.menu_book_outlined),
                        label: 'Монтаж',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.menu),
                        label: 'Ещё',
                      ),
                    ],
                  ),
                ),
          body: SafeArea(
            top: desktop,
            child: Row(
              children: [
                if (desktop) SizedBox(width: 235, child: _navigation()),
                Expanded(
                  child: Column(
                    children: [
                      if (desktop) _desktopHeader(),
                      if (store.error != null) _errorBanner(),
                      Expanded(child: _body()),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
  Widget _navigation({bool closeAfter = false}) => ColoredBox(
    color: ink,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          child: Container(
            height: 100,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Image.asset(
              'assets/brand/logo-sl-approved-light.png',
              fit: BoxFit.contain,
            ),
          ),
        ),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 26),
          child: Text(
            'МОЁ ПРОСТРАНСТВО',
            style: TextStyle(
              fontSize: 10,
              letterSpacing: 1.5,
              color: Color(0xffaac09f),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Expanded(
          child: ListView.builder(
            itemCount: _titles.length,
            itemBuilder: (context, index) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
              child: Material(
                color: tab == index ? lime : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                child: ListTile(
                  key: ValueKey('nav-$index'),
                  minTileHeight: 49,
                  leading: Icon(
                    _icons[index],
                    color: tab == index ? ink : const Color(0xffafc2b2),
                    size: 22,
                  ),
                  title: Text(
                    _titles[index],
                    style: TextStyle(
                      color: tab == index ? ink : const Color(0xffd4dfd1),
                      fontSize: 13,
                      fontWeight: tab == index
                          ? FontWeight.w700
                          : FontWeight.w400,
                    ),
                  ),
                  onTap: () {
                    if (closeAfter) Navigator.pop(context);
                    go(index);
                  },
                ),
              ),
            ),
          ),
        ),
        const Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'СВОИ ЛЮДИ · Иркутск',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
              SizedBox(height: 7),
              Text(
                'Предварительная версия\nДанные на этом устройстве',
                style: TextStyle(
                  color: Color(0xffb2c2ac),
                  fontSize: 11,
                  height: 1.7,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
  Widget _desktopHeader() => Container(
    height: 84,
    padding: const EdgeInsets.symmetric(horizontal: 30),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(bottom: BorderSide(color: Color(0xffe3e8dd))),
    ),
    child: Row(
      children: [
        Text(
          'Моё пространство  /  ${_titles[tab]}',
          style: const TextStyle(fontSize: 13, color: muted),
        ),
        const Spacer(),
        StatusPill(
          store.saving
              ? 'Сохранение…'
              : store.hasUnsavedChanges
              ? 'Есть несохранённые изменения'
              : 'Данные на устройстве',
        ),
        const SizedBox(width: 18),
        OutlinedButton.icon(
          onPressed: () => _projectForm(),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Новый объект'),
        ),
      ],
    ),
  );
  Widget _errorBanner() => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    color: const Color(0xffffedda),
    child: Row(
      children: [
        const Icon(Icons.info_outline, size: 19),
        const SizedBox(width: 10),
        Expanded(
          child: Text(store.error!, style: const TextStyle(fontSize: 12)),
        ),
        TextButton(onPressed: () => go(6), child: const Text('Копия данных')),
      ],
    ),
  );
  Widget _body() => switch (tab) {
    0 => OverviewPanel(
      store: store,
      onCreate: () => _projectForm(),
      onOpen: _openProject,
      onNavigate: go,
    ),
    1 => ObjectsPanel(
      store: store,
      onCreate: () => _projectForm(),
      onOpen: _openProject,
    ),
    2 => AssistantPanel(store: store),
    3 => CalculatorScreen(
      key: ValueKey(store.activeProject?.id),
      initialDraft: store.activeProject?.draft ?? CalculationDraft.empty(),
      projects: store.data.projects
          .map((p) => CalculatorProject(id: p.id, name: p.name))
          .toList(),
      activeProjectId: store.data.activeProjectId,
      onProjectChanged: (id) {
        store.selectProject(id);
      },
      onDraftChanged: store.updateDraft,
      onSave: store.saveCalculation,
      onGuide: (profile) {
        guideProfile = profile;
        go(4);
      },
    ),
    4 => GuidesScreen(
      key: ValueKey(guideProfile),
      initialProfileId: guideProfile,
    ),
    5 => DocumentsPanel(
      store: store,
      onExport: _exportCalculation,
      onNavigate: go,
    ),
    _ => SettingsPanel(store: store),
  };
  Future<void> _projectForm([ProjectModel? existing]) async {
    final name = TextEditingController(text: existing?.name ?? ''),
        address = TextEditingController(text: existing?.address ?? '');
    var workType = existing?.workType ?? 'siding',
        status = existing?.status ?? 'planned',
        busy = false;
    final form = GlobalKey<FormState>();
    final id = existing?.id ?? newId();
    final dialogRoute = DialogRoute<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialog) => AlertDialog(
          title: Text(existing == null ? 'Новый объект' : 'Изменить объект'),
          scrollable: true,
          content: SizedBox(
            width: 440,
            child: Form(
              key: form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    key: const ValueKey('project-name'),
                    controller: name,
                    maxLength: 140,
                    validator: (value) => (value?.trim().isEmpty ?? true)
                        ? 'Укажите название'
                        : null,
                    decoration: const InputDecoration(
                      labelText: 'Название объекта',
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: address,
                    maxLength: 240,
                    decoration: const InputDecoration(
                      labelText: 'Адрес · необязательно',
                    ),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: workType,
                    isExpanded: true,
                    items: const [
                      DropdownMenuItem(value: 'siding', child: Text('Сайдинг')),
                      DropdownMenuItem(
                        value: 'facade',
                        child: Text('Фасадные работы'),
                      ),
                      DropdownMenuItem(
                        value: 'insulation',
                        child: Text('Утепление'),
                      ),
                      DropdownMenuItem(
                        value: 'roof',
                        child: Text('Кровельные работы'),
                      ),
                      DropdownMenuItem(
                        value: 'other',
                        child: Text('Другие работы'),
                      ),
                    ],
                    onChanged: (value) {
                      workType = value!;
                    },
                    decoration: const InputDecoration(labelText: 'Направление'),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: status,
                    isExpanded: true,
                    items: const [
                      DropdownMenuItem(
                        value: 'planned',
                        child: Text('Планируется'),
                      ),
                      DropdownMenuItem(
                        value: 'in_progress',
                        child: Text('В работе'),
                      ),
                      DropdownMenuItem(
                        value: 'completed',
                        child: Text('Завершён'),
                      ),
                    ],
                    onChanged: (value) {
                      status = value!;
                    },
                    decoration: const InputDecoration(labelText: 'Статус'),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      if (!form.currentState!.validate()) return;
                      setDialog(() => busy = true);
                      final project =
                          existing?.copyWith(
                            name: name.text.trim(),
                            address: address.text.trim(),
                            workType: workType,
                            status: status,
                            updatedAt: DateTime.now(),
                          ) ??
                          ProjectModel(
                            id: id,
                            name: name.text.trim(),
                            address: address.text.trim(),
                            workType: workType,
                            status: status,
                          );
                      final saved = await store.upsertProject(project);
                      if (!context.mounted) return;
                      if (saved) {
                        Navigator.pop(context);
                        go(1);
                        notify('Объект сохранён на устройстве');
                      } else {
                        setDialog(() => busy = false);
                      }
                    },
              child: Text(busy ? 'Сохранение…' : 'Сохранить объект'),
            ),
          ],
        ),
      ),
    );
    await Navigator.of(context).push(dialogRoute);
    await dialogRoute.completed;
    name.dispose();
    address.dispose();
  }

  Future<void> _openProject(ProjectModel project) async {
    await store.selectProject(project.id);
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            10,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * .78,
            ),
            child: ListView(
              shrinkWrap: true,
              children: [
                Text(
                  project.name,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  project.address.isEmpty ? 'Адрес не указан' : project.address,
                  style: const TextStyle(color: muted),
                ),
                const SizedBox(height: 20),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    FilledButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        go(3);
                      },
                      icon: const Icon(Icons.calculate_outlined),
                      label: const Text('Начать расчёт'),
                    ),
                    OutlinedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        go(2);
                      },
                      child: const Text('К помощнику'),
                    ),
                    TextButton(
                      onPressed: () {
                        Navigator.pop(context);
                        _projectForm(project);
                      },
                      child: const Text('Редактировать'),
                    ),
                  ],
                ),
                const SizedBox(height: 28),
                const Text(
                  'Сохранённые расчёты',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
                ),
                const SizedBox(height: 10),
                if (project.calculations.isEmpty)
                  const Text(
                    'Здесь появятся ваши версии расчётов.',
                    style: TextStyle(color: muted),
                  ),
                for (final calculation in project.calculations.reversed)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      '${calculation.result.profileName} · ${formatArea(calculation.result.netArea)} м²',
                      style: const TextStyle(fontSize: 13),
                    ),
                    subtitle: Text(nativeDate(calculation.createdAt)),
                    trailing: IconButton(
                      icon: const Icon(Icons.picture_as_pdf_outlined),
                      tooltip: 'Создать PDF',
                      onPressed: () => _exportCalculation(project, calculation),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _exportCalculation(
    ProjectModel project,
    SavedCalculation calc,
  ) async {
    try {
      final bytes = await createCalculationPdf(
        objectName: project.name,
        address: project.address,
        createdAt: calc.createdAt,
        draft: calc.draft,
        result: calc.result,
      );
      if (!mounted) return;
      final saved = await saveNativeFile(
        context,
        bytes: bytes,
        name: 'СВОИ-ЛЮДИ-расчёт-${calc.createdAt.millisecondsSinceEpoch}.pdf',
        mimeType: 'application/pdf',
      );
      if (saved) notify('PDF передан в выбранное место');
    } catch (e) {
      notify('Не удалось подготовить PDF. Исходный расчёт сохранён.');
    }
  }
}
