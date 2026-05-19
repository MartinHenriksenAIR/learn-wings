---
id: "ADR-0003"
title: "shadcn/ui + Radix UI + Tailwind CSS as UI Component System"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['frontend', 'ui', 'components', 'design-system']
policy:
  imports: {'disallow': ['@mui/material', 'antd', '@chakra-ui/react', '@mantine/core'], 'prefer': ['@radix-ui', 'tailwind-merge', 'class-variance-authority']}
  rationales: ['shadcn/ui + Radix + Tailwind is the component system; no competing UI libraries']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The platform has rich UI needs: modals, tables, tabs, tooltips, dropdowns, forms with validation. A consistent component library is needed that doesn't lock in a heavyweight dependency and allows full design control for the AI education brand.

## Decision

Use shadcn/ui (Radix UI primitives + Tailwind CSS utility classes) as the component system. Components live in src/components/ui/ and are owned by the repo (not a node_modules dependency). Don't introduce MUI, Ant Design, Chakra UI, or other component libraries alongside shadcn/ui.

## Consequences

Positive: Accessible primitives (Radix), full Tailwind theming, components are copy-owned so no upstream breaking changes. Negative: Component updates require manual re-copy from shadcn registry; no automatic version bumps.

## Alternatives

1. MUI (Material UI) — rejected: opinionated theming overhead, harder Tailwind integration. 2. Ant Design — rejected: large bundle, enterprise aesthetic mismatch. 3. Headless UI only — rejected: more boilerplate than shadcn/ui adds. 4. Custom components from scratch — rejected: accessibility primitives (Radix) are non-trivial to implement correctly.
