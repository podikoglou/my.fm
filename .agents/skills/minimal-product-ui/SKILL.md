---
name: minimal-product-ui
description: Use when scoping or reviewing a feature, screen, control, status, or interface message in an existing product. Solve the user's task with as little new UI as possible, using patterns they already know.
---

# Minimal product UI

**Why:** Every new piece of UI has a high cost. Each button, panel, and pattern takes attention and has to stay consistent as the product changes. The more UI we add, the easier it is for the experience to become incoherent. Aim for elegance through fewer, clearer controls, not more polish on more UI.

## Rules

1. Translate a long list of proposed buttons, screens, and messages into a list of user needs. Merge proposals that solve the same need. Start with the screen, section, or action where someone would already expect to do the work.
2. Find the minimum viable addition that covers every need. Reuse one clear control or surface for related needs where it fits. For each element that survives, name the need that would go unmet without it. If you can't, remove it; if combining elements makes the action ambiguous, keep the smallest clear alternative.
3. Preserve the screen's purpose. Put a secondary action next to the content or decision it affects. Add a page, modal, or navigation item only when the existing surface can't carry the task clearly.
4. Reuse the host surface's treatment for empty, pending, error, and success states where it fits. Keep “no results,” “not loaded yet,” and “couldn't load” distinct. Don't add controls to a state that has no useful action.
5. Prefer a short, literal label and one sentence of help only when it changes what the user should do or expect **(inferred — confirm)**. State what actually happened; don't call a queued job finished. Give a recovery step when one is known, and don't guess the cause of an error.

## my.fm examples

| Do | Don't |
| --- | --- |
| Cover file selection, submission, and progress in one listening-history section in Settings. The input, Import button, and status stay together (`app/app/routes/app/settings.tsx`). | Turn each need into its own surface: an Import tab to find it, a modal to submit it, and a separate progress page. |
| Say “File accepted. Ingestion will process in the background.” after upload acceptance, then show the processing status in place (`settings.tsx`). | Say “Import complete” while the file is only queued, or create a separate screen just to show the status. |
| Follow the existing distinction between “No scrobbles yet.” and the reusable error card (`app/app/components/user-track-list.tsx`, `scrobbles-error.tsx`). | Present a failed request as empty history, or add an empty-state CTA with nowhere useful to go. |

## Pre-PR checklist

- [ ] The smallest clear design still covers every user need.
- [ ] I can name the existing patterns I reused and the unmet need that justifies each new element.
- [ ] Applicable states are distinct, and each message tells the truth about what's happening.
