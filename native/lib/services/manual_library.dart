import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashing;
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../models/workspace.dart';

const maxManualPdfBytes = 30 * 1024 * 1024;
const maxManualRecords = 500;
const _maxManifestBytes = 1024 * 1024;

class ManualLibraryException implements Exception {
  const ManualLibraryException(this.message);
  final String message;
  @override
  String toString() => message;
}

class _ManualManifestException extends ManualLibraryException {
  const _ManualManifestException()
    : super(
        'Список PDF повреждён. Исходный файл сохранён; добавление остановлено до восстановления.',
      );
}

class ManualRecord {
  const ManualRecord({
    required this.id,
    required this.profileId,
    required this.title,
    required this.fileName,
    required this.sha256,
    required this.sizeBytes,
    required this.addedAt,
    required this.origin,
    this.sourceUrl,
  });
  final String id, profileId, title, fileName, sha256, origin;
  final int sizeBytes;
  final DateTime addedAt;
  final String? sourceUrl;

  Map<String, dynamic> toJson() => {
    'id': id,
    'profileId': profileId,
    'title': title,
    'fileName': fileName,
    'sha256': sha256,
    'sizeBytes': sizeBytes,
    'addedAt': addedAt.toUtc().toIso8601String(),
    'origin': origin,
    if (sourceUrl != null) 'sourceUrl': sourceUrl,
  };

  factory ManualRecord.fromJson(Map<String, dynamic> value) {
    final hash = _text(value, 'sha256', 64);
    _checkHash(hash);
    final origin = _text(value, 'origin', 20);
    if (!const ['user', 'manufacturer'].contains(origin)) {
      throw const FormatException('Неверное происхождение PDF');
    }
    final size = value['sizeBytes'];
    if (size is! int || size < 5 || size > maxManualPdfBytes) {
      throw const FormatException('Неверный размер PDF');
    }
    final fileName = _text(value, 'fileName', 180);
    if (fileName != _safeFileName(fileName)) {
      throw const FormatException('Неверное имя PDF');
    }
    final source = value['sourceUrl'];
    if (source != null) {
      if (source is! String || source.length > 4096) {
        throw const FormatException('Неверный источник PDF');
      }
      final uri = Uri.tryParse(source);
      if (uri == null ||
          !const ['https', 'http'].contains(uri.scheme) ||
          uri.host.isEmpty ||
          uri.userInfo.isNotEmpty) {
        throw const FormatException('Неверный источник PDF');
      }
    }
    if (origin == 'manufacturer' && source == null) {
      throw const FormatException('Не указан источник PDF');
    }
    return ManualRecord(
      id: _text(value, 'id', 150),
      profileId: _text(value, 'profileId', 150),
      title: _text(value, 'title', 240),
      fileName: fileName,
      sha256: hash,
      sizeBytes: size,
      addedAt: DateTime.parse(_text(value, 'addedAt', 50)),
      origin: origin,
      sourceUrl: source as String?,
    );
  }
}

abstract interface class ManualRepository {
  Future<List<ManualRecord>> readRecords();
  Future<void> writeRecords(List<ManualRecord> records);
  Future<void> writeBlob(String hash, Uint8List bytes);
  Future<Uint8List> readBlob(String hash);
}

/// Metadata never contains paths; only a checked hash selects a private blob.
class FileManualRepository implements ManualRepository {
  FileManualRepository({this.directory});
  final Directory? directory;
  Directory? _directory;
  bool _blocked = false;
  Future<Directory> _root() async {
    _directory ??= directory;
    if (_directory == null) {
      final support = await getApplicationSupportDirectory();
      _directory = Directory(
        '${support.path}${Platform.pathSeparator}manual-library',
      );
    }
    await _directory!.create(recursive: true);
    return _directory!;
  }

  Future<File> _manifest() async =>
      File('${(await _root()).path}${Platform.pathSeparator}manifest.json');
  Future<File> _blob(String hash) async {
    _checkHash(hash);
    final folder = Directory(
      '${(await _root()).path}${Platform.pathSeparator}pdfs',
    );
    await folder.create(recursive: true);
    return File('${folder.path}${Platform.pathSeparator}$hash.pdf');
  }

  Future<List<ManualRecord>> _readManifest(File file) async {
    if (await file.length() > _maxManifestBytes) {
      throw const FormatException('Список PDF превышает допустимый размер');
    }
    return _decodeManifest(jsonDecode(await file.readAsString()));
  }

  @override
  Future<List<ManualRecord>> readRecords() async {
    final file = await _manifest();
    if (!await file.exists()) return [];
    try {
      return await _readManifest(file);
    } catch (_) {
      _blocked = true;
      rethrow;
    }
  }

  @override
  Future<void> writeRecords(List<ManualRecord> records) async {
    if (_blocked) {
      throw const _ManualManifestException();
    }
    final value = _encodeManifest(records);
    // Validate even records created by a caller rather than the library.
    _decodeManifest(value);
    final payload = jsonEncode(value);
    if (utf8.encode(payload).length > _maxManifestBytes) {
      throw const ManualLibraryException(
        'Список PDF превышает допустимый размер.',
      );
    }
    final file = await _manifest();
    if (await file.exists()) {
      try {
        await _readManifest(file);
      } catch (_) {
        _blocked = true;
        throw const _ManualManifestException();
      }
    }
    final temporary = File('${file.path}.${newId()}.tmp');
    try {
      await temporary.writeAsString(payload, flush: true);
      if (await file.exists()) await file.copy('${file.path}.backup');
      await temporary.rename(file.path);
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
  }

  @override
  Future<void> writeBlob(String hash, Uint8List bytes) async {
    if (_blocked) throw const _ManualManifestException();
    _validatePdf(bytes);
    _checkHash(hash);
    if (_digest(bytes) != hash) {
      throw const FormatException('Контрольная сумма PDF не совпадает');
    }
    final file = await _blob(hash);
    if (await file.exists()) {
      try {
        await readBlob(hash);
        return;
      } on FormatException {
        await file.copy('${file.path}.damaged-${newId()}');
      }
    }
    final temporary = File('${file.path}.${newId()}.tmp');
    try {
      await temporary.writeAsBytes(bytes, flush: true);
      await temporary.rename(file.path);
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
  }

  @override
  Future<Uint8List> readBlob(String hash) async {
    final file = await _blob(hash);
    if (await file.length() > maxManualPdfBytes) {
      throw const FormatException('PDF превышает 30 МБ');
    }
    final bytes = await file.readAsBytes();
    _validatePdf(bytes);
    if (_digest(bytes) != hash) {
      throw const FormatException('Файл PDF изменён или повреждён');
    }
    return bytes;
  }
}

class MemoryManualRepository implements ManualRepository {
  MemoryManualRepository([List<ManualRecord> records = const []])
    : records = List.of(records);
  List<ManualRecord> records;
  final Map<String, Uint8List> blobs = {};
  bool failWrites = false;
  @override
  Future<List<ManualRecord>> readRecords() async =>
      _decodeManifest(_encodeManifest(records));
  @override
  Future<void> writeRecords(List<ManualRecord> value) async {
    if (failWrites) {
      throw const FileSystemException('Test metadata write failure');
    }
    records = _decodeManifest(_encodeManifest(value));
  }

  @override
  Future<void> writeBlob(String hash, Uint8List bytes) async {
    _checkHash(hash);
    _validatePdf(bytes);
    if (_digest(bytes) != hash) {
      throw const FormatException('Контрольная сумма PDF не совпадает');
    }
    blobs[hash] = Uint8List.fromList(bytes);
  }

  @override
  Future<Uint8List> readBlob(String hash) async {
    _checkHash(hash);
    final bytes = blobs[hash];
    if (bytes == null) throw const FileSystemException('PDF missing');
    _validatePdf(bytes);
    if (_digest(bytes) != hash) {
      throw const FormatException('Файл PDF изменён или повреждён');
    }
    return Uint8List.fromList(bytes);
  }
}

class DownloadedManual {
  DownloadedManual({required Uint8List bytes, required this.fileName})
    : bytes = Uint8List.fromList(bytes);
  final Uint8List bytes;
  final String fileName;
}

abstract interface class ManualDownloader {
  Future<DownloadedManual> download(Uri uri);
  void close();
}

class HttpManualDownloader implements ManualDownloader {
  HttpManualDownloader({
    HttpClient? client,
    this.timeout = const Duration(seconds: 45),
    this.allowInsecureLoopbackForTests = false,
  }) : _client = client ?? HttpClient() {
    _client.connectionTimeout = const Duration(seconds: 15);
  }
  final HttpClient _client;
  final Duration timeout;
  final bool allowInsecureLoopbackForTests;
  final Set<_DownloadTask> _tasks = {};
  bool _closed = false;

  void _checkUri(Uri uri) {
    final local = const ['localhost', '127.0.0.1', '::1'].contains(uri.host);
    if ((uri.scheme != 'https' &&
            !(allowInsecureLoopbackForTests &&
                local &&
                uri.scheme == 'http')) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      throw const ManualLibraryException(
        'Для загрузки PDF нужна прямая ссылка HTTPS без данных входа.',
      );
    }
  }

  @override
  Future<DownloadedManual> download(Uri uri) async {
    _checkUri(uri);
    if (_closed) {
      throw const ManualLibraryException('Загрузка PDF остановлена.');
    }
    final task = _DownloadTask();
    _tasks.add(task);
    try {
      return await (() async {
        var current = uri.removeFragment();
        var transferred = 0;
        for (var redirects = 0; ; redirects++) {
          _checkUri(current);
          final request = await _client.getUrl(current);
          if (task.cancelled || _closed) {
            request.abort();
            throw const ManualLibraryException('Загрузка PDF остановлена.');
          }
          task.request = request;
          request.followRedirects = false;
          request.headers.set(
            HttpHeaders.acceptHeader,
            'application/pdf, application/octet-stream;q=0.9',
          );
          request.headers.removeAll(HttpHeaders.authorizationHeader);
          request.headers.removeAll(HttpHeaders.cookieHeader);
          final response = await request.close();
          if (response.contentLength > maxManualPdfBytes - transferred) {
            throw const ManualLibraryException('PDF превышает 30 МБ.');
          }
          final builder = BytesBuilder(copy: false);
          await for (final chunk in response) {
            transferred += chunk.length;
            if (transferred > maxManualPdfBytes) {
              throw const ManualLibraryException('PDF превышает 30 МБ.');
            }
            builder.add(chunk);
          }
          if (const [301, 302, 303, 307, 308].contains(response.statusCode)) {
            if (redirects >= 3) {
              throw const ManualLibraryException(
                'Слишком много перенаправлений при загрузке PDF.',
              );
            }
            final location = response.headers.value(HttpHeaders.locationHeader);
            if (location == null || location.isEmpty) {
              throw const ManualLibraryException('Сервер не указал адрес PDF.');
            }
            current = current.resolve(location).removeFragment();
            continue;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            throw ManualLibraryException(
              response.statusCode == 404
                  ? 'PDF по этой ссылке не найден. Можно добавить файл с устройства.'
                  : 'Не удалось загрузить PDF с сайта источника. Повторите позже.',
            );
          }
          final bytes = builder.takeBytes();
          _validatePdf(bytes);
          final name = current.pathSegments.isEmpty
              ? 'Инструкция.pdf'
              : current.pathSegments.last;
          return DownloadedManual(bytes: bytes, fileName: _safeFileName(name));
        }
      })().timeout(timeout);
    } on ManualLibraryException {
      rethrow;
    } on FormatException {
      throw const ManualLibraryException(
        'По ссылке получен не PDF. Добавьте PDF-файл с устройства.',
      );
    } on TimeoutException {
      throw const ManualLibraryException(
        'Сайт источника отвечает слишком долго. Повторите загрузку.',
      );
    } on IOException {
      throw const ManualLibraryException(
        'Нет связи с сайтом источника. Проверьте интернет.',
      );
    } finally {
      task.cancelled = true;
      task.request?.abort();
      _tasks.remove(task);
    }
  }

  @override
  void close() {
    _closed = true;
    for (final task in _tasks) {
      task.cancelled = true;
      task.request?.abort();
    }
    _client.close(force: true);
  }
}

class _DownloadTask {
  bool cancelled = false;
  HttpClientRequest? request;
}

class ManualLibrary extends ChangeNotifier {
  ManualLibrary(this.repository, {ManualDownloader? downloader})
    : _downloader = downloader ?? HttpManualDownloader();
  final ManualRepository repository;
  final ManualDownloader _downloader;
  List<ManualRecord> _records = const [];
  List<ManualRecord> get records => List.unmodifiable(_records);
  List<ManualRecord> recordsFor(String profileId) =>
      List.unmodifiable(_records.where((r) => r.profileId == profileId));
  bool ready = false, isReadOnly = false, _disposed = false;
  int _pending = 0;
  bool get busy => _pending > 0;
  String? error;
  Future<void>? _initialization;
  Future<void> _queue = Future.value();
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> initialize() => _initialization ??= _initialize();
  Future<void> _initialize() async {
    if (_disposed) return;
    try {
      final records = await repository.readRecords();
      if (_disposed) return;
      _records = List.unmodifiable(records);
    } catch (_) {
      if (_disposed) return;
      isReadOnly = true;
      error = 'Не удалось прочитать библиотеку PDF. Исходные файлы сохранены; добавление остановлено до восстановления.';
    }
    ready = true;
    _notify();
  }

  void _checkWritable() {
    if (_disposed) {
      throw const ManualLibraryException('Библиотека PDF закрыта.');
    }
    if (!ready) {
      throw const ManualLibraryException('Библиотека PDF ещё загружается.');
    }
    if (isReadOnly) {
      throw const ManualLibraryException(
        'Библиотека PDF требует восстановления. Исходные файлы сохранены.',
      );
    }
  }

  Future<T> _enqueue<T>(Future<T> Function() action) {
    if (_disposed) {
      return Future.error(
        const ManualLibraryException('Библиотека PDF закрыта.'),
      );
    }
    final completer = Completer<T>();
    _pending++;
    error = null;
    _notify();
    _queue = _queue.then((_) async {
      try {
        _checkWritable();
        completer.complete(await action());
      } catch (e, stack) {
        if (e is _ManualManifestException) isReadOnly = true;
        final message = e is ManualLibraryException
            ? e.message
            : e is FormatException
            ? 'Неверный или повреждённый PDF. Выберите другой файл.'
            : 'Не удалось сохранить PDF на устройстве. Освободите место и повторите.';
        error = message;
        completer.completeError(ManualLibraryException(message), stack);
      } finally {
        _pending--;
        _notify();
      }
    });
    return completer.future;
  }

  Future<ManualRecord> importPdf({
    required String profileId,
    required String title,
    required String fileName,
    required Uint8List bytes,
  }) {
    if (bytes.length > maxManualPdfBytes) {
      return _enqueue(
        () async => throw const ManualLibraryException('PDF превышает 30 МБ.'),
      );
    }
    final snapshot = Uint8List.fromList(bytes);
    return _enqueue(
      () => _storePdf(
        profileId: profileId,
        title: title,
        fileName: fileName,
        bytes: snapshot,
        origin: 'user',
      ),
    );
  }

  Future<ManualRecord> downloadPdf({
    required String profileId,
    required String title,
    required Uri uri,
  }) => _enqueue(() async {
    _validateScope(profileId, title);
    final file = await _downloader.download(uri);
    _checkWritable();
    return _storePdf(
      profileId: profileId,
      title: title,
      fileName: file.fileName,
      bytes: file.bytes,
      origin: 'manufacturer',
      sourceUrl: uri.toString(),
    );
  });

  Future<ManualRecord> _storePdf({
    required String profileId,
    required String title,
    required String fileName,
    required Uint8List bytes,
    required String origin,
    String? sourceUrl,
  }) async {
    _checkWritable();
    _validateScope(profileId, title);
    _validatePdf(bytes);
    final hash = _digest(bytes);
    final duplicate = _records
        .where((r) => r.profileId == profileId && r.sha256 == hash)
        .firstOrNull;
    if (duplicate == null && _records.length >= maxManualRecords) {
      throw const ManualLibraryException(
        'В библиотеке уже 500 PDF. Уберите ненужную привязку и повторите.',
      );
    }
    await repository.writeBlob(hash, bytes);
    _checkWritable();
    if (duplicate != null) return duplicate;
    final record = ManualRecord(
      id: newId(),
      profileId: profileId,
      title: title.trim(),
      fileName: _safeFileName(fileName),
      sha256: hash,
      sizeBytes: bytes.length,
      addedAt: DateTime.now().toUtc(),
      origin: origin,
      sourceUrl: sourceUrl,
    );
    final next = List<ManualRecord>.unmodifiable([..._records, record]);
    await repository.writeRecords(next);
    if (!_disposed) _records = next;
    return record;
  }

  Future<Uint8List> readPdf(ManualRecord record) async {
    if (_disposed ||
        !ready ||
        !_records.any((r) => r.id == record.id && r.sha256 == record.sha256)) {
      throw const ManualLibraryException('PDF больше не привязан к профилю.');
    }
    try {
      final bytes = await repository.readBlob(record.sha256);
      if (bytes.length != record.sizeBytes) {
        throw const FormatException('Неверный размер PDF');
      }
      return bytes;
    } catch (_) {
      throw const ManualLibraryException(
        'Сохранённый PDF отсутствует или повреждён. Добавьте исходный файл заново.',
      );
    }
  }

  Future<void> removeRecord(String id) => _enqueue(() async {
    final next = List<ManualRecord>.unmodifiable(
      _records.where((r) => r.id != id),
    );
    if (next.length == _records.length) return;
    await repository.writeRecords(next);
    if (!_disposed) _records = next;
    // Blobs remain cached so removing a profile attachment cannot destroy other copies.
  });

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _downloader.close();
    super.dispose();
  }
}

void _validateScope(String profileId, String title) {
  if (profileId.trim().isEmpty ||
      profileId.length > 150 ||
      title.trim().isEmpty ||
      title.length > 240 ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch('$profileId$title')) {
    throw const ManualLibraryException('Не указан профиль или название PDF.');
  }
}

void _validatePdf(Uint8List bytes) {
  if (bytes.length > maxManualPdfBytes) {
    throw const FormatException('PDF превышает 30 МБ');
  }
  final prefix = latin1.decode(bytes.take(1024).toList());
  if (bytes.length < 5 ||
      !prefix.contains('%PDF-') ||
      prefix.trimLeft().startsWith('<')) {
    throw const FormatException('Файл не является PDF');
  }
}

String _safeFileName(String raw) {
  var name = raw
      .replaceAll('\\', '/')
      .split('/')
      .last
      .replaceAll(RegExp(r'[\x00-\x1f\x7f]'), '')
      .trim();
  if (name.isEmpty || name == '.' || name == '..') name = 'Инструкция.pdf';
  if (!name.toLowerCase().endsWith('.pdf')) name = '$name.pdf';
  if (name.length > 180) name = '${name.substring(0, 176)}.pdf';
  return name;
}

String _digest(Uint8List bytes) => hashing.sha256.convert(bytes).toString();
void _checkHash(String value) {
  if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(value)) {
    throw const FormatException('Неверная контрольная сумма PDF');
  }
}

String _text(Map<String, dynamic> value, String key, int max) {
  final text = value[key];
  if (text is! String ||
      text.trim().isEmpty ||
      text.length > max ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch(text)) {
    throw FormatException('Неверное поле $key');
  }
  return text;
}

Map<String, dynamic> _encodeManifest(List<ManualRecord> records) => {
  'format': 'svoi-lyudi-manual-library',
  'version': 1,
  'records': records.map((r) => r.toJson()).toList(),
};
List<ManualRecord> _decodeManifest(dynamic value) {
  if (value is! Map<String, dynamic> ||
      value['format'] != 'svoi-lyudi-manual-library' ||
      value['version'] != 1 ||
      value['records'] is! List ||
      (value['records'] as List).length > maxManualRecords) {
    throw const FormatException('Неверный формат библиотеки PDF');
  }
  final records = (value['records'] as List)
      .map((row) {
        if (row is! Map<String, dynamic>) {
          throw const FormatException('Неверная запись PDF');
        }
        return ManualRecord.fromJson(row);
      })
      .toList(growable: false);
  if (records.map((r) => r.id).toSet().length != records.length ||
      records.map((r) => '${r.profileId}\u0000${r.sha256}').toSet().length !=
          records.length) {
    throw const FormatException('Повторяющиеся записи PDF');
  }
  return records;
}
