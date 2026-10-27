import 'dart:typed_data';

import 'package:file_selector/file_selector.dart' as files;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../services/manual_library.dart';
import '../services/native_files.dart';
import '../theme.dart';
import 'pdf_document_screen.dart';

class ManualDownloadSource {
  const ManualDownloadSource({
    required this.title,
    required this.url,
    this.downloadable = true,
  });
  final String title;
  final Uri url;
  final bool downloadable;
}

class ManualPickedPdf {
  const ManualPickedPdf({required this.fileName, required this.bytes});
  final String fileName;
  final Uint8List bytes;
}

typedef ManualPdfPicker = Future<ManualPickedPdf?> Function();

class ManualLibraryPanel extends StatefulWidget {
  const ManualLibraryPanel({
    super.key,
    required this.library,
    required this.profileId,
    required this.profileName,
    required this.sources,
    this.picker,
    this.pdfViewerBuilder,
  });
  final ManualLibrary library;
  final String profileId, profileName;
  final List<ManualDownloadSource> sources;
  final ManualPdfPicker? picker;
  final NativePdfViewerBuilder? pdfViewerBuilder;

  @override
  State<ManualLibraryPanel> createState() => _ManualLibraryPanelState();
}

class _ManualLibraryPanelState extends State<ManualLibraryPanel> {
  static const _maxPdfBytes = maxManualPdfBytes;
  bool _working = false;

  Future<ManualPickedPdf?> _pickPdf() async {
    final file = await files.openFile(
      acceptedTypeGroups: [
        const files.XTypeGroup(
          label: 'PDF-инструкция',
          extensions: ['pdf'],
          mimeTypes: ['application/pdf'],
          uniformTypeIdentifiers: ['com.adobe.pdf'],
        ),
      ],
    );
    if (file == null) return null;
    if (await file.length() > _maxPdfBytes) {
      throw const FormatException('PDF должен быть не больше 30 МБ.');
    }
    return ManualPickedPdf(
      fileName: file.name,
      bytes: await file.readAsBytes(),
    );
  }

  void _notice(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_working || widget.library.busy) return;
    setState(() => _working = true);
    try {
      await action();
    } on ManualLibraryException catch (e) {
      _notice(e.message);
    } on FormatException catch (e) {
      _notice(e.message);
    } catch (_) {
      _notice('Не удалось выполнить действие с PDF. Повторите попытку.');
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _import() async {
    final library = widget.library;
    final profileId = widget.profileId, profileName = widget.profileName;
    final picker = widget.picker ?? _pickPdf;
    await _run(() async {
      final picked = await picker();
      if (picked == null) return;
      await library.importPdf(
        profileId: profileId,
        title: picked.fileName,
        fileName: picked.fileName,
        bytes: picked.bytes,
      );
      _notice('PDF сохранён для профиля «$profileName».');
    });
  }

  Future<void> _download(ManualDownloadSource source) async {
    final library = widget.library;
    final profileId = widget.profileId, profileName = widget.profileName;
    await _run(() async {
      await library.downloadPdf(
        profileId: profileId,
        title: source.title,
        uri: source.url,
      );
      _notice('PDF сохранён для профиля «$profileName» и доступен без сети.');
    });
  }

  Future<void> _open(ManualRecord record) async {
    final library = widget.library;
    final viewerBuilder = widget.pdfViewerBuilder;
    await _run(() async {
      final bytes = await library.readPdf(record);
      if (!mounted) return;
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => PdfDocumentScreen(
            bytes: bytes,
            title: record.title,
            viewerBuilder: viewerBuilder,
          ),
        ),
      );
    });
  }

  Future<void> _export(ManualRecord record) async {
    final library = widget.library;
    await _run(() async {
      final bytes = await library.readPdf(record);
      if (!mounted) return;
      final saved = await saveNativeFile(
        context,
        bytes: bytes,
        name: record.fileName.toLowerCase().endsWith('.pdf')
            ? record.fileName
            : '${record.fileName}.pdf',
        mimeType: 'application/pdf',
      );
      if (saved) _notice('PDF передан в системное окно сохранения.');
    });
  }

  Future<void> _remove(ManualRecord record) async {
    final library = widget.library;
    await _run(() async {
      await library.removeRecord(record.id);
      _notice('PDF убран из этого профиля.');
    });
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.library,
    builder: (context, _) {
      final library = widget.library;
      final records = library.recordsFor(widget.profileId);
      final busy = _working || library.busy;
      final canChange = library.ready && !library.isReadOnly && !busy;
      return Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: Color(0xffe1e7dd)),
        ),
        child: Padding(
          padding: EdgeInsets.all(
            MediaQuery.sizeOf(context).width < 600 ? 18 : 24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'PDF-инструкции этого профиля',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(widget.profileName, style: const TextStyle(color: muted)),
              const SizedBox(height: 10),
              const Text(
                'Добавьте свой PDF или загрузите доступный файл по ссылке из каталога. Проверьте совпадение производителя, коллекции и редакции с вашим материалом.',
                style: TextStyle(color: muted),
              ),
              const SizedBox(height: 14),
              if (!library.ready && library.error == null)
                const LinearProgressIndicator(),
              if (library.error != null &&
                  (!library.ready || library.isReadOnly))
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    library.error!,
                    style: const TextStyle(color: Color(0xff9a3b29)),
                  ),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  key: const ValueKey('manual-import-pdf'),
                  onPressed: canChange ? _import : null,
                  icon: const Icon(Icons.upload_file_outlined),
                  label: const Text('Добавить свой PDF'),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'До 30 МБ на файл. PDF хранятся отдельно от JSON-копии объектов; нужные файлы сохраняйте кнопкой «Сохранить PDF».',
                style: TextStyle(color: muted, fontSize: 11),
              ),
              if (busy) ...[
                const SizedBox(height: 14),
                const LinearProgressIndicator(),
                const SizedBox(height: 6),
                const Text(
                  'Работаем с файлом…',
                  style: TextStyle(color: muted),
                ),
              ],
              if (records.isEmpty && library.ready) ...[
                const SizedBox(height: 18),
                const Text(
                  'Добавленных PDF пока нет.',
                  key: ValueKey('manual-library-empty'),
                  style: TextStyle(color: muted),
                ),
              ],
              for (final record in records) ...[
                const SizedBox(height: 18),
                _record(record, busy),
              ],
              if (widget.sources.isNotEmpty) ...[
                const SizedBox(height: 20),
                const Divider(),
                const SizedBox(height: 8),
                const Text(
                  'PDF по ссылкам источников',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 5),
                const Text(
                  'Для первой загрузки нужен интернет. Сохранённый файл затем открывается в приложении без сети.',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
                for (var i = 0; i < widget.sources.length; i++) ...[
                  const SizedBox(height: 12),
                  _source(widget.sources[i], i, canChange),
                ],
              ],
            ],
          ),
        ),
      );
    },
  );

  Widget _record(ManualRecord record, bool busy) => DecoratedBox(
    key: ValueKey('manual-record-${record.id}'),
    decoration: BoxDecoration(
      color: canvas,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xffe1e7dd)),
    ),
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            record.title,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            record.fileName,
            style: const TextStyle(color: muted, fontSize: 12),
          ),
          Text(
            '${record.origin == 'manufacturer' ? 'Скачано по ссылке из каталога' : 'Добавлено вами'} · ${_size(record.sizeBytes)} · ${_date(record.addedAt)}',
            style: const TextStyle(color: muted, fontSize: 11),
          ),
          if (record.sourceUrl != null) ...[
            const SizedBox(height: 5),
            SelectableText(
              record.sourceUrl!,
              style: const TextStyle(color: muted, fontSize: 11),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              OutlinedButton.icon(
                key: ValueKey('manual-open-${record.id}'),
                onPressed: busy ? null : () => _open(record),
                icon: const Icon(Icons.menu_book_outlined, size: 18),
                label: const Text('Открыть PDF'),
              ),
              TextButton.icon(
                onPressed: busy ? null : () => _export(record),
                icon: const Icon(Icons.save_alt, size: 18),
                label: const Text('Сохранить PDF'),
              ),
              TextButton(
                key: ValueKey('manual-remove-${record.id}'),
                onPressed: busy || widget.library.isReadOnly
                    ? null
                    : () => _remove(record),
                child: const Text('Убрать из профиля'),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _source(ManualDownloadSource source, int index, bool canChange) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            source.title,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            source.url.host,
            style: const TextStyle(color: muted, fontSize: 12),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              TextButton.icon(
                key: ValueKey('manual-download-$index'),
                onPressed: canChange && source.downloadable
                    ? () => _download(source)
                    : null,
                icon: const Icon(Icons.download_outlined, size: 18),
                label: Text(
                  source.downloadable
                      ? 'Скачать PDF в приложение'
                      : 'Ссылка была недоступна',
                ),
              ),
              TextButton.icon(
                onPressed: () async {
                  await Clipboard.setData(
                    ClipboardData(text: source.url.toString()),
                  );
                  _notice('Ссылка скопирована');
                },
                icon: const Icon(Icons.copy_outlined, size: 16),
                label: const Text('Скопировать ссылку'),
              ),
            ],
          ),
        ],
      );

  static String _size(int bytes) => bytes < 1024 * 1024
      ? '${(bytes / 1024).ceil()} КБ'
      : '${(bytes / (1024 * 1024)).toStringAsFixed(1).replaceAll('.', ',')} МБ';
  static String _date(DateTime date) {
    final local = date.toLocal();
    return '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}.${local.year}';
  }
}
