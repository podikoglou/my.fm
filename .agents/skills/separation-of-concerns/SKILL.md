---
name: separation-of-concerns
description: Separation of concerns. Use when code mixes domain rules with I/O or when deciding where feature files belong.
---

# Separation of concerns

1. Group files by domain. Keep a feature's entry points, behavior, and rules near one another in separate modules. For each changed file outside the domain, name the runtime convention or the other domains that need it there.
2. Keep entry points thin. A component, route handler, worker, or CLI command translates input, delegates to the feature, and presents the result. Trace each entry point to the code that owns its rules and effects.
3. Give each effect and piece of mutable state an owner at the edge. Keep reads, writes, and lifecycle state in the adapters or orchestration that need them. Pass facts such as the current time or state into plain modules and return decisions or next state. Check that each pure rule runs without the framework, network, or storage.

When applying these boundaries in my.fm, compare the [worker and React examples](MY-FM.md).
