# Official model selection compatibility

Forked from the pinned `@deepseek-ai/dsh-client-ui-model-selection` submodule at commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; `LICENSE` preserves the original MIT notice. The official UI has no per-model unavailable state, so this fork retains the complete menu and interactions while adapting only the Host catalog's `unavailable` / `unavailableReason` fields.

Unavailable models remain visible and disabled. Pointer, Enter/Tab and final effort selection recheck the latest catalog. Shared `ModelDirectory.select` also rejects `/model`, stale and unknown choices with `session/model-unavailable` before any selection RPC. `routable` excludes unavailable models. `/model` passes localized reasons to the tracked `@dsh-base/client-commands` official popup fork as disabled rows.

`node apps/web/tests/parity/run-model-keyboard.mjs` tests en/zh Enter/Tab and shared directory rejection paths. `node apps/web/tests/parity/run-commands.mjs` compares the original official popup and verifies disabled pointer/keyboard behavior. Re-audit the fork at each upstream pin upgrade; these checks do not claim whole-application equivalence.
Reasoning effort now follows real Host capabilities. Connected DeepSeek routes support off/low/high/max with the official high default; the durable Host forwards the selection to execution. The generic unavailable gate remains only for Hosts that do not advertise the capability, including withdrawal while a menu is open. Workers itself does not prevent configurable reasoning.

`node apps/web/tests/parity/run-model-effort.mjs` compares the available official interaction and tests unavailable capabilities and withdrawal without hiding controls.

Model catalogs are cached per official SessionBinding. The session-adapter `sessionModelCatalog` Host seam reads that Session’s effective account/Session plugin selection, without guessing a global current Session. Existing provider, settings, credentials and connection events refresh retained catalogs; invalidation withdraws stale availability, failures do not fall back to the account catalog, and disposed bindings cannot publish late responses. Account settings retain the official zero-argument catalog. Visual components are unchanged.
