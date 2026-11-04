# Railway: FreeLLMAPI + OmniRoute — аудит и схема включения

Дата проверки: 2026-11-04. Рабочая инфраструктура ООО «СВОИ ЛЮДИ».

## Проверенная конфигурация

**Railway-проект:** [svoi-lyudi-freellmapi](https://railway.com/project/4c76f950-61b5-4ce4-b5fa-91205c30424b)

- FreeLLMAPI (Docker `ghcr.io/tashfeenahmed/freellmapi:latest`): [панель](https://freellmapi-production-3129.up.railway.app), отдельный SQLite volume 500 MB `/app/server/data`, healthcheck `/api/ping`, состояние Online.
- OmniRoute (Docker `diegosouzapw/omniroute:3.8.50`): [панель](https://omniroute-production-c276.up.railway.app), отдельный volume 500 MB `/app/data`, healthcheck `/healthz`, состояние Online. Выбрана последняя подтверждённая доступная стабильная Docker-версия; контейнер `3.8.53` отсутствовал в реестре на момент проверки.
- Никакие ключи провайдеров или учётные данные не хранятся в GitHub. Используются только Railway Variables и Vercel encrypted secrets.
- В OmniRoute `REQUIRE_API_KEY=true`, `INITIAL_PASSWORD` задан, `AUTH_COOKIE_SECURE=true`, `ALLOW_API_KEY_REVEAL=false`, CORS ограничен рабочим доменом. Пароль доступен владельцу в Railway Variables; не передавать его через чаты/репозитории.
- OmniRoute: в первом деплое была ошибка SQLite `EACCES`; исправлено `RAILWAY_RUN_UID=0` по инструкции Railway (том монтируется root). Повторный деплой — SUCCESS, ошибки EACCES на последнем проверенном запуске отсутствуют. **Риск:** исполнение контейнера под root. В перспективе лучше образ с entrypoint, который chown и сбрасывает привилегии.
- Логи OmniRoute содержат ошибки `ARENA_ELO_SYNC` (внешний рейтинг Arena возвращает HTTP 404); это не ошибка локального API, но фоновая синхронизация неполна.
- FreeLLMAPI: Railway показал 0 ключей провайдеров, 0 HTTP-запросов на момент аудита; до добавления ключей live-failover протестировать нельзя. OmniRoute также не показал настроенных provider connections в журналах. **Не считать их inference-ready**, пока не пройдут настоящие тестовые запросы.

## Подключение к сайту без риска

В `lib/server/model-router.ts` после флага `ASSISTANT_MODEL_ROUTER=on` доступны три уровня OpenAI и два **отдельно разрешаемых** внешних шлюза. Флаг `ASSISTANT_GATEWAY_FAILOVER=on` означает FreeLLMAPI → OmniRoute (или наоборот при `ASSISTANT_GATEWAY_PRIORITY=omniroute`) только на простых запросах режима economy. Для инженерных смет остаётся прямой OpenAI. При передаче к второму шлюзу повторяются одинаковые системные инструкции, Codebase Memory, выбранный объект и доступная текущая история.

Без всех условий внешний шлюз **не используется**: HTTPS адрес /v1, отдельный gateway API key, `*_ENABLED=on` и явное `*_EXTERNAL_DATA_APPROVED=I_APPROVE_EXTERNAL_PROCESSING`. Наличие Railway-сервера и указанного Vercel URL *само по себе не даёт разрешения передавать клиентские данные*. Платный fallback отдельно контролируется `ASSISTANT_EXTERNAL_PAID_FALLBACK=on`, `FREELLMAPI_PAID_FALLBACK=on` или `OMNIROUTE_PAID_FALLBACK=on`; без разрешения внешнее переключение не вызывает OpenAI автоматически. Сохраняются ограничения истории и запросов сайта.

В Vercel Environment Variables (секреты создавать только в UI, не в GitHub):

```env
ASSISTANT_MODEL_ROUTER=on
OMNIROUTE_BASE_URL=https://omniroute-production-c276.up.railway.app/v1
OMNIROUTE_MODEL=auto
OMNIROUTE_ENABLED=off
# OMNIROUTE_API_KEY=<значение из OmniRoute Dashboard → Endpoints>
# OMNIROUTE_EXTERNAL_DATA_APPROVED=I_APPROVE_EXTERNAL_PROCESSING
# ASSISTANT_GATEWAY_FAILOVER=on
# ASSISTANT_GATEWAY_PRIORITY=omniroute
# ASSISTANT_EXTERNAL_PAID_FALLBACK=on
```

FreeLLMAPI отдельно требует `FREELLMAPI_API_KEY` из Dashboard → Keys, ключи конкретных разрешённых провайдеров и `FREELLMAPI_ENABLED=on` / `FREELLMAPI_EXTERNAL_DATA_APPROVED=I_APPROVE_EXTERNAL_PROCESSING`. До проверки этих пунктов держать OFF.

## Проверка перед окончательной активацией

1. На Railway проверять `environment_status`, `get_logs`, дисковый объём, CPU/RAM и отказоустойчивость.
2. Добавить личные ключи поставщиков в соответствующих панелях. Проверить, что каждое соединение разрешает коммерческие запросы, передачу клиентских данных и не нарушает условия тарифов.
3. Создать gateway API key для OmniRoute, использовать `REQUIRE_API_KEY=true`, проверить что без ключа `/v1/chat/completions` возвращает 401; с ключом — успешный синтетический запрос и выбранная модель.
4. В FreeLLMAPI выполнить минимум два запроса, ограничение квоты и failover с отдельными тестовыми ключами.
5. Проверить передачу одного и того же контекста при переключении из обоих шлюзов; тесты в `tests/model-router.test.ts` покрывают логику без сетевых вызовов к моделям.
6. Проверить реальный диапазон задержек, успешность 200/429/500, биллинг, лимиты стоимости и повторное чтение SQLite после redeploy (бэкап перед перезапуском).
7. Только после этого включить Vercel flags; в случае проблем вернуть OFF. Публичный сайт в этой версии продолжает использовать прямой OpenAI, пока шлюзы не авторизованы.

**Ограничения:** бесплатные модели не гарантируют Astra Ultra или SLA. GitHub, Railway и Vercel не переключают саму модель, используемую в приложении ChatGPT, и не получают всю личную память ChatGPT. Сохранять коммерческие документы у сторонних сервисов допустимо только по согласованной политике.
