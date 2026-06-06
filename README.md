# Trip Planner

Персонализированный day-by-day планировщик путешествий: пользователь задаёт город, бюджет, интересы и dietary restrictions; LLM-агент собирает план, принимает текстовые правки, экспортирует PDF.

**Статус:** реализован и протестирован. Verified flow (через Playwright): форма → SSE-прогресс по 14 нодам графа → готовый план с реальными местами из OSM, halal-маркерами и погодой → текстовая правка → accept → PDF-экспорт. Evals прогнаны (`evals/results/ab_mini_41_vs_4o.md`).

**A/B результаты (10 примеров, исторический прогон):**

| Metric | Arm A | Arm B | Δ |
|---|---:|---:|---:|
| constraint_adherence | 0.800 | 0.800 | 0 |
| faithfulness | **0.965** | 0.507 | −0.458 |

Оба arm'а сейчас сконфигурированы на `gpt-5.4-nano` (`OPENAI_MODEL` / `OPENAI_MODEL_B`). Цифры — из исторического A/B-прогона; Arm A держит faithfulness-target 0.965, что обосновывает выбор `gpt-5.4-nano` как primary (жёсткое правило «места — только из tool-output», см. CLAUDE.md → Hallucinated places).

## Документация для разработки

Перед началом работы — прочитать в этом порядке:

1. [`CLAUDE.md`](./CLAUDE.md) — корневые инструкции для Claude Code
2. [`docs/PROJECT_SPEC.md`](./docs/PROJECT_SPEC.md) — что строим, требования, tech stack
3. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — система, LangGraph, структура репо
4. [`docs/MCP_SERVERS.md`](./docs/MCP_SERVERS.md) — спеки трёх MCP-серверов
5. [`docs/EVALS_PLAN.md`](./docs/EVALS_PLAN.md) — golden dataset, метрики, A/B
6. [`skill/itinerary-formatter/SKILL.md`](./skill/itinerary-formatter/SKILL.md) — Skill проекта

## Quick start

```bash
# 1. Заполнить .env (минимум: OPENAI_API_KEY, LANGSMITH_API_KEY)
cp .env.example .env

# 2. Sanity-check
python scripts/verify_setup.py

# 3. Один раз: наполнить RAG-индекс (Wikivoyage → chunking → text-embedding-3-small → Qdrant).
#    Города через пробел, multi-word — в кавычках.
docker compose run --rm backend python scripts/ingest_wikivoyage.py \
  --cities Istanbul Barcelona Lisbon Tokyo "Mexico City"

# 4. Запуск всего стека одной командой
docker compose up
#    → Frontend: http://localhost:5173
#    → Backend API: http://localhost:8000
#    → Qdrant dashboard: http://localhost:6333/dashboard

# Локальная разработка (без docker)
cd backend && uv run uvicorn src.main:app --reload    # backend
cd frontend && npm install && npm run dev             # frontend (отдельный терминал)
```

## Тесты и evals

```bash
# Offline unit tests (не требуют сети)
pytest backend/tests/                                  # граф smoke + RAG chunking + patch_plan
pytest mcp_servers/trip-utilities/tests/               # dietary heuristics + cost estimation

# Network-зависимые тесты (Overpass, Open-Meteo)
SKIP_NETWORK_TESTS=0 pytest mcp_servers/travel-tools/tests/

# Evals A/B: gpt-5.4-nano vs gpt-5.4-nano.
# pandas требуется только для CSV-экспорта; в backend-образе ставится `pip install pandas`.
docker exec halyk-lt-turagents-backend-1 pip install pandas    # one-time, если ещё не стоит
python evals/upload_dataset.py                                  # one-time upload в LangSmith
EVAL_MODE=true OPENAI_MODEL=gpt-5.4-nano python evals/run.py --experiment-prefix mini-41
EVAL_MODE=true OPENAI_MODEL=gpt-5.4-nano  python evals/run.py --experiment-prefix mini-4o
python evals/compare_experiments.py --a mini-41 --b mini-4o
```

## Tech stack

- **Backend:** Python 3.11+, FastAPI, LangGraph, LangSmith, Qdrant
- **Frontend:** Vite + React 19 + TypeScript + Tailwind + shadcn/ui
- **UI-тема:** цветовая гамма Halyk — primary green `#00B14F` (токены `halyk`/`halyk-dark`/`halyk-light` в `frontend/tailwind.config.js`), фон `#EEF1F4`
- **LLM:** OpenAI `gpt-5.4-nano` (primary `OPENAI_MODEL` + A/B-arm `OPENAI_MODEL_B`)
- **MCP:** 3 свои servers (travel-tools, city-knowledge, trip-utilities)
- **RAG:** Wikivoyage → chunking by section → `text-embedding-3-small` (1536-dim) → Qdrant

## Структура

```
trip-planner/
├── backend/       # FastAPI + LangGraph
├── frontend/      # React
├── mcp_servers/   # 3 свои MCP servers
├── skill/         # Skill для форматирования плана
├── scripts/       # Ingestion и утилиты
├── evals/         # Golden dataset + A/B
└── docs/          # Архитектура, план, спеки
```

## Troubleshooting

- **Пустой `OPENAI_BASE_URL=` в `.env`** — openai SDK падает с `httpx.UnsupportedProtocol`. Либо удалите строку, либо закомментируйте. Только укажите значение, если используете Azure/прокси.
- **Hang на экране "Прогресс"** — должно быть исправлено. Признаки: события не доходят до frontend. Причины: либо browser-fragment в URL EventSource (исправлено отдельным параметром `streamKey`), либо nginx buffering (исправлено заголовком `X-Accel-Buffering: no`). Frontend имеет polling-fallback /state каждые 3с.
- **Сброс сессии при клике на ссылку в плане / «назад»** — исправлено. Ссылки в плане (OSM/Wikivoyage) открываются в новой вкладке (`target=_blank`), а `session_id` персистится в localStorage (`tp_session_id`) и восстанавливается при загрузке через `/state` — клик по ссылке или browser-«назад» больше не теряет план. Сессии in-memory: после рестарта backend они пропадают (восстановление ловит 404 → создаётся новая).
- **«Скачать PDF» не качается** — исправлено. Кнопка делает `fetch → blob → download` (`downloadPdf` в `frontend/src/api/client.ts`) с именем `trip-xxxxxxxx.pdf` вместо `<a target=_blank>`; ошибки (409 «план не готов» / 404 «сессия пропала») показываются под кнопкой. Endpoint `/sessions/{id}/pdf` отдаёт `Content-Disposition: attachment` (weasyprint).
- **Правки фронта не видны после `docker compose restart`** — frontend это build-time static (nginx), исходники НЕ смонтированы как volume (в отличие от backend). После изменений во `frontend/` нужен `docker compose up -d --build frontend`.
- **Qdrant `Api key is used with an insecure connection`** — warning, не блокер. Возникает если `QDRANT_API_KEY` непустой а `QDRANT_URL` на http. Локально безопасно игнорировать.
- **Qdrant `client vX incompatible with server v1.11`** — устранено: `qdrant-client` запинен на `>=1.11.0,<1.12.0` (backend + city-knowledge) под server-образ `qdrant/qdrant:v1.11.0` — совпадение major.minor. Если поднимаете server-образ — синхронно поднимите и пин клиента.
- **Overpass 504 / `get_weather_forecast` 502** — внешние API нестабильны. `travel-tools._overpass_query` крутит 5 попыток через 3 зеркала с backoff. Open-Meteo 502 — единичные, граф продолжает без weather для конкретного примера.
- **Evals: `'CostBreakdown' object has no attribute 'get'`** — `evals/run.py` дампит `plan_cost_breakdown` через `model_dump()` (исправлено). Если падает с этой ошибкой — pull свежий main.
- **Evals: `RuntimeError: no current event loop in thread 'ThreadPoolExecutor-1_0'`** — async-judge передан в sync `evaluate()`. В `evals/judges/__init__.py` sync-обёртки через `asyncio.run()` (исправлено).
- **Evals A/B compare: `Project mini-41 not found`** — LangSmith добавляет суффикс (`mini-41-8980574a`). `compare_experiments._resolve_project` ищет проект по `startswith(prefix)` (исправлено).
