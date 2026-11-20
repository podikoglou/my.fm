---
name: readable-code
description: Type safety. Use when validating external data, defining a TypeScript contract, or fixing repeated type or lint errors.
---

# Type safety

Treat TypeScript like Rust at the boundary: require evidence for the types the rest of the program trusts.

1. Parse external input once at the boundary. Prefer Zod or the host project's validator. With Zod, use `z.infer<typeof schema>` for the parsed output; pass that typed value inward. Resolve any assertion by parsing unless an existing invariant already proves the target type.
2. Give each contract one owner. Use indexed access (`User["id"]`) for a field, `Pick` or `Omit` for a projection, and `Awaited<ReturnType<typeof fetchUser>>` for an inferred async result. Derive keys with `keyof typeof` and use `satisfies` to check a value while retaining its inferred type. Changing the source must update its dependents without edits to copied declarations.

## Readability

- When the same lint rule fires repeatedly, repair the boundary or interface it exposes.
- Build request-scoped dependencies per request. Name symbols for their domain role; write comments for constraints the code can't express.

When working in my.fm, use [my.fm TypeScript references](MY-FM.md) for examples, lint guardrails, and project checks.
