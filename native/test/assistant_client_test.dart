import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:svoi_lyudi_native/services/assistant_client.dart';

const _token =
    'native-v1.eyJ0eXBlIjoibmF0aXZlIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Future<HttpServer> _server(Future<void> Function(HttpRequest) handle) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((request) {
    unawaited(
      handle(request).catchError((Object error, StackTrace stack) {
        // A deliberately aborted client can close the socket before the test server writes.
        if (error is! IOException) Error.throwWithStackTrace(error, stack);
      }),
    );
  });
  addTearDown(() => server.close(force: true));
  return server;
}

Uri _address(HttpServer server) =>
    Uri.parse('http://127.0.0.1:${server.port}/');

HttpNativeAssistantApi _api(
  HttpServer server, {
  Duration timeout = const Duration(seconds: 2),
  HttpClient? client,
}) {
  final api = HttpNativeAssistantApi(
    baseUri: _address(server),
    client: client,
    timeout: timeout,
    allowInsecureLoopbackForTests: true,
  );
  addTearDown(api.close);
  return api;
}

Map<String, Object> _loginReply() => {
  'configured': true,
  'authenticated': true,
  'accessToken': _token,
  'tokenType': 'Bearer',
  'expiresAt':
      DateTime.now().add(const Duration(hours: 12)).millisecondsSinceEpoch ~/
      1000,
};

Future<void> _json(HttpRequest request, Object body, {int status = 200}) async {
  request.response.statusCode = status;
  request.response.headers.contentType = ContentType.json;
  request.response.write(jsonEncode(body));
  await request.response.close();
}

NativeSession _session({DateTime? expiresAt}) => NativeSession(
  accessToken: _token,
  expiresAt: expiresAt ?? DateTime.now().add(const Duration(hours: 1)),
);

Matcher _apiError({String? containsMessage, int? status}) =>
    isA<AssistantApiException>()
        .having(
          (e) => e.message,
          'safe message',
          containsMessage == null ? isNotEmpty : contains(containsMessage),
        )
        .having((e) => e.statusCode, 'status code', status);

void main() {
  test('real IO login sends JSON without browser metadata and chat uses only its bearer token', () async {
    final received = <Map<String, Object?>>[];
    final server = await _server((request) async {
      final body = await utf8.decoder.bind(request).join();
      received.add({
        'path': request.uri.path,
        'method': request.method,
        'origin': request.headers.value('origin'),
        'fetch': request.headers.value('sec-fetch-site'),
        'cookie': request.headers.value('cookie'),
        'authorization': request.headers.value('authorization'),
        'type': request.headers.contentType?.mimeType,
        'accept': request.headers.value('accept'),
        'body': jsonDecode(body),
      });
      if (request.uri.path == '/api/native/auth') {
        await _json(request, _loginReply());
      } else {
        await _json(request, {
          'reply': 'Проверьте размеры объекта.',
          'calculation': 'none',
        });
      }
    });
    final api = _api(server);
    final session = await api.signIn('Тестовый пароль владельца');
    expect(session.expired, isFalse);
    final reply = await api.chat(
      session,
      const NativeChatRequest(
        message: 'А теперь без утепления?',
        mode: 'facade',
        history: [
          NativeHistoryMessage('user', 'Сайдинг'),
          NativeHistoryMessage('assistant', 'Уточните проект'),
        ],
      ),
    );
    expect(reply.text, 'Проверьте размеры объекта.');
    expect(reply.calculation, 'none');
    expect(received, hasLength(2));
    expect(received.first['path'], '/api/native/auth');
    expect(received.first['body'], {'password': 'Тестовый пароль владельца'});
    expect(received.first['authorization'], isNull);
    expect(received.last['path'], '/api/native/chat');
    expect(received.last['authorization'], 'Bearer $_token');
    expect(received.last['body'], {
      'message': 'А теперь без утепления?',
      'mode': 'facade',
      'history': [
        {'role': 'user', 'content': 'Сайдинг'},
        {'role': 'assistant', 'content': 'Уточните проект'},
      ],
    });
    for (final request in received) {
      expect(request['method'], 'POST');
      expect(request['origin'], isNull);
      expect(request['fetch'], isNull);
      expect(request['cookie'], isNull);
      expect(request['type'], 'application/json');
      expect(request['accept'], 'application/json');
    }
  });

  test(
    'redirects never forward a password or bearer token to another server',
    () async {
      var targetRequests = 0;
      final target = await _server((request) async {
        targetRequests++;
        await request.drain<void>();
        await _json(request, _loginReply());
      });
      var originalRequests = 0;
      final original = await _server((request) async {
        originalRequests++;
        await request.drain<void>();
        request.response.statusCode = HttpStatus.temporaryRedirect;
        request.response.headers.set(
          HttpHeaders.locationHeader,
          _address(target).resolve('/stolen'),
        );
        await request.response.close();
      });
      final api = _api(original);
      await expectLater(
        api.signIn('password-must-stay-at-origin'),
        throwsA(_apiError(containsMessage: 'перенаправляет')),
      );
      await expectLater(
        api.chat(
          _session(),
          const NativeChatRequest(message: 'Вопрос', mode: 'general'),
        ),
        throwsA(_apiError(containsMessage: 'перенаправляет')),
      );
      expect(originalRequests, 2);
      expect(targetRequests, 0);
    },
  );

  test('HTTP errors preserve status without displaying an HTML proxy response or oversized error text', () async {
    var count = 0;
    const sentinel = 'secret-should-not-be-displayed';
    final server = await _server((request) async {
      await request.drain<void>();
      count++;
      if (count == 1) {
        request.response.statusCode = 503;
        request.response.headers.contentType = ContentType.html;
        request.response.write('<html>$sentinel</html>');
        await request.response.close();
      } else {
        await _json(request, {'error': '$sentinel${'x' * 600}'}, status: 429);
      }
    });
    final api = _api(server);
    for (final status in [503, 429]) {
      try {
        await api.signIn('test-password');
        fail('An error response must not authenticate');
      } on AssistantApiException catch (error) {
        expect(error.statusCode, status);
        expect(error.message, isNot(contains(sentinel)));
        expect(error.message, isNot(contains('<html>')));
      }
    }
  });

  test('actual received bytes bound auth and chat responses', () async {
    final server = await _server((request) async {
      await request.drain<void>();
      await _json(request, {
        'reply': 'я' * (300 * 1024),
        'calculation': 'none',
      });
    });
    final api = _api(server);
    await expectLater(
      api.signIn('test-password'),
      throwsA(_apiError(containsMessage: 'слишком большой')),
    );
    await expectLater(
      api.chat(
        _session(),
        const NativeChatRequest(message: 'Вопрос', mode: 'general'),
      ),
      throwsA(_apiError(containsMessage: 'слишком большой')),
    );
  });

  test('malformed UTF8 and unsupported chat envelopes never become successful replies', () async {
    var count = 0;
    final server = await _server((request) async {
      await request.drain<void>();
      count++;
      if (count == 1) {
        request.response.add([0xff, 0xfe]);
        await request.response.close();
      } else if (count == 2) {
        await _json(request, {'reply': 'Ответ', 'calculation': 'unsupported'});
      } else {
        await _json(request, {'reply': 'x' * 100001, 'calculation': 'none'});
      }
    });
    final api = _api(server);
    for (var i = 0; i < 3; i++) {
      await expectLater(
        api.chat(
          _session(),
          const NativeChatRequest(message: 'Вопрос', mode: 'general'),
        ),
        throwsA(isA<AssistantApiException>()),
      );
    }
  });

  test('expired sessions fail before any request is sent', () async {
    var requests = 0;
    final server = await _server((request) async {
      requests++;
      await request.drain<void>();
      await _json(request, {
        'reply': 'Не должен появиться',
        'calculation': 'none',
      });
    });
    final api = _api(server);
    await expectLater(
      api.chat(
        _session(
          expiresAt: DateTime.now().subtract(const Duration(seconds: 1)),
        ),
        const NativeChatRequest(message: 'Вопрос', mode: 'general'),
      ),
      throwsA(_apiError(status: 401)),
    );
    expect(requests, 0);
  });

  test(
    'a response-body timeout fails and the same API can make a fresh request',
    () async {
      var requests = 0;
      final release = Completer<void>();
      addTearDown(() {
        if (!release.isCompleted) release.complete();
      });
      final server = await _server((request) async {
        await request.drain<void>();
        requests++;
        if (requests == 1) {
          request.response.headers.contentType = ContentType.json;
          request.response.write('{"accessToken":"');
          await request.response.flush();
          await release.future;
          await request.response.close();
        } else {
          await _json(request, _loginReply());
        }
      });
      final api = _api(server, timeout: const Duration(milliseconds: 120));
      await expectLater(
        api.signIn('first-password'),
        throwsA(_apiError(containsMessage: 'слишком долго')),
      );
      release.complete();
      expect((await api.signIn('second-password')).expired, isFalse);
      expect(requests, 2);
    },
  );

  test('a login that times out waiting for a connection never sends its password later', () async {
    final blocked = Completer<void>(), releaseBlocker = Completer<void>();
    addTearDown(() {
      if (!releaseBlocker.isCompleted) releaseBlocker.complete();
    });
    var credentialRequests = 0;
    final server = await _server((request) async {
      await request.drain<void>();
      if (request.uri.path == '/block') {
        blocked.complete();
        await releaseBlocker.future;
        await _json(request, {'done': true});
      } else {
        credentialRequests++;
        await _json(request, _loginReply());
      }
    });
    final sharedClient = HttpClient()..maxConnectionsPerHost = 1;
    final api = _api(
      server,
      client: sharedClient,
      timeout: const Duration(milliseconds: 120),
    );
    final blocker = await sharedClient.getUrl(
      _address(server).resolve('/block'),
    );
    final blockerDone = blocker
        .close()
        .then((response) => response.drain<void>())
        .catchError((Object error) {
          if (error is! IOException) throw error;
        });
    await blocked.future.timeout(const Duration(seconds: 2));
    await expectLater(
      api.signIn('password-must-never-be-sent'),
      throwsA(_apiError(containsMessage: 'слишком долго')),
    );
    releaseBlocker.complete();
    await blockerDone;
    await Future<void>.delayed(const Duration(milliseconds: 180));
    expect(credentialRequests, 0);
  });

  test('production addresses require HTTPS, a root path and no credentials or URL metadata', () {
    for (final uri in [
      'http://127.0.0.1:1234/',
      'http://localhost/',
      'http://assistant.test/',
      'https://name:password@assistant.test/',
      'https://assistant.test/api',
      'https://assistant.test/?token=hidden',
      'https://assistant.test/#fragment',
      'file:///tmp/app',
    ]) {
      expect(
        () => HttpNativeAssistantApi(baseUri: Uri.parse(uri)),
        throwsArgumentError,
        reason: uri,
      );
    }
    expect(
      () => HttpNativeAssistantApi(
        baseUri: Uri.parse('http://assistant.test/'),
        allowInsecureLoopbackForTests: true,
      ),
      throwsArgumentError,
    );
    final valid = HttpNativeAssistantApi(
      baseUri: Uri.parse('https://assistant.test/'),
    );
    valid.close();
  });
}
