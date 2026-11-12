# Code style

How this repository wants TypeScript written. The lint enforces the rules; this
file holds the intent behind them, because a rule name says what is banned and
not what to do instead.

## Decode at the boundary

An external value — a request, a Spotify response, an environment variable, a
row from storage — arrives with no type. Decode it once, where it enters the
application, into a named domain type. After that point a function may trust its
inputs.

That is the whole idea, and most rules follow from it: no `unknown` in a
contract, no `typeof` narrowing, no broad `object` parameter, no dictionary
whose value is `unknown`, no widening followed by an assertion. Each of those is
a missing parse and not a missing signature. Parse where the value enters: at
the route, at the ingestion adapter and at the stack configuration.

A type assertion still needs a nearby `SAFETY:` comment that says why the value
is already the target type. No chained assertions. If you cannot write the
comment, the parse above is missing.

## Factories, not module state

A D1 binding belongs to one request's environment, so a database client cannot
be a module singleton. Every factory that touches the environment builds its
object per call; a module-level binding leaks between requests.

## Effect

Only the Alchemy stack and its worker-side resource declarations. Acquire a
service with `yield*` and branch with `Match`. Do not introduce Effect to solve
a local problem.

## Naming

No symbol name contains `shape`, in any letter case. It describes a value by its
structure, which the type already holds.

## Comments

A comment is read by someone who arrives months later and cannot open the
conversation that produced it. Write for that reader, or do not write.

Never write a comment about the task in progress ("added for the failing test",
"remove this later"), a narration of the diff, a restatement of the line below,
or a name such as a test, ticket or branch that will be dead within weeks.

Write one for a constraint that the code cannot show, for why an apparent
mistake is correct, or for a consequence that the caller cannot see. Present
tense, about the code in front of the reader: "Spotify caps the page at 50" is a
fact, "I set this to 50 after testing" is a diary entry. No signatures and no
dates. If it needs a paragraph, the code needs a better name.

## When the lint fires

The lint exists to make the codebase better, not to be satisfied. One error is a
fix: read the message.

The same rule firing more than once in a function or a file is a design problem
and not a series of fixes. Stop and move the parse up to the boundary, split the
function, or pass the owner's type instead of an anonymous object. A rule you
cannot satisfy without contorting the code is telling you that an interface is
wrong. These rules are shaped so that the wrong design fails the build, so a
pile of errors in one place is a signal about architecture.

Silencing is not a fix. The anti-slop rules are vendored with no local
deviations, so neither an ignore comment nor a rule edit exists. A rule that
truly does not fit is a conversation.
