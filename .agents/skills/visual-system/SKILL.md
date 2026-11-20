---
name: visual-system
description: Use when styling or reviewing a UI change involving layout, spacing, typography, color, component variants, or loading visuals. Match the host project's visual system instead of inventing a parallel one.
---

# Visual system

**Why:** A feature should look like it belongs on the screen next door. Shared primitives and semantic tokens let the product evolve without fixing the same visual decision in every feature.

## Rules

1. Read the theme, shared primitives, and closest comparable screen before choosing values. Use the existing color roles, type hierarchy, spacing, radii, and responsive shell. Match the role rather than copying a hex value or inventing a new scale.
2. Compose an existing primitive and pick its normal variant for the job. Preserve its interaction states, including focus and disabled styles. Use an existing semantic status variant rather than picking a color independently.
3. Use alignment, spacing, and type to establish hierarchy before adding decoration **(inferred — confirm)**. Keep secondary metadata visually subordinate without making it hard to read.
4. Match existing loading treatment. Where an unloaded row will be replaced in place, keep the placeholder close to the final row's geometry **(inferred — confirm)**. Don't turn that into a rule that every pending view needs a skeleton.

## my.fm examples

| Do | Don't |
| --- | --- |
| Use roles like `bg-card`, `text-muted-foreground`, and `ring-ring` from `app/app/app.css`. The default surfaces are neutral in both palettes; the theme also defines status colors. Inter is the sans stack and Geist Mono leads the mono stack. | Hard-code a new text gray, accent, or font just for one screen, or carry my.fm's fonts and palette into another project without checking its theme. |
| Compose local `Button`, `Switch`, or `Alert` from `app/app/components/ui/`. The project config registers 9ui (`app/components.json`); the local Button and Switch wrap Base UI, with shared focus and disabled styles. | Hand-style a second button or switch with slightly different sizing and interaction states. |
| Reuse `CardLayout` for the same kind of route: edge-to-edge with safe-area padding on small screens, a centered card at `sm` and up. Track rows use `gap-3 p-2`, a `text-sm` title, and `text-xs` muted metadata; `HistoryRow` reserves space for pending rows with matching cover and text placeholders. | Put a nested card around every track, invent new page padding or breakpoints for a sibling route, or replace rows with a single spinner that changes the list layout. |

## Pre-PR checklist

- [ ] I compared the result to the closest screen and used existing primitives and semantic tokens.
- [ ] I checked the layouts and themes affected by the change, including focus and disabled states on touched controls.
- [ ] Loading, long labels, and secondary metadata fit the same hierarchy as the loaded view.
