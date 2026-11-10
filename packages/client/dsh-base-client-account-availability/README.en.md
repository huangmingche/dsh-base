# Account billing availability seam

The complete marked `@dsh-base/client-settings-account` fork supplies the account interface; its default rendering preserves official behavior. This package reuses its exported `AccountSection` and original live account injection. Native disabled semantics and anchor navigation guards keep unavailable billing, usage, top-up and DeepSeek Platform account entries visible, dimmed and explained in eight languages. The original account menu, BetterAuth profile and sign-out keep their actual behavior.

No official source is copied and no balance is fabricated. This package supplies no billing service. The pinned source is recorded in the fork metadata and this seam uses its stable `/client` export; re-audit the component contract whenever the pin changes.

Browser validation: `node apps/web/tests/parity/run-account.mjs`. The en/zh cases compare the pinned official disabled surface, reject pointer, keyboard, auxiliary-click and context-menu navigation on every link, and verify that the unchanged launcher still completes the sign-out callback. The fixture runs the actual apply registration and binds translation from its locale, catching a missing registration locale. Controlled local fixture data is not deployed account evidence.
