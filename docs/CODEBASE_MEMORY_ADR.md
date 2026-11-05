# Версионируемая память «СВОИ ЛЮДИ»

Краткие правила индекса; подробности в документах. memory:index синхронизирует секции. Общий ADR движка ограничен 8000 символами.

## PROJECT BASELINE

ООО «СВОИ ЛЮДИ», Иркутск. Next.js 15/React 19/TypeScript/Node >=22. app/page.tsx; API auth/chat/ledger. OpenAI только серверный, API оплачивается отдельно. MAX — отдельная интеграция.

## DOMAIN RULES

lib/estimate.ts: точные деньги, неизвестное не ноль. Структурированные таблицы — источник итогов для экрана, контекста и выгрузки; устаревшие денежные итоги прозы удаляются. Текущее отрицание фасадной задачи важнее истории. Клиенты/объекты/расходы по ID, неоднозначность уточнять. Ledger: атомарные пакеты Sheets, UUID, постоянные квитанции, контрольное чтение; повторы не затирают ручные изменения. Денежный остаток не прибыль.

## ASSISTANT MODES

Режимы general/estimate/engineering/facade/business/documents раздельны; modeState изолирует вкладки, черновики и поздние ответы. Новый запрос выше старой темы. calculation=none не пересчитывает; старые снимки Drive SHA-256 не переписывать.
## ACCESS AND STORAGE

Вход владельца: HttpOnly/origin; секреты серверные. Сессия/401/возврат сохраняют черновик. Очистка удаляет локальный проект/очереди учёта и Drive, не облако; перенос JSON. Sheets — свой service account; ChatGPT Drive не авторизует сайт.
## COMPANY DOCUMENT BRANDING

Каждый клиентский документ: оригинальный утверждённый PNG в шапке + крупный полупрозрачный знак «СВОИ ЛЮДИ» на каждой странице; без PNG файл не выдавать. Проверять PDF/DOCX/XLSX/HTML и печать. /api/documents/export, lib/server/document-export.ts, lib/document-branding.ts. Полные правила: DOCUMENT_BRANDING.md, BRAND_LOGO_RULES.md.
## GOOGLE DRIVE CONNECTION STAGE

OAuth openid+drive.file, стабильный owner. DriveAutosave: неизменяемый JSON/outbox/ID; saved только после проверки папки/размера/SHA-256/чтения. Очистка удаляет локальную очередь и паузит синхронизацию, не облако. Фото /api/drawing отдельно, калькуляторы отдельно от Drive.
## DEVELOPMENT MEMORY

Codebase Memory 0.12.1: AGENTS.md, код и тесты приоритетнее графа. Проверять свежесть/охват, после правок memory:index и memory:check. Клиентов/секреты/переписку не индексировать. docs/CODEBASE_MEMORY.md.

## SHARED CHAT MEMORY

Сборочный data/codebase-memory.json: /api/mcp (get_project_memory/get_memory_status/search_codebase/get_file_outline), /api/project-memory (status/sections). Публичные правила/символы + revision/fingerprint, без клиентов, секретов, диалогов и внешней записи.
## CONSTRUCTION KNOWLEDGE

База: plugin-source/svoi-lyudi-builder/skills/construction-assistant/references. Действующие требования, проект и техкарта точного продукта обязательны; конфликт — проектировщику. Не переносить нормы/крепёж между изделиями; фото/оценка не проект/приёмка. Допущения отмечать. С 26.10.2026 надбавка к труду отменена; цену утверждает владелец.

## FACADE MATERIAL CATALOG

system-catalog.mjs и lib/server/facade-catalog.ts: системы/материалы. public/facade-calculator/: catalog.json, materials-guide.md. Сердечник один раз, неизвестный замок уточняется. Чат не вызывает движок. Правила/ограничения/обновления: docs/FACADE_CALCULATOR.md.

## HOUSE CONSTRUCTION CALCULATOR

/calculators, public/house-calculator: брус/каркас/пенобетон, 15 этапов; неизвестное пустое, запас лишь материалов. Затраты/налоги/вознаграждение/прибыль раздельно, без автодоплат; углы/обсадка один раз, каркас по спецификации. JSON/localStorage отдельно от облака. /api/drawing: сессия/origin/лимиты, проверка цифр, без сохранения изображения. 8×14 и прайсы — учебные, не КП. Фундамент: бетон м³, опалубка м², монтаж/демонтаж, аренда отдельно. Старые v1 без доплат, смена типа сбрасывает ставки/размеры. docs/HOUSE_CALCULATOR.md.
## NATIVE APPLICATION PREVIEW

native/: Flutter iOS+Win. Native bearer/chat, local history. Sync pending.

## MODEL ROUTER

lib/server/model-router.ts: по умолчанию отключён. Переключение сохраняет Codebase Memory, инструкции, 16 сообщений и объект. FreeLLMAPI требует HTTPS, ключ, согласие. ChatGPT-лимиты не меняются. См. docs/MODEL_ROUTING_FREELLMAPI.md.

## OWNER CONTEXT

ООО «СВОИ ЛЮДИ», Иркутск: приоритет фасады, также отмостки, ливнёвка, бетон, заборы. Цели: заказы, прибыль, сметы, контроль, делегирование, автоматизация. Русский; факты, работы/материалы, прямые ссылки. Не архив чатов.

## CODEX / WORK И ПРОВАЙДЕРЫ (2026-11-05)

Для Codex/Work: docs/CODEX_WORK_SHARED_CONTEXT.md и docs/AI_INTEGRATION_STATUS_20261105.md. Веса качества по выбору владельца: интеллект 58%, надёжность 32%, скорость 10% (подтвердить сохранение). FreeLLMAPI/OmniRoute не переключают нативные модели Codex и Work. Никаких секретов и изменений Production без согласования.
