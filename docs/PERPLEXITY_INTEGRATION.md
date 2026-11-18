# Perplexity — официальный MCP и подключение к ИИ-помощнику

Дата подготовки: 18.11.2026. Статус: конфигурация подготовлена; API-ключ, авторизованное соединение, вызов инструментов и интеграция Production не подтверждены.

## Назначение
Perplexity подключается как отдельный инструмент интернет-исследований: поиск производителей, прайсов, технических документов, нормативных первоисточников и проверка фактов. Это не замена нативной модели Codex Cloud или ChatGPT Work и не источник гарантированно правильных строительных расчётов.

## Официальные ресурсы
- API Portal: https://console.perplexity.ai
- API Platform: https://www.perplexity.ai/api-platform
- Официальный MCP: https://github.com/perplexityai/modelcontextprotocol
- Remote Streamable HTTP: https://api.perplexity.ai/mcp
- Codex MCP settings: https://learn.chatgpt.com/docs/extend/mcp
- ChatGPT custom MCP: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt

## Codex CLI
После создания отдельного Perplexity API key и согласования тарифа сохранить ключ только в защищённом локальном окружении PERPLEXITY_API_KEY. Добавить секцию из tools/codex/perplexity-mcp.config.toml.example в пользовательский config.toml, не менять существующие модели и провайдеры. Альтернатива после задания переменной окружения:
```bash
codex mcp add perplexity --url https://api.perplexity.ai/mcp --bearer-token-env-var PERPLEXITY_API_KEY
codex mcp list
```
Проверить реальный вызов perplexity_search на публичном вопросе. Список MCP не доказывает авторизованную работу. Для Codex Cloud/Work проверять отдельно, какие remote MCP и секреты поддерживает текущая среда. Не обещать доступ на iPhone через локальную конфигурацию.

## OmniRoute и FreeLLMAPI
OmniRoute v3.8.50 upstream документирует Perplexity API key (pplx) и Perplexity Search (pplx-search); новые версии также документируют отдельный Perplexity Agent (Responses API). Текущую совместимость проверить на фактически установленном образе. Подключение производится через Dashboard → Providers с отдельным официальным ключом; старые статические PERPLEXITY_API_KEY Railway Variables не считать рабочей настройкой OmniRoute. Не использовать web-cookie/session-token схемы. Проверить доступность актуальных API и моделей; не рассчитывать на устаревший Sonar как основной интерфейс. При необходимости обновления образа подготовить отдельно Preview, backup и rollback, без изменения Production.
FreeLLMAPI может принимать custom OpenAI-compatible endpoints, но совместимость с актуальным Perplexity API не подтверждена; не добавлять в auto до реального теста. Предпочтительно отдельная исследовательская MCP-интеграция.

## Приёмка
1. Отдельный API key с утверждённым бюджетом; API оплачивается отдельно от потребительской подписки. Не включать автоматическое пополнение без разрешения.
2. Поиск тестовой публичной информации с URL источников; зафиксировать модель/инструмент, HTTP status, длительность и стоимость без ключей и данных клиента.
3. Проверить 401/403/429 и timeouts, отсутствующий ключ, запрет передачи ПДн и закрытого кода, bounded retries.
4. Для рабочего помощника/Telegram добавить только opt-in исследовательский инструмент после подтверждения теста и отдельного согласования. Все строительные ответы сверять с первоисточниками, не выдавать результаты поиска за инженерное заключение.
5. Обновить журнал интеграций и общий контекст с реальными доказательствами; никакого переключения Production, платного API или передачи клиентских данных без отдельного разрешения.
