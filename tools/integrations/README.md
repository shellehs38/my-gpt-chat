# Компоненты с GitHub: установка в безопасной тестовой среде

**Состояние на 16.11.2026:** подключение всех 13 систем как сервисов **не выполнено**. Этот PR подготавливает реальную установку и автоматическую проверку пяти независимых инструментов без изменения приложения в Production. Статус каждого кандидата — в [catalog.json](catalog.json). Не объявлять инструмент «подключённым» до успешного сквозного теста.

## Что установит GitHub Actions

При создании PR / ручном запуске [integrations-smoke.yml](../../.github/workflows/integrations-smoke.yml) в одноразовых, **отдельных** окружениях CI будут установлены и проверены:

- Playwright `@playwright/test@1.65.1` и Chromium; три read-only теста локального Next.js (основная страница, фасадный калькулятор, публичный статус памяти).
- MarkItDown `markitdown[docx,xlsx,pdf]==0.1.9`; обработка синтетического текстового файла.
- Docling `docling==2.150.1`; проверка установленного пакета, без скачивания тяжёлых моделей и реальных документов.
- Mem0 `mem0ai==2.2.1`; проверка установленного пакета, **не** реальной долговременной памяти.
- Browser Use `browser-use==1.0.6`; проверка установленного пакета, **не** браузерных действий с личными кабинетами.

Это **установка в временных GitHub Actions runner**, не на iPhone, в ChatGPT Work, в Railway или Production Vercel. После завершения CI временные пакеты удаляются вместе с runner.

## Локальная установка для Codex CLI / рабочего компьютера

Требуются Node.js 22+, Python 3.12, а также браузеры и Docker только для соответствующих компонентов.

```sh
# Playwright: отдельный пакет, не меняет корневой package-lock
cd tools/integrations/playwright
npm install --ignore-scripts
npx playwright install chromium
# По умолчанию тестирует локальный Next.js на http://127.0.0.1:3000
npm test

# Из корня репозитория: выбирай ОДНО Python-окружение на инструмент
python3 -m venv .local/venv-markitdown
.local/venv-markitdown/bin/python -m pip install -r tools/integrations/python/requirements-markitdown.txt
.local/venv-markitdown/bin/python tools/integrations/python/extract.py ./synthetic-example.txt --backend markitdown
```

Для Docling, Mem0 и Browser Use создаются **отдельные venv** по соответствующему requirements-файлу. Не устанавливать все библиотеки в окружение Next.js: Python-пакеты с тяжёлыми транзитивными зависимостями способны конфликтовать и потреблять много памяти.

## Семь тяжёлых серверов: не запускать бесконтрольно

| Платформа | Официальное развертывание | Обязательные зависимости и разрешения |
| --- | --- | --- |
| [n8n](https://github.com/n8n-io/n8n) | [Docker](https://docs.n8n.io/hosting/installation/docker/) | Encryption key, HTTPS, база/бэкап, согласование лицензии |
| [Activepieces](https://github.com/activepieces/activepieces) | [Docker](https://www.activepieces.com/docs/install/options/docker) | Переменные окружения, хранилище, секреты |
| [Dify](https://github.com/langgenius/dify) | [Self-hosting](https://docs.dify.ai/getting-started/install-self-hosted) | Несколько контейнеров, база и сервисы |
| [LiteLLM](https://github.com/BerriAI/litellm) | [Proxy](https://docs.litellm.ai/docs/proxy/quick_start) | LLM secrets, маршруты и стоимость |
| [Twenty](https://github.com/twentyhq/twenty) | [Self-host](https://docs.twenty.com/developers/self-host/self-host) | PostgreSQL, Redis, миграции |
| [ERPNext](https://github.com/frappe/erpnext) | [Frappe Docker](https://github.com/frappe/frappe_docker) | Несколько сервисов, бухгалтерская модель, права |
| [MCP reference servers](https://github.com/modelcontextprotocol/servers) | [Выборочно из каталога](https://github.com/modelcontextprotocol/servers#reference-servers) | Нужен конкретный сервер и область доступа |

Superpowers уже установлен как приложение ChatGPT; независимая установка навыков для облачного Codex требует отдельной проверки рабочего окружения. Дублировать правила [AGENTS.md](../../AGENTS.md) нельзя.

**Примечание:** в обзоре 13 кандидатов Browser Use, Playwright, MarkItDown, Docling и Mem0 — программные библиотеки/фреймворки, а не сервисы. Dify/LiteLLM/ERPNext/Twenty/Activepieces/n8n — самостоятельные платформы. `modelcontextprotocol/servers` — набор примеров; не запускать все reference-серверы с широким доступом.

## Безопасность и критерий готовности

1. Только синтетические данные. Внешним моделям не передавать клиентов/сметы/телефоны/пароли.
2. Каждый сервер разворачивать отдельно после проверки лицензии, стоимости RAM/CPU/хранилища, бэкапа, прав и секретов.
3. При установке от CI требовать зелёный check; без зелёного check считать только подготовленным.
4. Следующий шаг — рабочий прототип интеграции с нашим Telegram-помощником/сметами на Preview, затем отдельное решение о Production.
5. До подтверждения бюджетов и согласия **никаких новых Railway сервисов или платных API**.
