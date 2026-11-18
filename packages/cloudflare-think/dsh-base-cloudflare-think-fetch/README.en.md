# @dsh-base/cloudflare-think-fetch

[简体中文](README.md) | English

Deployment/owner configuration seam for Cloudflare Think's unchanged
`createFetchTools`. It retains the SDK's private-network checks, 1 MB download
limit, 24,000-character model limit, and redirect handling. Pinned DSH's
`web-fetch-http` uses Node `undici`, and `tool-web` requires native tool services;
neither provides deployment-versus-owner allowlist subset validation. The reuse
decision is recorded in `package.json`.

This plugin provides `fetch_url` for reading a known URL. DSH rc.5 selects a
registered `web_search` provider using the model route that requested the search.
The Workers composition registers no search provider, so both DeepSeek BYOK and
Cloudflare AI Gateway expose only the enabled URL-fetching capability for web
access. Official DeepSeek Messages search consumes model tokens for an additional
model turn on each search.

`FETCH_ALLOWLIST` is the comma-separated deployment policy. An absent or blank
binding defaults to `https://developers.cloudflare.com/**` and
`https://ai-sdk.dev/**`. Owner/session `{ "allowlist": [...] }` configuration
can only narrow that policy:

- Accept absolute HTTPS origin/path patterns, including path `*` or `**`.
  Reject userinfo, authority wildcards, query, fragment, whitespace/control
  characters, and backslashes. Configured paths also reject encoded separators,
  nested percent encoding, and malformed escapes.
- Normalize hostname case, default ports, a DNS trailing dot, and path dot
  segments. A bare origin means `/**`; an explicit `/` means only the root path,
  matching Think's semantics.
- Origins must match. Deployment `/docs/**` permits paths or patterns under
  `/docs/`, never `/docs-other/**`. Exact or complex deployment globs accept
  only the identical canonical pattern; containment is never guessed.
- Missing configuration, a missing `allowlist`, or an empty array inherits the
  deployment policy. Any invalid, out-of-policy, or unprovable member of a
  nonempty list rejects the entire configuration, never restoring broader access.

The control plane validates owner/session configuration before persistence;
Think revalidates stored configuration so old data or administrator writes cannot
bypass execution restrictions. Both use the shared pure policy in
`@dsh-base/plugin-management`. Redirects explicitly use `allowlisted`, enforcing
the final allowlist at every hop. Path restrictions apply to the URL-normalized
pathname, not resource paths after a destination server's own secondary decoding.

Run `pnpm check:fetch` for pure policy tests, real Think SDK request/redirect tests
with a local fetch stub, and control-plane refusal/revision preservation tests.
It is included in `check:security`; tests make no real network requests.
