---
name: lean-testing
description: Use when deciding whether to add or review tests for a feature, bug fix, or refactor. Keep the suite small and protect the application behavior most worth testing.
---

# Lean testing

**Why:** Tests are expensive to own. Every case needs maintenance, and today's unnecessary tests set a precedent for testing tomorrow's features just as exhaustively. For a hobby project, buy confidence where it pays off; don't default to an enterprise-sized suite.

## Rules

1. Before writing a test, name the regression it would catch in code we own, what it would cost the user, and why another test doesn't already cover it. Prefer a small number of cases for consequential or easy-to-break logic. If the only reason is “we test every feature,” skip it.
2. Never retest what a library already tests. Test our validation rule, calculation, policy, or integration where it can go wrong, not whether Zod rejects a value of the wrong primitive type or whether a UI library renders its own component.
3. Don't add a dedicated test for every trivial screen, button, message, or notification variant. Test a distinct invariant if it matters; asserting that a specific notice exists is not by itself a reason to add a suite.
4. Use the smallest test that exercises the risky behavior. Test calculations directly and exercise real interfaces at integration boundaries. Use fixtures for external services rather than swapping application modules; assert what the requirement promises, not how the current code happens to implement it.

## my.fm examples

| Do | Don't |
| --- | --- |
| Test that `pagesBetween` returns each listening-history page once across month boundaries (`app/test/history-timeline.test.ts`). A mistake would miss pages or fetch the wrong ones. | Test the array or date library itself, or mount the whole screen to test row-to-page math. |
| Skip a dedicated test suite for the Spotify reconnect notification as a feature. If a consequential authorization rule needs coverage, test the rule at the boundary that owns it. | Follow `worker-api/test/spotify-reauth.test.ts` as a precedent for dedicated tests for every notification kind. Alex called this case unnecessary. |

## Pre-PR checklist

- [ ] Each added test would catch a meaningful regression in behavior we own.
- [ ] No added case duplicates library coverage, an existing case, or a trivial variant.
- [ ] I ran the relevant existing tests. In my.fm: `bun run test` with Vitest running under Node (see `docs/TESTING.md`).
