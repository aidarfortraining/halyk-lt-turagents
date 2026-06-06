# PROJECT_SPEC.md

**Статус реализации:** все обязательные пункты закрыты в коде и прогнаны. Stack поднимается через `docker compose up`, e2e проверен через Playwright (форма → план → правка → accept → PDF). Evals A/B прогнан на 10 golden-примерах — отчёт в `evals/results/ab_mini_41_vs_4o.md`.

## Что строим

Веб-приложение, которое создаёт персонализированный day-by-day план путешествия в выбранный город. Пользователь задаёт: куда едет, на сколько дней, какой бюджет, какие интересы, какие пищевые ограничения. Опционально — фото места из инстаграма с вопросом "что это, стоит ли ехать?". LLM-агент собирает черновик плана, обсуждает с пользователем правки ("убери музеи", "добавь халяль"), и по принятию экспортирует PDF.

## Канонический пользовательский флоу

1. Пользователь заполняет форму: город, дни, бюджет, интересы, dietary.
2. Опционально загружает фото места.
3. Агент за 1–4 минуты собирает черновик плана (UI показывает живой прогресс по нодам графа).
4. Пользователь смотрит план и пишет правки в свободной форме.
5. Агент применяет точечные патчи к плану и показывает заново.
6. Пользователь принимает → скачивает PDF.

## Tech stack (зафиксировано)

### Backend
- Python 3.11+
- FastAPI (HTTP API + SSE для live-прогресса)
- LangGraph (оркестрация, SqliteSaver для checkpointing)
- LangSmith (трейсинг + evals)
- Qdrant + qdrant-client (векторное хранилище; локальный docker или Qdrant Cloud free tier)
- openai (нативный SDK для embeddings и raw API доступа)
- langchain-openai (LangChain-обёртка ChatOpenAI для LangGraph-нод)
- langchain-mcp-adapters (подключение MCP-серверов как LangChain tools)
- mcp (Python SDK для собственных MCP-серверов)
- Pydantic v2 (все схемы данных)
- httpx + selectolax (скрейпинг Wikivoyage)
- scikit-learn (KMeans-кластеризация мест по дням в ноде `cluster_by_day`)
- weasyprint (генерация PDF из markdown)

### Frontend
- Vite + React 19 + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query (server state)
- react-hook-form + zod (форма с валидацией)
- EventSource API (live-прогресс через SSE)

### Infrastructure
- docker-compose (один command для запуска всего стека)
- Опционально: Render для публичного деплоя

## Реализованные компоненты

| Компонент | Реализация в проекте | Где смотреть |
|---|---|---|
| LangGraph multi-step workflow с ветвлениями/циклами/HITL | 14 пользовательских нод (15 включая `__start__`), 3 ветвления, 2 цикла, 2 HITL-точки | `ARCHITECTURE.md` |
| MCP-серверы | 3 сервера, 10 tool'ов суммарно (4 + 3 + 3) | `MCP_SERVERS.md` |
| Skill | `itinerary-formatter` skill | `skill/itinerary-formatter/SKILL.md` |
| RAG: chunking + embedding + Qdrant | Wikivoyage по разделам, `text-embedding-3-small` (1536-dim), Qdrant | `ARCHITECTURE.md` → RAG |
| Скрапинг | Wikivoyage для городов | `scripts/ingest_wikivoyage.py` |
| Мультимодальность | OpenAI vision определяет landmark с фото, результат идёт в граф | `ARCHITECTURE.md` → нода `vision_identify` |
| LangSmith логирование | Все LLM-вызовы и ноды графа авто-трассируются | env: `LANGSMITH_TRACING=true` |
| Golden dataset + ≥ 2 метрики, автопрогон | 10 примеров прогнано. Метрики: `constraint_adherence` + `faithfulness` | `EVALS_PLAN.md`, `evals/results/mini-41.csv`, `evals/results/mini-4o.csv` |
| A/B эксперимент | Arm A vs Arm B (оба `gpt-5.4-nano`) на одном датасете — прогнан | `evals/results/ab_mini_41_vs_4o.md` |
| Обоснование выбора LLM | Раздел "LLM choice rationale" в этом файле + подтверждено evals (faithfulness 0.965 vs 0.507) | ниже |
| Обоснование гиперпараметров | Раздел "Hyperparameters" в этом файле | ниже |

## LLM choice rationale

**Выбор: OpenAI GPT-5.4 nano. Primary — `gpt-5.4-nano`. Secondary (только A/B-arm) — `gpt-5.4-nano`.**

Альтернативы, которые рассматривали: Anthropic Claude, Google Gemini, Qwen (Alibaba).

Критерии и обоснование выбора `gpt-5.4-nano`:

| Критерий | gpt-5.4-nano | Почему важно для проекта |
|---|---|---|
| Стоимость | ~$0.20/M input, ~$1.25/M output (на момент 2026-06) | Nano-модель → весь pipeline дешёвый. Evals × 2 arms ≈ $0.5–$2 |
| Tool-use / structured output | Очень стабильный (strict mode, JSON schema) | `parse_edit_intent` через `with_structured_output` работает без танцев с парсингом |
| Vision | Встроено (GPT-5.4 family) | Одна нода `vision_identify` обращается к той же модели, что планирует |
| LangChain интеграция | `langchain-openai` — самый зрелый wrapper во всей экосистеме | Минимум yak-shaving |
| Длинный контекст | 400k токенов (gpt-5.4) | Достаточно для stuff-context fallback при RAG-деградации |
| Качество русского | Очень хорошее | UI и план на русском, intent parsing тоже |
| Nano vs больше | nano выбран осознанно — достаточно для генерации плана из готового RAG-контекста, скорость выше | более крупная модель не нужна для этой задачи |

**Не выбрали:**
- **Anthropic Claude** — не разрешено условием задачи (ограничение пользователя).
- **Google Gemini** — изначально планировали; пользователь сменил на OpenAI явным запросом.
- **Qwen** — менее зрелая langchain-интеграция, vision отдельной моделью, лишний шаг в архитектуре.

**Роли моделей в проекте:**
- `gpt-5.4-nano` (primary, env `OPENAI_MODEL`) — везде: `generate_plan`, `vision_identify`, `parse_edit_intent` (через structured output), HITL `explain_and_ask`, `finalize_and_export`, LLM-as-judge для evals. Single-model подход — простота над оптимизацией.
- `gpt-5.4-nano` (secondary, env `OPENAI_MODEL_B`) — только как arm B в A/B-эксперименте evals.

Примечание: интересы пользователя вводятся через multiselect (фиксированный список из формы), поэтому отдельной ноды "классификация интересов" нет — она не нужна.

## Hyperparameters

| Параметр | Значение | Обоснование |
|---|---|---|
| `temperature` (план-генерация) | 0.7 | Нужна разнообразность описаний, креатив в маршрутах, но без галлюцинаций фактов (факты приходят из RAG/tools, не из модели) |
| `temperature` (intent parsing, classification) | 0.1 | Структурный вывод, минимум разброса |
| `temperature` (LLM-as-judge) | 0.0 | Воспроизводимая оценка |
| `top_p` | 0.95 | Дефолт, не трогаем |
| `max_tokens` (план) | 4096 | Подойдёт для 5-дневного плана с богатыми описаниями |
| `max_tokens` (intent parsing) | 512 | Структура правки короткая |

Эти значения — стартовые. После имплементации проверить на 5 примерах из golden dataset; если качество страдает — twiddle и записать новые значения с обоснованием в EVALS.md.

## Out of scope (v1) — не реализовывать

Эти компоненты НЕ строить, даже если есть время. Они отвлекут от обязательных пунктов:

- Authentication / user accounts (sessions хранятся анонимно)
- CI/CD pipeline (GitHub Actions — нет)
- Voice / audio-to-audio
- Semantic cache
- Mobile-приложение
- Больше 5 городов в RAG-индексе (стартовый scope: Istanbul, Barcelona, Lisbon, Tokyo, Mexico City)
- Sharing планов по ссылке
- История планов пользователя

## Stretch goals (если есть время после evals + docs + презентации)

В приоритетном порядке:
1. **Render deploy** — закроет рекомендуемый пункт спеки.
2. **Fallback на более крупную модель** при сложных запросах (nano → gpt-5.4-mini при низкой уверенности).
3. **bge-reranker** поверх RAG-результатов (~1 час, +5–10% к faithfulness).
4. **Guardrails:** PII-фильтр на входе (имена/адреса/телефоны).
5. **Расширение RAG** до 8–10 городов.
