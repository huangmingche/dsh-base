# Plugin counts

Shows counts beside the Plugins page's category headings. Built-in settings count configuration entries; Experimental plugins and More count the plugins displayed in that list. Installed plugins show both bundle and component totals.

## Official reuse

The pinned `@deepseek-ai/dsh-client-ui-plugin-manager` at `dsh-v0.2.2-rc.5` (`9c2670d3bce5275e0d1610272958121af87787bb`) was reviewed first. Its detail page already summarizes component counts and states, but category headings have no counts or matching contribution slot. That private detail summary does not describe category totals.

The existing complete marked `@dsh-base/client-plugin-manager` fork only adds the optional inline `dsh-base.plugins.group.summary` slot, passing the same render's category data and the original `sectionCount` class. This plugin contributes counts through the exported `./group-summary` type contract. It copies no page or official filtering rule. The user explicitly requested this visual addition; package metadata records that approval. The official detail component summary remains unchanged.

## Data and behavior

- Reads configuration entries, bundles and component IDs already selected by the page. Adds no network request, background task or DOM inspection.
- Deduplicates bundles by identity and components by bundle plus component ID. Disabled, unavailable and read-only entries still count in their visible category.
- More overlaps the main experimental list. Categories are never added together as a unique total.
- Does not display a false `0` before loading, after an initial load failure or while unavailable. Once loaded, counts follow the displayed snapshot without asserting a new runtime state.
- Does not change installation, enablement, permissions or runtime state. Registration cleanup removes counts when the slot or plugin unmounts.
- Uses the official auxiliary font size and color. A scoped layout class matches the official detail summary's 10px logical gap, baseline alignment and normal text weight. The summary moves as a unit when space is limited, keeping headings and counts distinct; absent counts leave no gap.
- Provides accessible labels in English, Chinese, Japanese, Spanish, French, German, Russian and Portuguese.

Composition comes from `dsh.client` and `dshBase.client` metadata under `client:plugin-counts`; the application entry contains no feature code. The plugin itself is included in the complete owned inventory.

## Regression tests

```sh
node --experimental-strip-types --test packages/client/dsh-base-client-plugin-counts/tests/*.test.ts
```

Tests cover bundle/component distinctions, duplicate identities, independent categories, loading and failure states, localization, read-only rendering and registration cleanup. Browser acceptance covers actual slot registration, measured heading-to-count spacing, light/dark themes, narrow wrapping and comparison with the official page.
