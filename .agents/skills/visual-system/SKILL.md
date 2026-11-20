---
name: visual-system
description: Visual consistency. Use when styling a new surface or reviewing a mismatch in layout, typography, or component states.
---

# Visual consistency

1. Pick the closest existing screen. Identify its shell, spacing, type hierarchy, semantic color roles, and shared controls before styling the new surface.
2. Use those tokens and primitives for equivalent roles. Let the primitive own focus and disabled behavior. Keep the same hierarchy in pending and loaded states; size a row placeholder to the row it replaces.
3. Compare the result with the reference at the sizes and in the themes the change affects. For each new visual variant, identify the role that existing variants can't serve.

When choosing my.fm primitives, theme roles, or a list layout, use [my.fm visual references](MY-FM.md).
