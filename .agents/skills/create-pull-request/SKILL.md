---
name: create-pull-request
description: Write clear, scannable pull request descriptions for engineers, without dense walls of text or unnecessary implementation detail.
---

# Creating pull requests

Write pull request descriptions for an engineer who is about to read the diff. Give them the mental model, the motivation, and the non-obvious technical decisions so the diff is easy to review.

## Principles

- **Write for a programmer, not a diff parser.** Use accurate technical terms and explain the architecture or key mechanisms, but leave file-by-file plumbing, parameter lists, and line-level details to the diff itself.
- **Avoid cognitive overload.** Keep paragraphs to 1 or 2 short sentences. Break distinct ideas into short bullets or headings instead of packing dense technical prose into a single block.
- **Choose structure to fit the PR.** Do not force a rigid template. Add headings when the change spans multiple areas, and explain the motivation when there is no linked issue covering why the change exists.
- **Describe only the pull request.** Cover what changes, why, how it behaves, how it was verified, and what is intentionally left out. Never mention chat history, earlier attempts, review rounds, or how the work was done.
- **Keep scope tight.** One semantically self-contained change per PR. If stacked, note the base PR in one line.
- **Include only sections that carry content.** A heading with nothing behind it is noise. Omit verification entirely when there is no behavior to verify, such as docs or comments.

## What to include, when it applies

- **Why**, when no linked issue explains the motivation or problem being solved.
- **What changed and key design choices**, at the level of components, boundaries, and tradeoffs rather than every helper or field.
- **What is out of scope**, if an obvious follow-up is deferred to another PR.
- **Verification**, only when the change has behavior that could break: tests, manual checks, screenshots for UI changes, and anything that could not be tested.

## Avoid

- Sections added to satisfy a template rather than to say something. Skip a heading when its content would be "nothing" or a restatement of the diff.
- Dense, multi-sentence paragraphs stuffed with backticks, file paths, types, and signatures.
- Bold-label walls of text that read like an implementation dump.
- Restating everything the reviewer can see in five seconds by reading the diff.
- Conversation-specific context that a future reader without chat history cannot follow.
