# EU5 input-binding backlog

This list records unbound commands observed in the Russian **Input Bindings**
screen. It is a review queue, not a request to assign or execute them.

## Unit commands observed unbound

| Russian UI label | Proposed risk | Default policy |
|---|---|---|
| Разрешить присоединение | consequential | Do not bind until unit-state verification exists. |
| Присоединить к отряду | consequential | Do not bind or execute in v1. |
| Создать новый отряд | consequential | Do not bind or execute in v1. |
| Отделить поддержку | consequential | Do not bind or execute in v1. |
| Расформировать | critical | Permanently blocked from automation. |
| Приказ о беспорядочном отступлении | critical | Permanently blocked from automation. |
| Погрузка | consequential | Do not bind or execute in v1. |
| Набор войск | consequential | Needs a dedicated confirmed workflow and post-check. |
| Выбрать цель | consequential | Needs a dedicated confirmed workflow and post-check. |

## Safe binding policy

Only read-only navigation and reversible panel movement are eligible for the
agent profile initially. A consequential command may receive a binding only
after all of the following are demonstrated on the disposable Holland test:

1. the exact in-game result is visually identifiable;
2. the command has a fresh precondition check and a single-use confirmation;
3. the expected postcondition can be observed; and
4. a pause/stop recovery procedure is documented.
