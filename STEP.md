## План миграции Reviewer решений на структурный JSON

### Цель
Перевести решения Reviewer с `PASS`/`NEEDS_WORK` на `ReviewResult` через `outputSchema` у `turn/start` без изменения семантики пайплайна.

### Фаза 1. Контракты и модели
- В `src/core/types.ts` заменить типы решения Reviewer:
  - `ReviewStatus` удалить,
  - `ReviewResult` сделать `{ blockers: string[]; non_blockers: string[] }`.
- В `src/reviewer.ts` ввести и экспортировать `REVIEW_RESULT_SCHEMA` как в ТЗ:
  - только `blockers` и `non_blockers`, массивы строк, `additionalProperties: false`.
- Обновить экспорт из `src/index.ts` при необходимости.
- Убрать устаревшие упоминания `status`, `PASS`, `NEEDS_WORK` из Reviewer-модулей.

### Фаза 2. Парсинг и валидация Reviewer-ответа
- В `parseReviewResult(text)`:
  - оставить только строгий JSON+валидацию по `REVIEW_RESULT_SCHEMA`,
  - explicit fail на malformed output,
  - удалить fallback, regex и совместимость со старой формой.
- Проверить, что валидация требует ровно два массива строк и ничего лишнего.

### Фаза 3. Промпт и runTurn для Reviewer/Worker
- В `src/prompts.ts` в prompt фазы Reviewer append exact postfix:
  - `Put only material findings that justify another change cycle in blockers; put optional improvements in non_blockers.`
- Удалить статусные инструкции из Reviewer prompt (`PASS`/`NEEDS_WORK`).
- В `src/pipeline.ts`:
  - Reviewer `turn/start` всегда получает `outputSchema: REVIEW_RESULT_SCHEMA`,
  - Worker turns не получают `outputSchema`.
- Критерий pass-фазы: `review.blockers.length === 0`.
- Worker запускается только при непустых `blockers`.
- В Worker pipeline передаём только `blockers` (если есть), `non_blockers` не передаём.
- Сохранить:
  - постоянный Reviewer thread,
  - fork Worker от **конкретного** reviewer turn с blockers,
  - `PRE2PROD_PLAN.md` contract,
  - текущий лимит итераций на фазу.

### Фаза 4. Тесты и фиксы совместимости
- `test/reviewer.test.ts`:
  - новые кейсы `blockers`/`non_blockers`,
  - malformed output fails explicitly.
- `test/pipeline.test.ts`:
  - пустые blockers проходят фазу,
  - non_blockers не триггерят Worker,
  - blockers триггерят Worker,
  - Worker получает blockers, но не non_blockers,
  - outputSchema есть в Reviewer turns,
  - outputSchema нет у Worker turns,
  - malformed reviewer output падает явно,
  - сохраняется persistent Reviewer и fork от exact-review turn,
  - фаза может пройти после Worker цикла,
  - лимит итераций всё ещё останавливает фазу.
- `test/app-server-runtime.test.ts`: проверка reviewer-результата с новым schema.
- `test/fixtures/mock-app-server.mjs`: обновить mock-ответы Reviewer на `blockers/non_blockers`.

### Фаза 5. Финальная валидация
- Запустить:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- После прохождения — короткий отчёт по результатам и список изменений, без расширения функциональности сверх контракта.
