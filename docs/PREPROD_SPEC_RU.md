# Техническое задание: Pre2prod MVP

## 1. Контекст

Много приложений сейчас создаётся через vibe coding и coding agents. Они могут уже работать функционально, но обычно не готовы к реальному staging/production:

- нестабильная установка и сборка;
- слабая типизация и конфигурация;
- недостаточные тесты;
- стихийная архитектура;
- security и failure paths почти не проверены;
- нет CI/CD и понятного deployment path;
- автор проекта не знает production-readiness workflow.

Pre2prod должен одной командой последовательно провести существующий репозиторий через экспертные ревью и автоматически устранить существенные пробелы.

```bash
npx <package>
```

Опционально пользователь может добавить свободную инструкцию:

```bash
npx <package> "Prefer Railway, preserve the monolith, avoid paid services"
```

Инструкция добавляется ко всем агентным prompts. Во время выполнения CLI не задаёт вопросов.

## 2. Цель MVP

Создать простую TypeScript CLI-утилиту, которая:

1. запускается в корне произвольного software repository;
2. самостоятельно понимает язык, framework, архитектуру и инструменты;
3. создаёт один persistent Reviewer thread;
4. Reviewer изучает проект и накапливает понимание между фазами;
5. Reviewer последовательно проверяет production-readiness фазы;
6. при `NEEDS_WORK` fork-ается одноразовый Worker;
7. Worker сначала создаёт `PRE2PROD_PLAN.md`;
8. тот же Worker следующим turn выполняет этот план;
9. исходный Reviewer самостоятельно перечитывает текущий репозиторий;
10. цикл повторяется до `PASS` либо до конечного лимита;
11. результат отображается понятным потоком в терминале.

## 3. Дистиллированная архитектура

В системе только две агентные роли.

### Reviewer

- один thread на весь run;
- в начале изучает весь проект;
- сохраняет верхнеуровневое понимание приложения;
- проходит все фазы последовательно;
- помнит решения и изменения предыдущих фаз;
- не выполняет основную реализацию;
- не видит transcript дочернего Worker;
- после изменений заново проверяет фактический репозиторий.

### Worker

- одноразовый thread;
- fork от конкретного завершённого Reviewer turn;
- получает накопленный контекст Reviewer и его findings;
- выполняет два turns:
  1. planning;
  2. execution;
- после выполнения больше не используется.

Отдельных Project Lead, Planner, Fresh Reviewer и Final Reviewer нет.

## 4. Session flow

```text
Reviewer: initial repository discovery
  ↓
for each phase:
    Reviewer: full phase review
      ├─ PASS → next phase
      └─ NEEDS_WORK
           ↓
        fork Worker from this review
           ↓
        Worker planning turn
           ↓
        Worker execution turn
           ↓
        Worker ends
           ↓
        resume original Reviewer
           ↓
        Reviewer re-reads current repository
           ↓
        full phase review again
```

Reviewer остаётся основной долговременной нитью. Worker fork-ается от review, чтобы понимать не только список замечаний, но и контекст, в котором они появились.

Worker transcript обратно в Reviewer не передаётся.

## 5. Initial discovery

Первый Reviewer turn должен понять:

- назначение приложения;
- языки, frameworks и package/build tools;
- основные entry points;
- критические пользовательские и бизнес-потоки;
- БД и внешние integrations;
- trust boundaries;
- build/test/lint/deploy commands;
- текущую архитектуру;
- repository instructions.

Не требуется отдельный project profile или discovery artifact. Понимание остаётся в Reviewer thread.

## 6. Review protocol

Для каждой фазы Reviewer получает:

- общий базовый prompt;
- prompt текущей фазы;
- пользовательскую дополнительную инструкцию;
- актуальный repository workspace.

Ответ начинается строго с:

```text
PASS
```

или:

```text
NEEDS_WORK
```

При `NEEDS_WORK` далее перечисляются только существенные findings.

Reviewer обязан:

- проверять реальные файлы и реальные результаты;
- учитывать тип и масштаб приложения;
- применять KISS и YAGNI;
- не требовать теоретического совершенства;
- после Worker заново проверять всю фазу, а не только старый список.

Reviewer не должен менять application files.

## 7. Worker planning

При `NEEDS_WORK` CLI fork-ает Worker от соответствующего Reviewer turn.

Первый Worker turn:

1. изучает findings и релевантный код;
2. составляет минимально достаточный план;
3. записывает его в корне репозитория:

```text
PRE2PROD_PLAN.md
```

4. не изменяет остальные файлы проекта.

План должен содержать:

- необходимые изменения;
- порядок выполнения;
- проверки;
- критерий завершения.

`PRE2PROD_PLAN.md` перезаписывается каждой новой Worker-итерацией. Отдельные каталоги и разные plan-файлы не нужны.

## 8. Worker execution

Следующий turn того же Worker:

> Полностью выполни `PRE2PROD_PLAN.md`. Работай автономно, запускай необходимые проверки и исправляй ошибки. Не задавай вопросов. Следуй KISS и YAGNI.

Worker сам выбирает инструменты репозитория, меняет код и конфигурацию, добавляет действительно необходимые тесты и запускает релевантные проверки.

После planning turn CLI задаёт Worker execution goal. Для этого Worker fork
должен быть non-ephemeral: goal API App Server не поддерживается ephemeral
threads. Worker остаётся одноразовым на уровне pipeline: он не продолжается и
не объединяется обратно с Reviewer.

## 9. Re-review

После Worker CLI продолжает исходный Reviewer thread:

> Worker завершил работу. Самостоятельно перечитай актуальный репозиторий и проведи полное ревью текущей фазы. Не доверяй предполагаемому результату Worker и не ограничивайся прежними findings.

Reviewer видит обновлённый workspace, но не Worker transcript.

- `PASS` → следующая фаза;
- `NEEDS_WORK` → новый Worker fork.

## 10. Лимит итераций

MVP должен иметь конечный лимит Worker-запусков на фазу.

Рекомендуемый default:

```text
2 Worker iterations per phase
```

После лимита pipeline завершается с ошибкой и сообщает фазу, которая не прошла. Никакого интерактива.

## 11. Фазы MVP

Фазы — обычный упорядоченный массив: `name + reviewerPrompt`.

Минимальный набор:

1. **Reproducibility and build**  
   Проект должен воспроизводимо устанавливаться, собираться и запускаться.

2. **Testing**  
   Должны быть достаточные тесты критического поведения, интеграций и failure paths. Не гнаться за формальным 100% coverage.

3. **Architecture and maintainability**  
   Устранить существенную связанность, дублирование и слабые границы без переписывания ради эстетики. Подготовить к разумному росту без преждевременных микросервисов и Kubernetes.

4. **Security**  
   Проверить auth, authorization, validation, secrets, dependencies, sensitive logging и релевантные web risks.

5. **Repository and CI**  
   Привести в порядок scripts, документацию и автоматические checks.

6. **Deployment readiness**  
   Подготовить к простому staging deployment.

Правила deployment:

- существующий target имеет приоритет;
- иначе выбрать простейший подходящий managed hosting;
- не вводить Kubernetes без необходимости;
- Railway может быть мягким default для backend + PostgreSQL;
- без credentials подготовить конфигурацию и инструкции, не задавая вопросов.

Позже фазы добавляются только prompts:

- performance and reliability;
- observability;
- accessibility;
- legal and privacy;
- payments;
- AI safety;
- localization.

Orchestration engine не меняется.

## 12. Автономность

CLI не задаёт вопросов.

При неопределённости агенты выбирают:

1. существующие conventions;
2. минимально достаточное изменение;
3. простой managed вариант;
4. отсутствие новых services и dependencies без необходимости;
5. сохранение текущей архитектуры, если она жизнеспособна;
6. документирование невыполнимого внешнего шага вместо остановки всего pipeline.

Не выполнять destructive production operations и не использовать production secrets.

## 13. Базовый prompt

```text
You are preparing the current repository for real staging and future production use.

Work autonomously. Do not ask the user questions.

Infer languages, frameworks, architecture, commands, and appropriate tools
from the repository itself.

Follow KISS and YAGNI:
- preserve working behavior;
- prefer existing tools and conventions;
- make the minimum sufficient change;
- avoid speculative abstractions;
- avoid unnecessary dependencies and infrastructure;
- do not rewrite the project for architectural aesthetics.

Aim for necessary and sufficient quality for the application's actual type
and scale, not theoretical perfection.

Inspect real files and real command results.
Never claim success based only on reasoning.

Do not perform destructive production operations.
Do not use or expose production secrets.
If external credentials are unavailable, prepare everything possible locally,
document the remaining external action, and continue.
```

Reviewer дополнительно:

```text
Maintain a high-level understanding of the project across phases.
Review the actual current repository independently.
Do not trust claims from workers.
Fail a phase only for material readiness gaps.
After changes, review the entire phase again.
```

Worker дополнительно:

```text
First write the complete minimal plan to PRE2PROD_PLAN.md.
Then, in the next turn, execute that plan fully.
Use the repository's actual language and tools.
Do not ask questions.
```

## 14. CLI и Codex integration

### Stack

- TypeScript;
- Node.js;
- Commander.js или другой небольшой зрелый CLI parser;
- Codex App Server over stdio;
- без web UI;
- без MCP;
- без базы данных;
- без workflow framework;
- без параллельных writers.

### Runtime operations

Нужны только:

- запустить App Server;
- initialize;
- start Reviewer thread;
- run Reviewer turns;
- fork Worker from completed Reviewer turn;
- run Worker planning turn;
- run Worker execution turn;
- continue Reviewer thread;
- stream progress/errors;
- terminate cleanly.

### CLI surface

```bash
npx <package>
npx <package> "free-form instructions"
```

Также:

```bash
--help
--version
--verbose
```

Подкоманды не нужны.

## 15. Codex Skill

После рабочего CLI добавить тонкий explicit-only Codex Skill.

Skill:

- запускает тот же CLI в текущем репозитории;
- передаёт optional user instructions;
- показывает CLI output;
- не дублирует prompts и orchestration.

CLI — единственный источник истины. Plugin не нужен для MVP.

## 16. Progress output

Простой streaming output:

```text
Pre2prod

[1/6] Reproducibility and build
      Reviewing...
      NEEDS WORK · 3 material findings
      Planning → PRE2PROD_PLAN.md
      Working...
      Re-reviewing...
      PASS

[2/6] Testing
      PASS
```

TUI, React Ink и spinner framework не нужны.

Подробные события можно писать в один plain log, но лог не участвует в workflow.

## 17. Git

CLI запускается только внутри git-репозитория.

Перед стартом выполняется проверка:

- `cwd` должен быть git-репозиторием (иначе завершение с инструкцией `git init`);
- рабочее дерево должно быть clean (иначе явная ошибка).

Сейчас для запуска создаётся ветка `pre2prod/<timestamp>`, а checkpoint-коммит делается
после успешного завершения каждой фазы.

`PRE2PROD_PLAN.md` не включается в checkpoint-коммит.

## 18. Source of truth

Источник истины:

1. текущие repository files;
2. реальные command results;
3. накопленное понимание Reviewer.

Не Worker claims, не база данных и не Git history отдельно.

## 19. Минимальная обработка ошибок

Нужны только:

- App Server unavailable;
- Reviewer response cannot be classified;
- planning turn не создал `PRE2PROD_PLAN.md`;
- agent turn failed;
- maximum phase iterations reached;
- unexpected process termination.

Resume/recovery не нужны. Повторный запуск создаёт нового Reviewer и заново оценивает уже улучшенный репозиторий.

## 20. Non-goals

Не реализовывать:

- интерактивные вопросы;
- web UI;
- project/language/framework profiles;
- deployment adapters;
- отдельного Planner agent;
- Project Lead;
- Fresh Reviewer;
- Final Reviewer;
- multiple competing plans;
- state-machine framework;
- persistent database;
- artifact schemas;
- policy DSL;
- production deployment;
- formal compliance certification;
- universal guarantee of production readiness.

## 21. Acceptance criteria

MVP готов, когда:

1. запускается одной `npx`-командой;
2. Reviewer делает initial discovery;
3. Reviewer сохраняет context между фазами;
4. шесть фаз выполняются последовательно;
5. Reviewer возвращает `PASS` или `NEEDS_WORK`;
6. `NEEDS_WORK` создаёт Worker fork;
7. Worker пишет `PRE2PROD_PLAN.md`;
8. тот же Worker выполняет план следующим turn;
9. Reviewer продолжает исходный thread и re-review фактического repo;
10. Worker transcript не попадает в Reviewer;
11. итерации конечны;
12. free-form instruction распространяется на весь run;
13. pipeline полностью noninteractive;
14. запускается только в git-репозитории (иначе падение с `git init`);
15. сохраняет checkpoint после каждой успешной фазы;
16. terminal progress понятен;
17. Codex Skill запускает тот же CLI;
18. один намеренно неподготовленный demo repo существенно улучшается end-to-end;
19. критическая orchestration logic покрыта тестами.

## 22. Порядок разработки

### POC

1. Start App Server.
2. Create persistent Reviewer.
3. Initial discovery.
4. Implement one phase.
5. Parse PASS/NEEDS_WORK.
6. Fork Worker.
7. Worker writes `PRE2PROD_PLAN.md`.
8. Same Worker executes it.
9. Reviewer re-reviews.

### MVP

10. Вынести фазы в ordered list.
11. Добавить шесть фаз.
12. Добавить free-form instruction.
13. Добавить streaming output.
14. Добавить iteration limit и basic errors.

### Packaging

15. `npx` package.
16. Обязательный git-режим (чистый репозиторий + checkpoint после успеха фазы).
17. Thin Codex Skill.
18. End-to-end demo repository.

Не добавлять ничего нового до стабильного vertical path.

## 23. Итоговая формула

> Pre2prod is a reviewer-led convergence pipeline. One persistent Reviewer learns the project and evaluates each production-readiness phase. When material gaps exist, a disposable Worker is forked from that review, writes `PRE2PROD_PLAN.md`, and executes it. The Reviewer then independently re-examines the changed repository. Phases are prompts, and the CLI only orchestrates sessions.
