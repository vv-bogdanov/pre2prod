# План: обязательный git и checkpointing по фазам

## Цель
Сделать запуск CLI зависимым от git-репозитория и сохранять изменения только после прохода каждой фазы.

## Этап 1. Зафиксировать контракт
1. `prepareGit` должен:
   - падать с понятной ошибкой, если директория не `git`-репозиторий;
   - требовать очистить `working tree` перед стартом (нет незакоммиченных изменений);
   - создавать ветку `pre2prod/<timestamp>` перед любым шагом пайплайна.
2. Сообщение об ошибке для отсутствующего репозитория должно содержать инструкцию: `git init`.
3. Формат коммита: `pre2prod(<slug>): <title>`, `slug` из title/id (fallback на id).

## Этап 2. Обновить `src/git.ts`
1. Удалить/перевести в fail-fast все best-effort сценарии checkpoint.
2. Ввести строгий `GitSession`:
   - `enabled: true`;
   - `branch`;
   - `commitPhase(phase)` вместо «generic checkpoint».
3. Реализовать:
   - проверку репозитория (`git rev-parse --is-inside-work-tree`);
   - fail-fast на dirty tree (`git status --porcelain`);
   - создание branch.
4. `commitPhase`:
   - `git add -A`;
   - исключить `PRE2PROD_PLAN.md` из коммита;
   - если staged нет — silently skip;
   - иначе `git commit`.

## Этап 3. Обновить пайплайн
1. В `src/pipeline.ts`:
   - коммитить только после успешного `review.blockers.length === 0`;
   - сохранять `worker` цикл и `maxIterationsPerPhase` без изменений;
   - сохранять persistent reviewer thread;
   - форкать `Worker` от reviewer turn с blockers.
2. В месте инициализации пайплайна вызывать `prepareGit` и прокидывать ветку в результат.
3. При ошибках воркера/итераций не создавать checkpoint commit.

## Этап 4. Тесты
1. `test/git.test.ts`
   - нет репозитория → ошибка + `git init` в тексте;
   - dirty tree → ошибка.
2. `test/pipeline.test.ts`
   - все тесты, запускающие pipeline, создают временный git-репозиторий с base commit;
   - успешная фаза создает ровно один commit;
   - maxIterations reached: commit не создается;
   - commit message совпадает с названием phase.
3. `test/app-server-runtime.test.ts`
   - инициализация временного репозитория;
   - проверка полного reviewer-worker-reviewer цикла с JSON-ответами review.

## Этап 5. Документы
1. Обновить README/спеки:
   - git теперь обязательный;
   - без репозитория запуск завершится ошибкой и текстом про `git init`;
   - checkpoint привязан к каждой успешно пройденной фазе.
2. В случае изменения формата outputSchema (если уже есть) синхронизировать описание и пример.

## Этап 6. Валидация и фиксация
1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`
4. `npm test`
5. По завершению — commit по этапам:
   - после `git.ts`,
   - после `pipeline.ts` + тесты pipeline,
   - после документации.
