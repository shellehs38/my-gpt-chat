import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../domain/siding_calculator.dart';
import '../models/workspace.dart';
import '../services/native_files.dart';
import '../services/workspace_store.dart';
import '../theme.dart';

String nativeDate(DateTime value) {
  final d = value.toUtc().add(const Duration(hours: 8));
  return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
}

String statusLabel(String value) => switch (value) {
  'in_progress' => 'В работе',
  'completed' => 'Завершён',
  _ => 'Планируется',
};

class PageContent extends StatelessWidget {
  const PageContent({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 18 : 30),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1250),
        child: child,
      ),
    ),
  );
}

class WorkCard extends StatelessWidget {
  const WorkCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(24),
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      side: const BorderSide(color: Color(0xffe1e6dc)),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Padding(padding: padding, child: child),
  );
}

class PageHeading extends StatelessWidget {
  const PageHeading(this.eyebrow, this.title, {super.key, this.subtitle});
  final String eyebrow, title;
  final String? subtitle;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        eyebrow,
        style: const TextStyle(
          fontSize: 10,
          color: muted,
          letterSpacing: 1.3,
          fontWeight: FontWeight.w700,
        ),
      ),
      const SizedBox(height: 10),
      Text(title, style: Theme.of(context).textTheme.headlineMedium),
      if (subtitle != null) ...[
        const SizedBox(height: 10),
        Text(subtitle!, style: const TextStyle(color: muted, height: 1.8)),
      ],
    ],
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, this.example = false});
  final String text;
  final bool example;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: example ? const Color(0xfffbf1dc) : const Color(0xffeef5e3),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 11,
        color: example ? const Color(0xff84621f) : const Color(0xff4c6b32),
      ),
    ),
  );
}

class OverviewPanel extends StatelessWidget {
  const OverviewPanel({
    super.key,
    required this.store,
    required this.onCreate,
    required this.onOpen,
    required this.onNavigate,
  });
  final WorkspaceStore store;
  final VoidCallback onCreate;
  final ValueChanged<ProjectModel> onOpen;
  final ValueChanged<int> onNavigate;
  @override
  Widget build(BuildContext context) => PageContent(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: const Color(0xffeaf1d9),
            borderRadius: BorderRadius.circular(22),
          ),
          child: LayoutBuilder(
            builder: (context, c) {
              final text = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const PageHeading(
                    'ВАШ РАБОЧИЙ КАБИНЕТ',
                    'Хороший день,\nчтобы строить.',
                    subtitle: 'От первого замера до готового фасада.\nОбъекты, расчёты и знания — рядом.',
                  ),
                  const SizedBox(height: 23),
                  Wrap(
                    spacing: 12,
                    runSpacing: 10,
                    children: [
                      FilledButton.icon(
                        onPressed: onCreate,
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Новый объект'),
                      ),
                      TextButton(
                        onPressed: () => onNavigate(3),
                        child: const Text('Перейти к расчёту →'),
                      ),
                    ],
                  ),
                ],
              );
              return c.maxWidth > 760
                  ? Row(
                      children: [
                        Expanded(child: text),
                        const SizedBox(width: 25),
                        const SizedBox(
                          width: 300,
                          height: 210,
                          child: CustomPaint(painter: HousePainter()),
                        ),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        text,
                        const SizedBox(height: 12),
                        const SizedBox(
                          height: 145,
                          child: CustomPaint(painter: HousePainter()),
                        ),
                      ],
                    );
            },
          ),
        ),
        const SizedBox(height: 22),
        LayoutBuilder(
          builder: (context, c) {
            final cols = c.maxWidth > 900 ? 4 : 2;
            final width = (c.maxWidth - 14 * (cols - 1)) / cols;
            return Wrap(
              spacing: 14,
              runSpacing: 14,
              children: [
                _stat(
                  width,
                  '${store.data.projects.where((p) => p.status != 'completed').length}',
                  'Объектов в работе и планах',
                  Icons.home_work_outlined,
                ),
                _stat(
                  width,
                  '${store.data.projects.fold(0, (n, p) => n + p.calculations.length)}',
                  'Сохранённых расчётов',
                  Icons.calculate_outlined,
                ),
                _stat(
                  width,
                  '27',
                  'Категорий в библиотеке',
                  Icons.menu_book_outlined,
                ),
                _stat(
                  width,
                  'Офлайн',
                  'Расчёты и инструкции',
                  Icons.offline_pin_outlined,
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 24),
        WorkCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Ваши объекты',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => onNavigate(1),
                    child: const Text('Все →'),
                  ),
                ],
              ),
              if (store.data.projects.any((p) => p.isDemo))
                const Padding(
                  padding: EdgeInsets.only(top: 10, bottom: 14),
                  child: Wrap(
                    spacing: 10,
                    runSpacing: 8,
                    children: [
                      StatusPill('Демонстрационные данные', example: true),
                      Text(
                        'Создайте свой объект, чтобы начать.',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
              if (store.data.projects.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(25),
                  child: Text('Здесь появятся ваши объекты.'),
                ),
              for (final project in store.data.projects.take(4))
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(vertical: 7),
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xffeff4e5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.home_work_outlined,
                      color: Color(0xff789a4f),
                    ),
                  ),
                  title: Text(
                    project.name,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  subtitle: Text(
                    project.address.isEmpty
                        ? 'Адрес можно добавить позже'
                        : project.address,
                    style: const TextStyle(fontSize: 11, color: muted),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => onOpen(project),
                ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        LayoutBuilder(
          builder: (context, c) {
            final width = c.maxWidth > 780 ? (c.maxWidth - 18) / 2 : c.maxWidth;
            return Wrap(
              spacing: 18,
              runSpacing: 18,
              children: [
                _action(
                  width,
                  Icons.auto_awesome_outlined,
                  'Помощник по вашему объекту',
                  'Соберите исходные данные и подготовьте вопрос с контекстом расчёта.',
                  'Открыть помощника',
                  () => onNavigate(2),
                ),
                _action(
                  width,
                  Icons.menu_book_outlined,
                  'Монтаж без догадок',
                  'Инструкции производителей, фотографии и все страницы вашего PDF внутри приложения.',
                  'Открыть инструкции',
                  () => onNavigate(4),
                ),
              ],
            );
          },
        ),
      ],
    ),
  );
  Widget _stat(double width, String value, String label, IconData icon) =>
      SizedBox(
        width: width,
        child: WorkCard(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: const Color(0xff799847), size: 24),
              const SizedBox(height: 12),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(label, style: const TextStyle(fontSize: 11, color: muted)),
            ],
          ),
        ),
      );
  Widget _action(
    double width,
    IconData icon,
    String title,
    String text,
    String action,
    VoidCallback onTap,
  ) => SizedBox(
    width: width,
    child: WorkCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: ink, size: 28),
          const SizedBox(height: 15),
          Text(
            title,
            style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Text(text, style: const TextStyle(color: muted)),
          const SizedBox(height: 18),
          OutlinedButton(onPressed: onTap, child: Text('$action →')),
        ],
      ),
    ),
  );
}

class ObjectsPanel extends StatefulWidget {
  const ObjectsPanel({
    super.key,
    required this.store,
    required this.onCreate,
    required this.onOpen,
  });
  final WorkspaceStore store;
  final VoidCallback onCreate;
  final ValueChanged<ProjectModel> onOpen;
  @override
  State<ObjectsPanel> createState() => _ObjectsPanelState();
}

class _ObjectsPanelState extends State<ObjectsPanel> {
  String query = '', status = 'all';
  @override
  Widget build(BuildContext context) {
    final projects = widget.store.data.projects
        .where(
          (p) =>
              (status == 'all' || p.status == status) &&
              '${p.name} ${p.address}'.toLowerCase().contains(
                query.toLowerCase(),
              ),
        )
        .toList();
    return PageContent(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PageHeading(
            'ОБЪЕКТЫ',
            'Каждой стройке —\nсвоё пространство.',
            subtitle: 'Замеры, расчёты и документы в одной карточке.',
          ),
          const SizedBox(height: 20),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: widget.onCreate,
              icon: const Icon(Icons.add),
              label: const Text('Новый объект'),
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            key: const ValueKey('object-search'),
            onChanged: (value) => setState(() => query = value),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Название или адрес',
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in {
                'all': 'Все',
                'in_progress': 'В работе',
                'planned': 'Планируются',
                'completed': 'Завершены',
              }.entries)
                ChoiceChip(
                  label: Text(entry.value),
                  selected: status == entry.key,
                  onSelected: (_) => setState(() => status = entry.key),
                ),
            ],
          ),
          const SizedBox(height: 22),
          if (projects.isEmpty)
            const WorkCard(
              child: Text(
                'Объекты не найдены. Создайте новый или измените поиск.',
              ),
            ),
          for (final project in projects)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: WorkCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            project.name,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        if (project.isDemo)
                          const StatusPill('Пример', example: true),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      project.address.isEmpty
                          ? 'Адрес не указан'
                          : project.address,
                      style: const TextStyle(color: muted),
                    ),
                    const SizedBox(height: 15),
                    Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        StatusPill(statusLabel(project.status)),
                        Text(
                          'Расчётов: ${project.calculations.length}',
                          style: const TextStyle(color: muted, fontSize: 12),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    OutlinedButton(
                      onPressed: () => widget.onOpen(project),
                      child: const Text('Открыть объект →'),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class DocumentsPanel extends StatelessWidget {
  const DocumentsPanel({
    super.key,
    required this.store,
    required this.onExport,
    required this.onNavigate,
  });
  final WorkspaceStore store;
  final void Function(ProjectModel, SavedCalculation) onExport;
  final ValueChanged<int> onNavigate;
  @override
  Widget build(BuildContext context) {
    final entries = [
      for (final project in store.data.projects)
        for (final calc in project.calculations) (project: project, calc: calc),
    ];
    return PageContent(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PageHeading(
            'ДОКУМЕНТЫ ОБЪЕКТА',
            'От расчёта —\nк понятному предложению.',
            subtitle: 'PDF с вашим подлинным логотипом. Материалы и работы — раздельно.',
          ),
          const SizedBox(height: 25),
          if (entries.isEmpty)
            WorkCard(
              child: Column(
                children: [
                  const Icon(
                    Icons.picture_as_pdf_outlined,
                    size: 46,
                    color: muted,
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Первый документ начнётся с расчёта',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Выберите объект, заполните размеры и сохраните расчёт.',
                    style: TextStyle(color: muted),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: () => onNavigate(3),
                    child: const Text('Рассчитать сайдинг'),
                  ),
                ],
              ),
            ),
          for (final entry in entries.reversed)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: WorkCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Image.asset(
                          'assets/brand/logo-sl-approved-light.png',
                          width: 100,
                          height: 62,
                          fit: BoxFit.contain,
                        ),
                        const Spacer(),
                        const Icon(
                          Icons.picture_as_pdf_outlined,
                          color: muted,
                          size: 32,
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      entry.project.name,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${entry.calc.result.profileName} · ${formatArea(entry.calc.result.netArea)} м²',
                      style: const TextStyle(color: muted),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      nativeDate(entry.calc.createdAt),
                      style: const TextStyle(color: muted, fontSize: 12),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: () => onExport(entry.project, entry.calc),
                      icon: const Icon(Icons.save_alt),
                      label: const Text('Сохранить PDF'),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class SettingsPanel extends StatelessWidget {
  const SettingsPanel({super.key, required this.store});
  final WorkspaceStore store;
  @override
  Widget build(BuildContext context) => PageContent(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const PageHeading(
          'ВАШЕ ПРИЛОЖЕНИЕ',
          'Личное пространство.\nНа ваших устройствах.',
          subtitle: 'iPhone и Windows · предварительная версия',
        ),
        const SizedBox(height: 24),
        WorkCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Данные и резервные копии',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              const Text(
                'Объекты и расчёты хранятся в папке приложения на этом устройстве. Облачная синхронизация между iPhone и компьютером пока не подключена.',
                style: TextStyle(color: muted),
              ),
              const SizedBox(height: 22),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  FilledButton.icon(
                    onPressed: () => _export(context),
                    icon: const Icon(Icons.save_alt),
                    label: const Text('Экспортировать копию'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _import(context),
                    icon: const Icon(Icons.file_open_outlined),
                    label: const Text('Импортировать копию'),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Text(
                'Импорт добавляет объекты отдельными копиями и сохраняет текущие данные.',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        WorkCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Что доступно',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 15),
              for (final entry in {
                'Калькулятор сайдинга': 'На устройстве',
                'Инструкции и 26 страниц PDF': 'Без интернета',
                'PDF-документы': 'На устройстве',
                'Диалог с ИИ': 'Вход по паролю помощника',
                'Синхронизация устройств': 'Следующий этап',
              }.entries)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          entry.key,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Flexible(child: StatusPill(entry.value)),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const WorkCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Личное приложение сейчас, команда — позже',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 12),
              Text(
                'Следующими этапами будут защищённая синхронизация, отдельные аккаунты и новые направления расчётов. Текущий учёт компании не изменяется этой предварительной версией.',
                style: TextStyle(color: muted),
              ),
            ],
          ),
        ),
      ],
    ),
  );
  Future<void> _export(BuildContext context) async {
    try {
      final bytes = Uint8List.fromList(utf8.encode(store.exportJson()));
      final saved = await saveNativeFile(
        context,
        bytes: bytes,
        name: 'svoi-lyudi-native-backup.json',
        mimeType: 'application/json',
      );
      if (saved && context.mounted) {
        _notice(context, 'Копия передана в выбранное место');
      }
    } catch (e) {
      if (context.mounted) {
        _notice(
          context,
          'Не удалось сохранить копию. Данные остаются в приложении.',
        );
      }
    }
  }

  Future<void> _import(BuildContext context) async {
    try {
      final text = await selectNativeBackup();
      if (text == null) return;
      final count = await store.importCopies(text);
      if (context.mounted) _notice(context, 'Добавлено объектов: $count');
    } catch (e) {
      if (context.mounted) {
        _notice(
          context,
          'Копия не импортирована: проверьте формат и доступное место.',
        );
      }
    }
  }
}

void _notice(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

class HousePainter extends CustomPainter {
  const HousePainter();
  @override
  void paint(Canvas c, Size s) {
    c.save();
    c.scale(s.width / 320, s.height / 210);
    c.drawOval(
      const Rect.fromLTWH(24, 174, 275, 20),
      Paint()..color = const Color(0xffd3dec3),
    );
    c.drawPath(
      Path()
        ..moveTo(40, 92)
        ..lineTo(155, 43)
        ..lineTo(283, 89)
        ..lineTo(169, 133)
        ..close(),
      Paint()..color = const Color(0xff214039),
    );
    c.drawPath(
      Path()
        ..moveTo(42, 101)
        ..lineTo(168, 142)
        ..lineTo(168, 192)
        ..lineTo(42, 150)
        ..close(),
      Paint()..color = const Color(0xffc7d1c3),
    );
    c.drawPath(
      Path()
        ..moveTo(168, 142)
        ..lineTo(283, 99)
        ..lineTo(283, 151)
        ..lineTo(168, 192)
        ..close(),
      Paint()..color = const Color(0xfff5f7eb),
    );
    c.drawPath(
      Path()
        ..moveTo(40, 92)
        ..lineTo(169, 133)
        ..lineTo(283, 89)
        ..lineTo(283, 100)
        ..lineTo(169, 144)
        ..lineTo(40, 103)
        ..close(),
      Paint()..color = lime,
    );
    final line = Paint()
      ..color = const Color(0xffa5b49c)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      c.drawLine(Offset(46, 111 + i * 10), Offset(162, 150 + i * 10), line);
      c.drawLine(Offset(175, 151 + i * 10), Offset(278, 112 + i * 10), line);
    }
    for (final r in [
      const Rect.fromLTWH(63, 119, 26, 24),
      const Rect.fromLTWH(112, 135, 26, 24),
      const Rect.fromLTWH(193, 144, 25, 25),
      const Rect.fromLTWH(246, 124, 25, 25),
    ]) {
      c.drawRect(r.inflate(3), Paint()..color = Colors.white);
      c.drawRect(r, Paint()..color = const Color(0xff3f5d54));
    }
    c.restore();
  }

  @override
  bool shouldRepaint(HousePainter oldDelegate) => false;
}
