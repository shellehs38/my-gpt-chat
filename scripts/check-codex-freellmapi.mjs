#!/usr/bin/env node
/**
 * Read-only Codex CLI gateway compatibility smoke test.
 * Uses ONLY an environment variable with the unified FreeLLMAPI key.
 * Issues one tiny synthetic inference request; never logs responses or secrets.
 */
const BASE_URL = process.env.SVOI_FREELLMAPI_BASE_URL
  || 'https://freellmapi-production-3129.up.railway.app/v1';
const KEY = process.env.SVOI_FREELLMAPI_UNIFIED_KEY?.trim();
const MODEL = 'auto';

function fail(message, exitCode = 1) {
  console.error('FAIL: ' + message);
  process.exitCode = exitCode;
}

if (!KEY) {
  fail('Не задан SVOI_FREELLMAPI_UNIFIED_KEY (единый ключ FreeLLMAPI, не Gemini/Groq).', 2);
} else {
  try {
    const base = new URL(BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/');
    if (base.protocol !== 'https:' || !base.pathname.endsWith('/v1/')) {
      throw new Error('URL должен быть HTTPS и оканчиваться /v1');
    }
    const headers = { Authorization: 'Bearer ' + KEY };
    const modelResponse = await fetch(new URL('models?available=true', base), {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!modelResponse.ok) {
      fail('GET /v1/models: HTTP ' + modelResponse.status + '; 401 = неверный единый API-ключ.');
    } else {
      const catalog = await modelResponse.json();
      if (!Array.isArray(catalog.data)) {
        fail('GET /v1/models: неожиданный формат JSON.');
      } else {
        console.log('PASS: список моделей получен (' + catalog.data.length + ' записей).');
        const autoAvailable = catalog.data.some((x) => x.id === MODEL);
        if (!autoAvailable) console.warn('WARN: auto отсутствует в каталоге; маршрутизатор может быть настроен иначе.');
        const started = performance.now();
        const inference = await fetch(new URL('responses', base), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            model: MODEL,
            input: 'Ответь одним словом: ТЕСТ. Это синтетическая проверка API.',
            stream: true,
            max_output_tokens: 128,
          }),
          signal: AbortSignal.timeout(90000),
        });
        if (!inference.ok) {
          fail('POST /v1/responses: HTTP ' + inference.status +
            ' (401=ключ, 404=путь, 429=квота, 503=перегрузка).');
        } else {
          const contentType = inference.headers.get('content-type') || '';
          const sse = await inference.text();
          const completed = /event:\s*response\.completed|"type"\s*:\s*"response\.completed"/.test(sse);
          const failed = /event:\s*response\.failed|"type"\s*:\s*"response\.failed"/.test(sse);
          if (!contentType.includes('text/event-stream') || !completed || failed) {
            fail('POST /v1/responses: статус 200, но корректное событие SSE response.completed не подтверждено.');
          } else {
            console.log('PASS: Responses SSE завершён (' + Math.round(performance.now() - started) + ' мс).');
            console.log('NEXT: проверить настоящую сессию Codex, tool calls и восстановление контекста.');
          }
        }
      }
    }
  } catch (error) {
    const code = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'abort' : 'network/configuration';
    fail('Не удалось выполнить тест (' + code + '). Проверь адрес, сертификат, сеть и доступность сервера.');
  }
}
