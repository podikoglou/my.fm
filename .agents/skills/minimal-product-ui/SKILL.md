---
name: minimal-product-ui
description: Minimal UI. Use when scoping a feature or simplifying a screen with too many controls.
---

# Minimal UI

Treat every added element as a recurring cost: it has to stay coherent with the rest of the product.

1. Translate the request into user needs. Account for every proposed element by naming the need behind it; merge duplicate needs.
2. Map each need to an existing surface or control first. Combine related needs in one place if the action stays clear. Keep a new button, panel, or route only if removing it would leave a named need unmet.
3. Fit feedback into that surface. For every applicable state, check that the copy names what actually happened (file accepted vs. import complete) and gives a recovery step when one is known.

When adding an import or similar background task in my.fm, inspect `app/app/routes/app/settings.tsx`: file selection, submission, and progress share one Settings section.
