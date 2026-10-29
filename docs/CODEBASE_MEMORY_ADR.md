# Версионируемая память «СВОИ ЛЮДИ»

Краткие правила индекса; подробности в документах. memory:index синхронизирует секции. Общий ADR движка ограничен 8000 символами.

## PROJECT BASELINE

ООО «СВОИ ЛЮДИ», Иркутск. Next.js 15/React 19/TypeScript/Node >=22. app/page.tsx; API auth/chat/ledger. OpenAI только серверный, API оплачивается отдельно. MAX — отдельная интеграция.

## DOMAIN RULES

lib/estimate.ts: точные деньги, неизвестное не ноль. Клиенты/объекты/расходы по ID, неоднозначность уточнять. Ledger: атомарные пакеты Sheets, UUID, постоянные квитанции, контрольное чтение; повторы не затирают ручные изменения. Денежный остаток не прибыль.

## ASSISTANT MODES

Режимы general/estimate/engineering/facade/business/documents независимы (assistant-modes.ts, server/chat.ts). modeState разделяет диалоги/черновики/ответы/повторы; поздний ответ — в исходную вкладку. Новый предмет важнее прошлой темы. calculation=none не пересчитывает документы; старые версии совместимы.

## ACCESS AND STORAGE

API: вход владельца, HttpOnly-сессия, проверка origin. Ключи/env не в GitHub, браузере или логах. Проекты/версии браузера переносятся JSON. Sheets использует отдельный сервисный аккаунт; подключение Drive к ChatGPT не даёт доступ сайту. Лимиты процесса локальны.

## COMPANY DOCUMENT BRANDING

Все оформленные файлы/сайты/экспорт: подлинный PNG public/brand/logo-sl-approved-light.png либо другой из трёх утверждённых вариантов. Не перерисовывать. DOCUMENT_BRANDING.md, BRAND_LOGO_RULES.md. HTML встраивает байты; знак сохраняется при печати. Схему Sheets ради оформления не сдвигать.

## GOOGLE DRIVE CONNECTION STAGE

OAuth openid+drive.file, стабильный owner. DriveAutosave: неизменяемые JSON, outbox/ID; saved после проверки папки/размера/SHA-256/чтения. Ветки до выбора; local clear — пауза, не удаление облака. Фото не интегрированы; калькуляторы отдельно от Drive.

## DEVELOPMENT MEMORY

Codebase Memory 0.12.1: AGENTS.md, код и тесты приоритетнее графа. Проверять свежесть/охват, после правок memory:index и memory:check. Клиентов/секреты/переписку не индексировать. docs/CODEBASE_MEMORY.md.

## SHARED CHAT MEMORY

Сборка: data/codebase-memory.json для чата. MCP /api/mcp: get_project_memory/get_memory_status/search_codebase/get_file_outline; GET /api/project-memory: status/sections. Только публичные правила/символы; без клиентов/env/переписки/удалённой записи. revision/fingerprint — версия. Изменения ADR публикуются сборкой.

## CONSTRUCTION KNOWLEDGE

База: plugin-source/svoi-lyudi-builder/skills/construction-assistant/references. Действующие требования, проект и техкарта точного продукта обязательны; конфликт — проектировщику. Не переносить нормы/крепёж между изделиями; фото/оценка не проект/приёмка. Допущения отмечать. С 26.10.2026 надбавка к труду отменена; цену утверждает владелец.

## FACADE MATERIAL CATALOG

system-catalog.mjs и lib/server/facade-catalog.ts: системы/материалы. public/facade-calculator/: catalog.json, materials-guide.md. Сердечник один раз, неизвестный замок уточняется. Чат не вызывает движок. Правила/ограничения/обновления: docs/FACADE_CALCULATOR.md.

## HOUSE CONSTRUCTION CALCULATOR

/calculators/ — общий вход из помощника, переключатель дом/фасад. public/house-calculator/index.html: брус/каркас/пенобетон, 15 этапов под ключ. Углы один раз; каркас по спецификации, фронтоны отдельно. Неизвестные цены/объёмы/запасы пустые; работы без запаса. Бригада/субподряд/накладные/налог/вознаграждение руководителя/прибыль ООО раздельно, без автоналога и 40%. Обсадку не задваивать. Карточки/прайсы 29.10.2026 — справка, не ведомости/КП. JSON/localStorage отдельно от Drive/Sheets; отчёт с PNG. Чат движок не вызывает. docs/HOUSE_CALCULATOR.md.

Фундамент: плита/лента, бетон в м³; опалубка по контакту в м² (обе стороны, торцы, высота отдельно). Установка/разборка раздельно; щиты по закупке и оборачиваемости, аренда/насос по КП. Старые v1 без доплат до явного обновления. Смена типа сбрасывает размеры/ставки. Сложения пересечений нет — сложное по ведомости.

## NATIVE APPLICATION PREVIEW

native/: Flutter iOS+Win. Native bearer/chat, local history. Sync pending.
