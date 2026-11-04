# Feedback availability seam

The official feedback plugin and controllers remain mounted. Public SlotRegistry inspection and registration reuse the original injected controller with wrappers around the exported FeedbackDialog and MessageFeedbackActions components.

This deployment has no official conversation-log feedback service. Session and message dialogs use the official disabled state, with an unavailable reason in eight languages. Like/dislike icons retain their official layout, styles and localized explanation inside a disabled fieldset. Every feedback Remote and `/feedback` rejects explicitly; settings-sidecar persistence is never presented as successful log submission.

Run `node apps/web/tests/parity/run.mjs` to compare the visible controls, original-controller connection, disabled interactions, and English/Chinese rendering against pinned official components. Source exports are recorded in `dshBase.reuse.sourceEntries` for upgrade review. This is scoped surface validation, not a claim of whole-application UI fidelity.
