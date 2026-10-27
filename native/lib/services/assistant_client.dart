import 'dart:async';
import 'dart:convert';
import 'dart:io';

class AssistantApiException implements Exception {
  const AssistantApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

/// A short-lived credential. Deliberately has no JSON or printable token getter.
class NativeSession {
  NativeSession({required String accessToken, required this.expiresAt})
    : _accessToken = _validatedToken(accessToken);
  final String _accessToken;
  final DateTime expiresAt;
  bool get expired => !expiresAt.isAfter(DateTime.now());
  static String _validatedToken(String token) {
    if (token.isEmpty ||
        token.length > 2048 ||
        !RegExp(r'^[A-Za-z0-9_.-]+$').hasMatch(token)) {
      throw ArgumentError('Некорректный формат сессии.');
    }
    return token;
  }
}

class NativeHistoryMessage {
  const NativeHistoryMessage(this.role, this.content);
  final String role, content;
  Map<String, String> toJson() => {'role': role, 'content': content};
}

class NativeChatRequest {
  const NativeChatRequest({
    required this.message,
    required this.mode,
    this.history = const [],
    this.projectContext,
  });
  final String message, mode;
  final List<NativeHistoryMessage> history;
  final Map<String, dynamic>? projectContext;
  Map<String, dynamic> toJson() => {
    'message': message,
    'mode': mode,
    'history': history.map((m) => m.toJson()).toList(),
    if (projectContext != null) 'projectContext': projectContext,
  };
}

class NativeChatReply {
  const NativeChatReply(this.text, {this.calculation = 'none'});
  final String text, calculation;
}

abstract interface class NativeAssistantApi {
  Future<NativeSession> signIn(String password);
  Future<NativeChatReply> chat(
    NativeSession session,
    NativeChatRequest request,
  );
  void close();
}

/// Uses the operating system's TLS trust. Never follows credential-bearing redirects.
class HttpNativeAssistantApi implements NativeAssistantApi {
  HttpNativeAssistantApi({
    required Uri baseUri,
    HttpClient? client,
    this.timeout = const Duration(seconds: 45),
    bool allowInsecureLoopbackForTests = false,
  }) : _client = client ?? HttpClient(),
       _baseUri = baseUri {
    final loopback = const [
      '127.0.0.1',
      '::1',
      'localhost',
    ].contains(baseUri.host);
    if ((baseUri.scheme != 'https' &&
            !(allowInsecureLoopbackForTests &&
                loopback &&
                baseUri.scheme == 'http')) ||
        baseUri.host.isEmpty ||
        baseUri.userInfo.isNotEmpty ||
        baseUri.hasQuery ||
        baseUri.hasFragment ||
        (baseUri.path.isNotEmpty && baseUri.path != '/')) {
      _client.close(force: true);
      throw ArgumentError('Для помощника нужен корневой адрес HTTPS.');
    }
    _client.connectionTimeout = const Duration(seconds: 15);
  }
  final HttpClient _client;
  final Uri _baseUri;
  final Duration timeout;
  bool _closed = false;
  final Set<HttpClientRequest> _pending = {};

  @override
  Future<NativeSession> signIn(String password) async {
    final value = await _post('/api/native/auth', {
      'password': password,
    }, maxBytes: 16 * 1024);
    final token = value['accessToken'];
    final seconds = value['expiresAt'];
    if (value['authenticated'] != true ||
        value['tokenType'] != 'Bearer' ||
        token is! String ||
        token.isEmpty ||
        token.length > 2048 ||
        seconds is! int ||
        seconds < 1 ||
        seconds > 8640000000000) {
      throw const AssistantApiException('Сервер вернул неверные данные входа.');
    }
    final session = NativeSession(
      accessToken: token,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        seconds * 1000,
        isUtc: true,
      ),
    );
    if (session.expired) {
      throw const AssistantApiException(
        'Срок входа истёк. Войдите ещё раз.',
        statusCode: 401,
      );
    }
    return session;
  }

  @override
  Future<NativeChatReply> chat(
    NativeSession session,
    NativeChatRequest request,
  ) async {
    if (session.expired) {
      throw const AssistantApiException(
        'Срок входа истёк. Войдите ещё раз.',
        statusCode: 401,
      );
    }
    final value = await _post(
      '/api/native/chat',
      request.toJson(),
      session: session,
    );
    final reply = value['reply'];
    if (reply is! String ||
        reply.trim().isEmpty ||
        reply.length > 100000 ||
        !const ['none', 'estimate'].contains(value['calculation'])) {
      throw const AssistantApiException(
        'Ответ помощника повреждён. Повторите запрос.',
      );
    }
    return NativeChatReply(reply, calculation: value['calculation'] as String);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    NativeSession? session,
    int maxBytes = 512 * 1024,
  }) async {
    if (_closed) throw const AssistantApiException('Подключение закрыто.');
    HttpClientRequest? pending;
    var cancelled = false;
    try {
      return await (() async {
        final request = await _client.postUrl(_baseUri.resolve(path));
        if (cancelled || _closed) {
          request.abort();
          throw const AssistantApiException('Запрос отменён.');
        }
        pending = request;
        _pending.add(request);
        request.followRedirects = false;
        request.headers.contentType = ContentType.json;
        request.headers.set(HttpHeaders.acceptHeader, 'application/json');
        if (session != null) {
          request.headers.set(
            HttpHeaders.authorizationHeader,
            'Bearer ${session._accessToken}',
          );
        }
        final bytes = utf8.encode(jsonEncode(body));
        if (bytes.length > 256 * 1024) {
          throw const AssistantApiException(
            'Запрос слишком большой. Начните новый диалог.',
          );
        }
        request.contentLength = bytes.length;
        request.add(bytes);
        final response = await request.close();
        if (response.statusCode >= 300 && response.statusCode < 400) {
          throw const AssistantApiException(
            'Сервер перенаправляет запрос. Проверьте подключение помощника.',
          );
        }
        final chunks = <int>[];
        await for (final chunk in response) {
          if (chunks.length + chunk.length > maxBytes) {
            throw const AssistantApiException('Ответ сервера слишком большой.');
          }
          chunks.addAll(chunk);
        }
        Map<String, dynamic>? value;
        try {
          final parsed = jsonDecode(utf8.decode(chunks));
          if (parsed is Map<String, dynamic>) value = parsed;
        } on FormatException {
          // Never display HTML from a proxy, or any unvalidated raw response.
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          final serverError = value?['error'];
          final safeMessage =
              serverError is String &&
                  serverError.isNotEmpty &&
                  serverError.length <= 500
              ? serverError
              : switch (response.statusCode) {
                  401 => 'Войдите в помощник ещё раз.',
                  404 => 'Сервер помощника ещё не обновлён.',
                  429 => 'Слишком много запросов. Подождите и повторите.',
                  _ => 'Помощник временно недоступен. Повторите позже.',
                };
          throw AssistantApiException(
            safeMessage,
            statusCode: response.statusCode,
          );
        }
        if (value == null) {
          throw const AssistantApiException(
            'Не удалось прочитать ответ сервера.',
          );
        }
        return value;
      })().timeout(timeout);
    } on AssistantApiException {
      rethrow;
    } on TimeoutException {
      throw const AssistantApiException(
        'Помощник отвечает слишком долго. Вопрос сохранён; повторите запрос.',
      );
    } on IOException {
      throw const AssistantApiException(
        'Нет связи с помощником. Проверьте интернет и повторите.',
      );
    } finally {
      cancelled = true;
      pending?.abort();
      _pending.remove(pending);
    }
  }

  @override
  void close() {
    _closed = true;
    for (final request in _pending) {
      request.abort();
    }
    _pending.clear();
    _client.close(force: true);
  }
}
