<p align="center"><img src="../public/brand/logo-sl-approved-light.png" alt="СВОИ ЛЮДИ" width="180"></p>

# Проверка Codex и интеграций — 19.11.2026

Внутренний технический отчёт. Проверены реальные ответы текущей Cloud-среды; это снимок состояния, а не мониторинг. База: `a4c24244495054b9cb4b4247703d8a2acf68fb18`. Новая ветка `audit/integrations-codex-20261119`. Production и данные не менялись; PR не сливался.

## 1. Что подключено и проверено

| Узел | Подтверждение | Граница проверки |
| --- | --- | --- |
| Superpowers в локальном Codex | Штатно установлен `superpowers@superpowers-dev` 7.0.2; CLI показывает installed/enabled; реальный app-server `skills/list` обнаружил все 9 обязательных навыков | Только эта среда. Не означает установку на iPhone, другом компьютере или в каждом новом сеансе |
| Composio текущего сеанса | GitHub прочитал AGENTS.md exact SHA; Google Drive account metadata, Gmail profile, Google Calendar list дали успешные ответы | Hosted инструменты доступны этому агенту; отдельный локальный Composio CLI отсутствует и отдельно не авторизован |
| Google Sheets через Composio | Соединение ACTIVE, но поиск таблиц завершился Google HTTP 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | Ни metadata Sheets API, ни чтение/запись ячеек этой проверкой не подтверждены |
| Codebase Memory | Локально установлен проверенный 0.12.1, реальный MCP JSON-RPC и 17 инструментов, индекс/ADR/поиск/охват проверены | Полнота статического анализа не гарантируется; есть 5 частично разобранных файлов. Публичный снимок сайта — отдельный контур |
| Graphify | Оба подключения ответили, поиск символа и статистика графа успешны | Оба используют один индекс `8e285fc…` от 12.11; он отстаёт от main на 2 коммита. Автоматическое обновление не запускалось |
| Railway | 4 сервиса Online/SUCCESS, по 1/1 реплике; нет issues/failed deployments в окне ответа health API | Это состояние контейнеров, не пользовательский E2E |
| FreeLLMAPI / OmniRoute | Health HTTP 200; `/v1/models` без ключа возвращает HTTP 401 | Проверка авторизации ключом, генерация, fallback, стоимость и Responses API не выполнялись |
| Supabase | ACTIVE_HEALTHY; read-only catalog SELECT успешен: 9 public-таблиц с RLS | Policies отсутствуют; клиентский доступ и сохранение помощником не доказаны. `app/api/ledger/route.ts` использует GoogleSheetsLedger |
| Telegram-помощник | Railway deployment/source/bootstrap и наличие имён credential variables проверены | Значения секретов не извлекались, Bot API и доставка/ответы не тестировались; getUpdates/sendMessage не вызывались |
| Vercel | Независимый native connector подтвердил доступ к команде и обоим проектам | Composio для этого scope получил 403; его запросы не повторялись. Публикация не выполнялась |

Очищенные машинные результаты: [evidence.json](integration-audits/20261119/evidence.json). Полный перечень проверок открытых PR: [pr-checks.json](integration-audits/20261119/pr-checks.json), где retrievalSuccessful означает только успешное получение ответа, а исход каждого check указан в conclusion. Точный обезличенный ответ Google: [google-oauth-response.json](integration-audits/20261119/google-oauth-response.json).

Независимое [review](integration-audits/20261119/review.md) проверило весь diff и runtime artifacts: Critical/Important/открытых Minor нет. Ревью выполнено на локальных commits, перечисленных в нём; публикация создаёт отдельный commit. Состав опубликованных файлов дополнительно сверяется по Git tree SHA, CI проверяется уже на финальном head PR. Это не разрешение на merge.

### Superpowers: проверка реального подключения

В новой среде до начала установки `codex plugin list --json` не показал локальных установок; удалённый каталог ответил 451. Не менялись proxy/auth и настройки доступа к этому каталогу. Использован штатный Git/local marketplace менеджера Codex и исходник [obra/superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7), версия manifest 7.0.2:

```sh
git clone --depth 1 https://github.com/obra/superpowers.git /workspace/superpowers-official
# В этом аудите HEAD подтверждён как 22f0b463e7a5e579904dd6211a520321035526f7.
codex plugin marketplace add /workspace/superpowers-official --json
codex plugin add superpowers@superpowers-dev --json
codex plugin list --marketplace superpowers-dev --json
```

Для воспроизведения именно этой версии фиксировать указанный commit, а не считать будущий HEAD той же версией. Marketplace `superpowers-dev` содержится в upstream `.agents/plugins/marketplace.json`; установленный plugin manifest не добавляет MCP-сервисов или hooks. Инструкции доступны в локальном plugin cache, не скопированы в приложение.

Проверка выполнялась отдельным процессом `codex app-server --stdio`: initialize → initialized → `skills/list` с `cwds` checkout и `forceReload=true`. Все девять записей имеют `enabled=true`; их SKILL.md читаются и совпадают с указанным upstream commit. Это runtime discovery, не только наличие README. Модельных вызовов для этой проверки не было.

| Навык | Применение в этой задаче |
| --- | --- |
| using-superpowers | Загружен перед технической работой; прочитан также из установленного локального пакета |
| brainstorming | Проверены существующие требования и варианты подключения; выбран существующий стек без новой архитектуры, пользователь прямо поручил самостоятельное исполнение |
| writing-plans | Составлен [проверяемый план](superpowers/plans/2026-11-19-integration-audit.md) |
| systematic-debugging | Сопоставлены одинаковые SHA, стадии и логи Vercel; воспроизведён Google OAuth отказ |
| test-driven-development | Загружен; production-код в этой ветке не менялся, поэтому новый цикл RED/GREEN для приложения не требовался |
| dispatching-parallel-agents | Независимые агенты проверили Vercel и инфраструктуру без общей записи файлов |
| requesting-code-review | Независимое review итогового diff и доказательств перед публикацией PR |
| verification-before-completion | Свежие typecheck, тесты, build, MCP и API-проверки; непроверенные пути отмечены |
| finishing-a-development-branch | Отдельная ветка и PR без слияния; рабочее пространство сохранено |

Локальная регистрация Codebase Memory выполнена после проверки, что `codex mcp list --json` был пуст: `codex mcp add codebase_memory -- node /workspace/my-gpt-chat/scripts/codebase-memory.mjs serve`. Этот launcher проверяет закреплённую контрольную сумму. В данной регистрации stdio не использует OAuth; `authStatus=unsupported` не означает ошибку сервера. Дополнительно сам Codex app-server выполнил `mcpServerStatus/list`: сервер 0.12.1 загрузился, обнаружены 17 инструментов, toolsError отсутствует. Реальный JSON-RPC запуск и запросы отдельно подтверждены `npm run memory:check`. Регистрация не делает инструменты автоматически доступными каждому клиенту ChatGPT.

## 2. Какие тесты выполнены

На дереве приложения исходного main, с документальными изменениями этой ветки:

- `npm ci` — успешно; существующий lockfile не менялся. Менеджер сообщил deprecation warnings для части зависимостей; обновление пакетов и `npm audit fix` не выполнялись.
- `npm run typecheck` — exit 0.
- `npm test` — 174 серверных теста прошли; калькуляторы: 212 всего, 210 прошли, 2 штатно skipped, failures=0.
- `python -m unittest discover -s tests -p test_memory_reader.py` — 4 теста, OK.
- `npm run build` — exit 0; это локальная сборка, не публикация Vercel.
- `npm run memory:install`, `memory:index`, `memory:check` — успешны; JSON-RPC, ADR после перезапуска и исключение env проверены. Индекс на момент основного прогона: 2897 nodes / 9697 edges.
- Поиск `modelAttemptsForRequest`, outline `lib/server/model-router.ts`, schema/index_status и coverage трёх файлов — ответы успешны, `metadata_match`; найденное сверено с исходником.
- GitHub main: [Checks](https://github.com/shellehs38/my-gpt-chat/actions/runs/44445894808), [Codebase Memory](https://github.com/shellehs38/my-gpt-chat/actions/runs/44445894770) — success для `a4c2424…`.
- Прочитаны 18 открытых PR и 3 Issues (#33, #34, #38). Check runs получены через Composio для всех 18 head SHA. У #23 и #21 в ответах есть failure наряду с другими success; #2 не имеет check runs; #1 имеет только Vercel Preview Comments. Skipped Supabase/neutral Graphify не объявляются пройденными проверками. Все ссылки сохранены в JSON.

Check runs для PR head не доказывают успешный merge с текущим main. Не повторялась работа PR #44 (Composio), #46 (Ruflo), #39 (13 инструментов) и других существующих веток.

На этапе публикации один Composio commit request получил HTTP 403 от Cloudflare на connect.composio.dev/mcp. Последующая проверка GitHub через read-only Composio подтвердила отсутствие новой ветки (No commit found). Запрос записи этим каналом не повторялся, размер/содержимое для обхода фильтра не подбирались. Отдельно авторизованный штатный GitHub connector подтвердил pull/push к нужному repository ID; предусмотрен разрешённый регламентом native fallback для сохранения результатов. Этот отказ не был ответом GitHub о правах, а точная причина срабатывания шлюза Composio не раскрыта.

## 3. Диагностика Vercel

| Факт | Основной my-gpt-chat | Второй my-gpt-chat-2qe5 |
| --- | --- | --- |
| Project | `prj_VaHv4poqy8BAJNUrE7mNutBzDR1f` | `prj_5M9H0K6MwkwKwjI53yTJsYlfMt1m` |
| SHA основной пары | `a4c24244495054b9cb4b4247703d8a2acf68fb18` | Тот же |
| Deployment | `dpl_HxKdEYMMMXwuoqw3sp9Q7SiWUBaq` | `dpl_FJXL5NDzHgTv1C1VYqMX6JFxYVqw` |
| Результат / created→terminal | ERROR / 711 ms | READY / 69284 ms |
| Ошибка / build events | BUILD_FAILED: Resource provisioning failed / 0 | Сборка завершилась; build machine 2 CPU / 8 GB |
| Дополнительная пара SHA `8636776…` | `dpl_BG8ZLP359qY84Ldr21eQmmQffmon`: ERROR / 420 ms | `dpl_DAvF3y4NWZNomSFjb9LrQdxUYKEf`: READY / 78671 ms |
| Видимые настройки | Одна команда, hobby, nextjs, Node 24.x, iad1 | То же |

При первичной диагностике сбой локализован в подготовке ресурсов Vercel до появления журнала сборки. Ресурс, блокирующий этот этап, найден при дополнительной проверке ниже.

В выборке последних 40 deployments основной имеет 20 ERROR; второй — 16 READY / 4 CANCELED. Это выборка, не полная история. Основной публичный alias `my-gpt-chat-theta.vercel.app` всё ещё направлен на deployment от 04.11, SHA `9c8dcb52…`; второй — на указанную успешную сборку main от 19.11. Назначение aliases проверено API, login/chat сайта не тестировались.

Ответы API проектов не раскрыли полные команды сборки и значения квот. В дополнительной проверке фильтр Vercel по GitHub repository ID `1413195593` вернул оба проекта. Список установок Marketplace показал Supabase Free Plan. Связь ресурса с конкретным проектом проверена отдельно, через метаданные хранилища.

В успешных логах Vercel выбрал Node 26.x из-за `engines.node >=22`, несмотря на настройку 24.x. Это отдельный риск непреднамеренного major upgrade, **не установленная причина provisioning ERROR**. package.json не изменялся.

[Vercel Status](https://www.vercel-status.com/) на момент проверки: All Systems Operational, active incidents пусты, Builds/API/Git/iad1 operational. Связь предыдущих инцидентов с данным проектом не установлена. Подготовлено [обращение в поддержку](VERCEL_SUPPORT_20261119.md), оно **не отправлено**.

### Дополнительная диагностика и восстановление

- Vercel Storage вернул `status=suspended` и `externalResourceStatus=suspended` для ресурса `supabase-coral-planet` (`store_CWHeLik7O6o0RbTP`, Supabase ref `ipjakegqcqjkejrwdcts`). Уведомление ресурса прямо сообщает, что проект приостановлен и его нужно возобновить в Supabase Dashboard.
- В метаданных Vercel ресурс привязан к одному проекту, `my-gpt-chat`, в Preview и Production. Для этой связи `deployments.required=true`. Последнее развёртывание в метаданных — `dpl_58JxTQLSeWrCkExBuujo3deyoTtp`: `BUILD_FAILED: Resource provisioning failed` за 502 мс, 0 записей в журнале сборки. Соответствующее Preview второго проекта на SHA `6f1ef0655b7adc5738cb597afbe3981d19d51af4` завершилось `READY`.
- Чтение приостановленного проекта через текущий Supabase MCP отклонено из-за прав. Доступный из MCP проект `svoi-lyudi` имеет другой ref (`okgvefugojajamtyqfxa`). Возобновление выполняется владельцем в [Supabase Dashboard](https://supabase.com/dashboard/project/ipjakegqcqjkejrwdcts) кнопкой **Resume project** на текущем тарифе Free.
- После возобновления проверить, что статус хранилища обновился в Vercel, затем повторить только Preview основного проекта. Критерии восстановления — наличие журнала сборки, статус `READY` и доступность страницы Preview. Основной публичный сайт отвечал HTTP 200 с действующего развёртывания. Новый Production и слияние PR требуют отдельного разрешения.

## 4. Причина и безопасное исправление OAuth Google Sheets

Свежий отказ относится к `drive.googleapis.com`, RPC `google.apps.drive.v3.DriveFiles.List`: инструмент Google Sheets ищет таблицы через Drive API. Этот токен не имеет разрешений, достаточных для данного вызова. Это не доказательство ошибки ячеек, отсутствия файла или неисправности сервера Sheets.

Фактический полный список выданных scopes ответ не раскрывает. Предыдущий PR #44 отдельно фиксирует 403 при Sheets metadata; повторного вызова к этим частным таблицам и получения их ID через другой коннектор не было. Успешный Google Drive account metadata запрос в собственном подключении не чинит Google Sheets connection и не использовался для обхода его ограничения.

Безопасный порядок для владельца/администратора OAuth:

1. Проверить запрашиваемые и выданные разрешения **существующего Google Sheets подключения Composio**, без извлечения токена в чат. Не менять Vercel Connect OAuth и service account действующего учёта.
2. Для чтения известных таблиц выбрать минимально достаточные scopes: `spreadsheets.readonly` либо допустимый для конкретных выданных приложению файлов `drive.file`. Для поиска метаданных Drive — `drive.metadata.readonly`, если используемый OAuth-конфиг это поддерживает. Полный `drive` автоматически не запрашивать.
3. Если нужен только доступ к известным файлам, не расширять поиск по всему Drive без необходимости. Запись потребует отдельного согласованного права `spreadsheets` или подходящего `drive.file`; добавлять её для read-only диагностики не нужно.
4. После изменения OAuth-запроса повторно авторизовать именно существующее подключение с выбранным аккаунтом. Добавление scope в настройку само не обновляет уже выданный токен. Не удалять рабочие интеграции и не создавать дубликаты.
5. Повторить минимальный metadata GET без grid data. Проверять запись только после отдельного разрешения в отдельной тестовой таблице, не в рабочем учёте.

Источники: [Drive files.list authorization](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list#authorization-scopes), [Sheets spreadsheets.get authorization](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get#authorization-scopes). Список реально выданных текущему токену scopes остаётся неизвестным.

## 5. Что устранено и что остаётся

Устранено отсутствие нативного Superpowers в текущем Codex; установлен и проверен локальный Codebase Memory, его launcher зарегистрирован для Codex CLI. Проверены существующие Composio-подключения, зафиксирована конкретная Google OAuth ошибка. Код приложения, рабочие записи, тарифы и права внешних аккаунтов не менялись.

Остаются: внутренний Vercel provisioning failure, OAuth Google Sheets и Vercel scope в Composio, устаревший Graphify индекс, отсутствие key-authorized inference/fallback/Responses API теста шлюзов, клиентских policies/E2E Supabase и E2E Telegram. Наличие имён секретов не означает валидность ключей. Runtime Telegram собирается bootstrap из защищённых переменных; само значение/собранный main не извлекались.

## 6. Что требует участия владельца

- Повторная авторизация существующего Google Sheets подключения после проверки минимальных scopes; при необходимости — исправление OAuth-конфига администратором.
- Доступ владельца к полным Vercel Build Settings/Usage и обращение в поддержку с подготовленными доказательствами. Нет доступного browser/desktop-инструмента с авторизованной Dashboard-сессией; точный внутренний provisioning trace доступен поставщику.
- Любая будущая правка Production, тарифов, ключей, выдача новых прав и слияние PR — отдельное решение владельца. Новый ключ передавать только через защищённые настройки, не через чат/репозиторий.
- Для полноценного inference/Telegram/Supabase E2E — отдельно определить безопасный тестовый контур, доступные тестовые credentials и отсутствие платного fallback. Текущий аудит не требует покупки сервиса.

Подтверждённые результаты относятся к указанным моментам времени. Этот PR не активирует новую модель ChatGPT/Codex и не переносит историю чатов в приложение.
