import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/services/manual_library.dart';

Uint8List _pdf([String label = 'manual']) =>
    Uint8List.fromList(utf8.encode('%PDF-1.7\n$label\n%%EOF'));

Matcher _libraryError([String? text]) => isA<ManualLibraryException>().having(
  (error) => error.message,
  'safe Russian error',
  text == null ? isNotEmpty : contains(text),
);

Future<ManualLibrary> _library([ManualRepository? repository]) async {
  final library = ManualLibrary(repository ?? MemoryManualRepository());
  addTearDown(library.dispose);
  await library.initialize();
  return library;
}

Future<Directory> _directory() async {
  final directory = await Directory.systemTemp.createTemp(
    'manual-library-test-',
  );
  addTearDown(() => directory.delete(recursive: true));
  return directory;
}

Future<ManualRecord> _import(
  ManualLibrary library, {
  String profile = 'profile-a',
  String title = 'Инструкция',
  String fileName = 'manual.pdf',
  Uint8List? bytes,
}) => library.importPdf(
  profileId: profile,
  title: title,
  fileName: fileName,
  bytes: bytes ?? _pdf(),
);

Future<HttpServer> _server(Future<void> Function(HttpRequest) handle) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((request) {
    unawaited(
      handle(request).catchError((Object error, StackTrace stack) {
        // Timeouts deliberately close connections before the response is complete.
        if (error is! IOException) Error.throwWithStackTrace(error, stack);
      }),
    );
  });
  addTearDown(() => server.close(force: true));
  return server;
}

Uri _url(HttpServer server, [String path = '/manual.pdf']) =>
    Uri.parse('http://127.0.0.1:${server.port}$path');

HttpManualDownloader _downloader({
  HttpClient? client,
  Duration timeout = const Duration(seconds: 2),
}) {
  final downloader = HttpManualDownloader(
    client: client,
    timeout: timeout,
    allowInsecureLoopbackForTests: true,
  );
  addTearDown(downloader.close);
  return downloader;
}

Future<void> _respondPdf(HttpRequest request, [String label = 'manual']) async {
  request.response.headers.contentType = ContentType('application', 'pdf');
  request.response.add(_pdf(label));
  await request.response.close();
}

void main() {
  test('imports are scoped, duplicate content is stored once and names cannot become paths', () async {
    final repository = MemoryManualRepository();
    final library = await _library(repository);
    final first = await _import(library, fileName: r'C:\downloads\manual.exe');
    final same = await _import(library, title: 'Другой заголовок');
    final other = await _import(library, profile: 'profile-b');
    expect(same.id, first.id);
    expect(other.id, isNot(first.id));
    expect(first.fileName, 'manual.exe.pdf');
    expect(first.origin, 'user');
    expect(first.sourceUrl, isNull);
    expect(repository.blobs.length, 1);
    expect(library.recordsFor('profile-a').length, 1);
    expect(library.recordsFor('profile-b').length, 1);
    expect(await library.readPdf(first), orderedEquals(_pdf()));
  });

  test(
    'an input buffer is snapshotted before a queued import can observe edits',
    () async {
      final library = await _library();
      final bytes = _pdf('original');
      final expected = Uint8List.fromList(bytes);
      final importing = _import(library, bytes: bytes);
      bytes.fillRange(0, bytes.length, 0);
      final record = await importing;
      expect(await library.readPdf(record), orderedEquals(expected));
    },
  );

  test('failed metadata write does not claim success; the same cached PDF can be retried', () async {
    final repository = MemoryManualRepository()..failWrites = true;
    final library = await _library(repository);
    await expectLater(_import(library), throwsA(_libraryError()));
    expect(library.records, isEmpty);
    expect(repository.records, isEmpty);
    expect(repository.blobs.length, 1);
    expect(library.busy, isFalse);
    repository.failWrites = false;
    final record = await _import(library);
    expect(library.records.single.id, record.id);
    expect(repository.blobs.length, 1);
    expect(library.error, isNull);
  });

  test(
    'malformed persisted metadata is preserved and blocks every write',
    () async {
      final directory = await _directory();
      final manifest = File('${directory.path}/manifest.json');
      const damaged = '{not a JSON manifest';
      await manifest.writeAsString(damaged);
      final library = await _library(
        FileManualRepository(directory: directory),
      );
      expect(library.ready, isTrue);
      expect(library.isReadOnly, isTrue);
      expect(library.error, contains('Исходные файлы сохранены'));
      await expectLater(_import(library), throwsA(_libraryError()));
      await expectLater(
        library.removeRecord('anything'),
        throwsA(_libraryError()),
      );
      expect(await manifest.readAsString(), damaged);
    },
  );

  test(
    'file imports survive restart with a valid previous manifest backup',
    () async {
      final directory = await _directory();
      final library = await _library(
        FileManualRepository(directory: directory),
      );
      final original = await _import(library);
      final firstManifest = await File('${directory.path}/manifest.json')
          .readAsString();
      await _import(library, profile: 'profile-b', bytes: _pdf('different'));
      expect(
        await File('${directory.path}/manifest.json.backup').readAsString(),
        firstManifest,
      );
      final reopened = await _library(
        FileManualRepository(directory: directory),
      );
      expect(reopened.records.length, 2);
      expect(
        await reopened.readPdf(reopened.recordsFor('profile-a').single),
        orderedEquals(_pdf()),
      );
      expect(reopened.recordsFor('profile-a').single.id, original.id);
      expect(
        await directory
            .list()
            .where((entity) => entity.path.endsWith('.tmp'))
            .length,
        0,
      );
    },
  );

  test('external manifest corruption freezes an already loaded library without replacing damaged bytes', () async {
    final directory = await _directory();
    final library = await _library(FileManualRepository(directory: directory));
    final original = await _import(library);
    final manifest = File('${directory.path}/manifest.json');
    const damaged = '{externally changed metadata';
    await manifest.writeAsString(damaged);
    await expectLater(
      _import(library, profile: 'profile-b', bytes: _pdf('second')),
      throwsA(_libraryError()),
    );
    expect(library.isReadOnly, isTrue);
    expect(library.records.single.id, original.id);
    expect(await manifest.readAsString(), damaged);
    await expectLater(
      library.removeRecord(original.id),
      throwsA(_libraryError()),
    );
    expect(await manifest.readAsString(), damaged);
  });

  test('tampered blobs are rejected; reimport repairs the content without losing its attachment', () async {
    final directory = await _directory();
    final library = await _library(FileManualRepository(directory: directory));
    final record = await _import(library);
    final file = File('${directory.path}/pdfs/${record.sha256}.pdf');
    await file.writeAsBytes(_pdf('tampered'));
    await expectLater(
      library.readPdf(record),
      throwsA(_libraryError('повреждён')),
    );
    final repaired = await _import(library);
    expect(repaired.id, record.id);
    expect(await library.readPdf(record), orderedEquals(_pdf()));
    expect(
      await Directory('${directory.path}/pdfs')
          .list()
          .where((entity) => entity.path.contains('.damaged-'))
          .length,
      1,
    );
  });

  test(
    'removing one attachment leaves another profile and its shared PDF intact',
    () async {
      final repository = MemoryManualRepository();
      final library = await _library(repository);
      final first = await _import(library);
      final second = await _import(library, profile: 'profile-b');
      await library.removeRecord(first.id);
      expect(library.recordsFor('profile-a'), isEmpty);
      expect(await library.readPdf(second), orderedEquals(_pdf()));
      expect(repository.blobs.length, 1);
      await expectLater(
        library.readPdf(first),
        throwsA(_libraryError('не привязан')),
      );
    },
  );

  test('concurrent imports keep their captured profile and never overwrite metadata', () async {
    final library = await _library();
    final records = await Future.wait([
      _import(library, profile: 'profile-a', bytes: _pdf('a')),
      _import(library, profile: 'profile-b', bytes: _pdf('b')),
      _import(library, profile: 'profile-c', bytes: _pdf('c')),
    ]);
    expect(library.records.length, 3);
    expect(records.map((r) => r.profileId), [
      'profile-a',
      'profile-b',
      'profile-c',
    ]);
    expect(library.busy, isFalse);
  });

  test(
    'non-PDF and oversized imports never enter records or the blob cache',
    () async {
      final repository = MemoryManualRepository();
      final library = await _library(repository);
      await expectLater(
        _import(
          library,
          bytes: Uint8List.fromList(utf8.encode('<html>%PDF-1.7 fake</html>')),
        ),
        throwsA(_libraryError()),
      );
      await expectLater(
        _import(library, bytes: Uint8List(maxManualPdfBytes + 1)),
        throwsA(_libraryError('30 МБ')),
      );
      expect(library.records, isEmpty);
      expect(repository.blobs, isEmpty);
    },
  );

  test(
    'production downloader rejects insecure and credential-bearing source URLs',
    () async {
      final downloader = HttpManualDownloader();
      addTearDown(downloader.close);
      for (final source in [
        'http://127.0.0.1:12345/manual.pdf',
        'http://manufacturer.example/manual.pdf',
        'https://name:password@manufacturer.example/manual.pdf',
        'file:///tmp/manual.pdf',
      ]) {
        await expectLater(
          downloader.download(Uri.parse(source)),
          throwsA(_libraryError('HTTPS')),
          reason: source,
        );
      }
    },
  );

  test('real IO follows a public redirect without cookies or credentials and records its source', () async {
    final received = <Map<String, String?>>[];
    final server = await _server((request) async {
      await request.drain<void>();
      received.add({
        'path': request.uri.path,
        'cookie': request.headers.value(HttpHeaders.cookieHeader),
        'authorization': request.headers.value(HttpHeaders.authorizationHeader),
      });
      if (request.uri.path == '/start') {
        request.response.statusCode = 302;
        request.response.cookies.add(
          Cookie('session', 'must-not-be-forwarded'),
        );
        request.response.headers.set(HttpHeaders.locationHeader, '/final.pdf');
        await request.response.close();
      } else {
        await _respondPdf(request);
      }
    });
    final library = ManualLibrary(
      MemoryManualRepository(),
      downloader: _downloader(),
    );
    addTearDown(library.dispose);
    await library.initialize();
    final record = await library.downloadPdf(
      profileId: 'profile-a',
      title: 'Производитель',
      uri: _url(server, '/start'),
    );
    expect(record.origin, 'manufacturer');
    expect(record.sourceUrl, _url(server, '/start').toString());
    expect(record.fileName, 'final.pdf');
    expect(await library.readPdf(record), orderedEquals(_pdf()));
    expect(received.map((r) => r['path']), ['/start', '/final.pdf']);
    expect(
      received.every((r) => r['cookie'] == null && r['authorization'] == null),
      isTrue,
    );
  });

  test('redirect loops are bounded and redirects to non-HTTPS remote hosts are rejected', () async {
    var requests = 0;
    final server = await _server((request) async {
      requests++;
      request.response.statusCode = 302;
      request.response.headers.set(
        HttpHeaders.locationHeader,
        request.uri.path == '/downgrade'
            ? 'http://manufacturer.example/manual.pdf'
            : '/loop',
      );
      await request.response.close();
    });
    final downloader = _downloader();
    await expectLater(
      downloader.download(_url(server, '/loop')),
      throwsA(_libraryError('перенаправлений')),
    );
    expect(requests, 4);
    await expectLater(
      downloader.download(_url(server, '/downgrade')),
      throwsA(_libraryError('HTTPS')),
    );
    expect(requests, 5);
  });

  test('HTML success responses and oversized advertised files are rejected before storage', () async {
    final release = Completer<void>();
    addTearDown(() {
      if (!release.isCompleted) release.complete();
    });
    final server = await _server((request) async {
      if (request.uri.path == '/huge') {
        request.response.contentLength = maxManualPdfBytes + 1;
        request.response.write('%PDF-1.7');
        await request.response.flush();
        await release.future;
        await request.response.close();
      } else {
        request.response.headers.contentType = ContentType(
          'application',
          'pdf',
        );
        request.response.write('<html>Login required</html>');
        await request.response.close();
      }
    });
    final downloader = _downloader();
    await expectLater(
      downloader.download(_url(server)),
      throwsA(_libraryError('не PDF')),
    );
    await expectLater(
      downloader.download(_url(server, '/huge')),
      throwsA(_libraryError('30 МБ')),
    );
  });

  test(
    'response-body timeout cancels that transfer and permits a fresh download',
    () async {
      var requests = 0;
      final release = Completer<void>();
      addTearDown(() {
        if (!release.isCompleted) release.complete();
      });
      final server = await _server((request) async {
        if (++requests == 1) {
          request.response.add(_pdf());
          await request.response.flush();
          await release.future;
          await request.response.close();
        } else {
          await _respondPdf(request, 'retry');
        }
      });
      final downloader = _downloader(
        timeout: const Duration(milliseconds: 120),
      );
      await expectLater(
        downloader.download(_url(server)),
        throwsA(_libraryError('слишком долго')),
      );
      release.complete();
      expect(
        (await downloader.download(_url(server))).bytes,
        orderedEquals(_pdf('retry')),
      );
    },
  );

  test('the streaming byte cap also rejects a PDF expanded beyond 30 MB by HTTP decompression', () async {
    final expanded = Uint8List(maxManualPdfBytes + 1);
    expanded.setRange(0, _pdf().length, _pdf());
    final compressed = gzip.encode(expanded);
    expect(compressed.length, lessThan(maxManualPdfBytes));
    final server = await _server((request) async {
      request.response.headers.contentType = ContentType('application', 'pdf');
      request.response.headers.set(HttpHeaders.contentEncodingHeader, 'gzip');
      request.response.contentLength = compressed.length;
      request.response.add(compressed);
      await request.response.close();
    });
    final downloader = _downloader();
    await expectLater(
      downloader.download(_url(server)),
      throwsA(_libraryError('30 МБ')),
    );
  });

  test(
    'a timeout queued behind a connection never sends the stale download later',
    () async {
      final blocked = Completer<void>(), release = Completer<void>();
      addTearDown(() {
        if (!release.isCompleted) release.complete();
      });
      var staleRequests = 0;
      final server = await _server((request) async {
        if (request.uri.path == '/block') {
          blocked.complete();
          await release.future;
        } else {
          staleRequests++;
        }
        await _respondPdf(request);
      });
      final client = HttpClient()..maxConnectionsPerHost = 1;
      final downloader = _downloader(
        client: client,
        timeout: const Duration(milliseconds: 120),
      );
      final blocker = await client.getUrl(_url(server, '/block'));
      final blockerDone = blocker
          .close()
          .then((response) => response.drain<void>())
          .catchError((Object error) {
            if (error is! IOException) throw error;
          });
      await blocked.future.timeout(const Duration(seconds: 2));
      await expectLater(
        downloader.download(_url(server)),
        throwsA(_libraryError('слишком долго')),
      );
      release.complete();
      await blockerDone;
      await Future<void>.delayed(const Duration(milliseconds: 180));
      expect(staleRequests, 0);
    },
  );
}
