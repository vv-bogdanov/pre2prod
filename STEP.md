## План внедрения goal API в pipeline

1. ✅ Подтвердить и зафиксировать контракт

- Зафиксировать в репозитории, что с установленным `codex-cli` (`0.144.6`) доступны:
  - `thread/goal/set`
  - `thread/goal/get`
  - `thread/goal/clear`
  - `thread/goal/updated`
  - `thread/goal/cleared`
- Обновить `docs/LIVE_COMPATIBILITY_CHECKLIST.md` (пометка как подтверждено).

2. ✅ Расширить runtime интерфейс

- В `src/core/types.ts` добавить:
  - типы для goal-ответов/статусов;
  - методы `setThreadGoal`, `getThreadGoal`, `clearThreadGoal` в `AgentRuntime`.
- Поддержать поведение в терминах минимальной MVP-семантики (без новых ролей/фреймворков).

3. ✅ Реализовать goal-методы в App Server runtime

- В `src/app-server/runtime.ts` добавить:
  - `thread/goal/set`
  - `thread/goal/get`
  - `thread/goal/clear`
- Расширить обработку нотификаций:
  - корректно принимать `thread/goal/updated`
  - корректно принимать `thread/goal/cleared`
- Существующий `runTurn` и транскриптная модель не меняются.

4. ✅ Перевести orchestration на goal-first внутри той же семантики

- В `src/pipeline.ts` на этапе review/plan/execute использовать goal для явного управления шагами:
  - перед review: goal reviewer-фазы;
  - после NEEDS_WORK и перед planning: goal `"plan"` для Worker;
  - перед execution: goal `"execute"` для Worker;
  - после завершения шага/итерации/ошибки — `clearThreadGoal`.
- Не менять MVP-флоу:
  - persistent Reviewer;
  - Worker fork от review turn;
  - обязательный `PRE2PROD_PLAN.md`;
  - повторный reviewer review по сути.

5. ✅ Обновить тесты

- `test/pipeline.test.ts`:
  - добавить проверку порядка вызовов goal операций.
- `test/app-server-runtime.test.ts`:
  - покрыть базовую работу `set/get/clear`.
- `test/fixtures/mock-app-server.mjs`:
  - имитировать `thread/goal/*` и связанные нотификации.

6. ✅ Обновить документацию

- `README.md` и `docs/ARCHITECTURE.md`:
  - зафиксировать, что рабочий цикл стал goal-aware;
  - явно отметить сохранение роли `PRE2PROD_PLAN.md` как источника исполнения.

7. ✅ Финальная верификация

- Выполнено локально в этой среде:
  - `npm test`
  - `npm run typecheck`
  - `npm run codex:schemas`

- `npm run lint` не запускался для полного дерева (`generated/codex/*.ts` вне tsconfig service) — это известный существующий статус; целевой фокус на `test/typecheck/lint` по source-сегменту.
