# @dsh-base/client-plugin-manager

Complete marked fork of pinned `@deepseek-ai/dsh-client-ui-plugin-manager`, sourced from `.submodules/deepseek-harness/packages/client/ui-plugin-manager` at commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, MIT. The full `src/`, `locale/` and license are retained. Root and `/client` exports lead only to the browser entry; the original Host registry-probe source is neither exported, loaded nor started.

Direct mounting of the official plugin was already verified. List `PackageCard` and `packageStatus` are private, and existing exported components/slots cannot separately replace list status capsules and reason rows. The official reuse protocol therefore calls for a marked fork rather than copied fragments or CSS error suppression. Original page structure, artwork, configuration, navigation, installation flows, controllers, failure handling, all CSS and official dictionaries are preserved.

## Host availability adaptation

The Host seam declares unadapted catalog entries with the explicit extension `deploymentAvailability: 'not-adapted'`, without fabricating an `error`. The actual `packageView` projection retains this field. Unknown values do not alter official status.

- Only marked, official, missing, uninstalled, disabled entries with no install target and no runtime rows receive the neutral Unavailable capsule. It uses the official `Tag tone="neutral"` with the same eight-language copy and geometry as built-in settings.
- The main list omits Not installed for these entries; without a fabricated error it emits no repetitive operating-system error sentence. Details retain true installation/source facts, and the existing `plugins.detail.section` contribution keeps readable Workers limitations.
- An explicit marker always disables the toggle. It creates no fiber, install target or management authority. Host and data seams independently reject activation.
- Genuine Host errors, metadata errors and failed runtime rows take precedence as problems. Unmarked entries retain original states, reasons and behavior. The global Problem translation and error CSS remain unchanged.

The user explicitly approved this availability presentation, recorded in `dshBase.reuse.userApprovedDeviations`. `package.json` records provenance, replacement and the fixed commit; the replaced official plugin remains disabled inventory.

## Grouped component explanation

Cloudflare AI Gateway reuses official `BundleInfo.rows` to contain two real components: the settings interface and the platform model service. The Host declares `readOnlyReason: 'unaddressable'` with `managedByBundle: 'Cloudflare AI Gateway'` for components controlled only by their bundle switch. The complete component inventory, entry ids, runtime phases and selection states still come from actual Host projections.

The marked fork only projects this explicit Host explanation into the component switch tooltip in all eight languages, such as “Managed by the Cloudflare AI Gateway switch.” Disabled logic, the official Switch, CSS and layout remain unchanged. The extension accepts a nonempty string only alongside `unaddressable`; invalid values, other refusal reasons and ordinary writable components preserve official behavior. Component management refuses independent switches; compatible legacy member writes also follow the atomic bundle switch. Display metadata grants no authority.

## Validation

`node --test packages/client/dsh-base-client-plugin-manager/tests/*.test.mjs` checks the actual Host projection, strict catalog boundary, failure precedence, eight-language consistency, grouped component explanations and whole-package source/resource drift. The drift regression permits only reviewed Host adaptations in three existing source files plus the own `availability.ts`, `bundle-management.ts`, `management-policy.ts` and `group-summary.ts`; all other official content is compared byte for byte. Pin upgrades require review.

The application plugin-manager parity runner compares rendered pinned official components, testing the approved unavailable differences separately from unchanged genuine failures.

## Complete inventory and management scope

The Host may mark a read-only entry with `managementPolicy: "required" | "deployment"`, shown as “Required by the app” or “Managed by the deployment”. The field is accepted only with `readOnlyReason: "unaddressable"`; all other entries keep official behavior. Visibility, installation, enabled selection and observed fiber state stay independent. This metadata grants no permission and never presents a required plugin as unavailable. Existing switches and disabled behavior remain; normal ownership uses the original neutral `status` class in details, while real errors retain `reason`. No CSS or layout is added. The validated ownership fields also pass through the official detail-slot subject so the Host section describes the same policy.

## Optional category summary extension

The pinned official page has no category counts for Built-in plugin settings, Experimental plugins, Installed plugins or More, and exposes no category-heading slot. Its existing component total and state summary in bundle details remains unchanged. The user explicitly requested a new DSH plugin when category counts are absent, so this fork adds only the stable type entry `/group-summary` and the single, root-scoped, inline `dsh-base.plugins.group.summary` slot.

The page supplies the exact visible card keys, real component row ids, read status and official `sectionCount` class from the same render. Settings entries come from `ledger.items`; experimental, installed and More entries come from the existing `extensions`, `mine` and `more` arrays. The adapter performs no additional filtering, requests or permission changes. Counting and localized presentation belong to the independent plugin. Without a contribution no summary is displayed; the contributor receives the original status to handle loading and failure. This narrow extension is recorded as a user-approved deviation. All official CSS, dictionaries and existing detail summaries remain byte-identical.

## Detail navigation scroll position

The pinned official page shares one scroller between lists and details, updating navigation state without resetting its offset. Real clicks using the same bundle with 13 components reproduce inherited list offsets in both the official page and this fork, leaving the back button or detail title outside the viewport. Browser scroll-range clamping on shorter details can conceal this defect.

The user requested correcting this confirmed upstream gap. An element ref and layout effect reset the existing scroller before paint only when the rendered logical page changes, covering lists, More, bundles, configuration pages and contributed tabs. Refreshes, state updates, language changes and resizing within the same page do not trigger a reset. Return navigation also starts at the top; this change adds no scroll-history policy. The container is not remounted, and official CSS, forms and global window scrolling remain unchanged. Returning to the main list synchronizes its original collapsing-header measurement with the new offset. Package metadata records the deviation and user authorization.

The dedicated `run-plugin-navigation.mjs` browser test compares the unmodified official component, opening long details with real clicks from nonzero list offsets. It never normalizes scrolling after a click and verifies that same-page updates preserve reading position.

## Owned plugin brand artwork
