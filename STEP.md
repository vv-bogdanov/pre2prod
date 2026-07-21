# План миграции Reviewer на структурный JSON

## Цель
Перевести результаты `Reviewer` с текстовых статусов на строго валидируемую JSON-структуру, сохранив текущий Reviewer/Worker процесс без изменений его семантики.

## Этап 1. Контракт
1. Обновить `src/core/types.ts`:
   - удалить `ReviewStatus`;
   - оставить `ReviewResult = { blockers: string[]; non_blockers: string[] }`.
2. Обновить `src/reviewer.ts`:
   - экспортировать `REVIEW_RESULT_SCHEMA`:
   ```ts
   type: "object",
   properties: {
     blockers: { type: "array", items: { type: "string" } },
     non_blockers: { type: "array", items: { type: "string" } },
   },
   required: ["blockers", "non_blockers"],
   additionalProperties: false
   ```
3. Проверить и выровнять экспорт в `src/index.ts` (новые публичные сущности, без лишнего).

## Этап 2. Валидация Reviewer результата
1. Переписать `parseReviewResult` на строгий путь:
   - `JSON.parse`
   - валидация по схеме
   - нормализация строк
2. Удалить старую логику:
   - parsing текстовых статусов,
   - regex status,
   - fallback на старый контракт и совместимость.
3. Любой malformed/неподходящий JSON — это явная ошибка пайплайна.

## Этап 3. Промпты и оркестратор
1. `src/prompts.ts`:
   - в конец review prompt добавить точный postfix:
   `Put only material findings that justify another change cycle in blockers; put optional improvements in non_blockers.`
   - убрать инструкции с `PASS` / `NEEDS_WORK`.
2. `src/pipeline.ts`:
   - pass `outputSchema: REVIEW_RESULT_SCHEMA` во все reviewer `turn/start`;
   - не передавать `outputSchema` в worker turns;
   - считать фазу пройденной при `review.blockers.length === 0`;
   - запускать Worker только при непустых `blockers`;
   - в `workerPlanningPrompt/workerExecutionPrompt` передавать только `blockers`;
   - не терять для Reviewer persistent thread и fork именно от turn reviewer с blockers;
   - сохранить лимит `maxIterationsPerPhase`.

## Этап 4. Тесты и фикстуры
1. `test/reviewer.test.ts`:
   - валидный разбор `blockers`/`non_blockers`;
   - ошибки для malformed/неполной/лишней структуры.
2. `test/pipeline.test.ts`:
   - pass по пустым blockers;
   - non_blockers не вызывают Worker;
   - blockers вызывают Worker;
   - Worker получает только blockers;
   - reviewer turns с `outputSchema`, worker turns без;
   - malformed reviewer output => explicit throw;
   - persistent reviewer и exact-turn fork сохранены;
   - возможный pass после Worker цикла;
   - лимит итераций останавливает фазу.
3. Обновить `test/app-server-runtime.test.ts` и `test/fixtures/mock-app-server.mjs` на новый формат.

## Этап 5. Проверка
1. Запустить подряд:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
2. Критерий готовности: все проверки зелёные, логика оставлена строго в рамках миграции.
