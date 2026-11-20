---
name: lean-testing
description: Lean tests. Use when deciding whether a feature or regression warrants a test, or reviewing proposed cases.
---

# Lean tests

Each case costs maintenance and sets a precedent for the next feature. For a hobby project, spend that budget on failures that matter.

1. Give every proposed case one reason to exist: a distinct failure in behavior we own with a meaningful consequence. Keep cases only where the library and existing suite leave that failure uncovered. Zero new tests is a valid result.
2. Use the smallest seam that would catch the failure. Test a pure rule directly; test an integration through its real interface with fixtures at external boundaries. For each assertion, identify the observable outcome that would change if the named failure occurred.

In my.fm, test history page selection across month boundaries (`app/test/history-timeline.test.ts`). Treat a Spotify reconnect notification as a variant, not a reason for a dedicated suite; place coverage for a consequential authorization rule at the boundary that owns it.
