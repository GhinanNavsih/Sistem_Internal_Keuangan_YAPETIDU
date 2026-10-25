# Domain Docs

## Layout

This is a single-context repository. `CONTEXT.md` at the repo root is the existing glossary; `docs/adr/` holds architectural decisions.

When a generic engineering skill refers to the root `GLOSSARY.md`, use `CONTEXT.md` for this repository. Maintain one authoritative glossary there rather than copying its definitions into a second file.

## Before exploring

- Read `CONTEXT.md` for the project's vocabulary and the synonyms it avoids.
- Read the ADRs in `docs/adr/` that concern the area being explored.
- If a referenced document is absent, proceed with the available project context. Create domain documentation only when a term or decision is resolved.

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, specifications, hypotheses, test names, and user-facing copy. For example, keep Perjalanan, Durasi tempuh, Durasi perjalanan, Upah Bersih, Jatah BBM, and Biaya BBM distinct.

When a new term is resolved, record its definition in `CONTEXT.md`. Keep implementation choices and their rationale in ADRs.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, identify the ADR and explain why its decision should be revisited before changing it.
