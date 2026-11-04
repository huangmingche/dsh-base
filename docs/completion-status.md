# Release verification

The client profile and the source lock specify the official plugins and upstream release used by this build. Run `pnpm check` and `pnpm build` against the locked checkout. Local and Staging browser tests describe the interactions exercised by each runner. An acceptance result applies to the build that produced it.

[Source lock](../dsh-source.lock.json) · [Client profile](../apps/web/composition.profile.json) · [Runtime boundaries](runtime-parity.md)
