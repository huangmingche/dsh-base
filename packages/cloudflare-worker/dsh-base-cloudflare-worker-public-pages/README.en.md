# Public document registry

An independent Worker plugin. Content plugins declare real documents using `publicPages.register(owner, provider)`. Routing, SEO, sitemap, llms and analytics consume the same service. Registration never grants access to private APIs.

Declarations explicitly specify access, publication status, indexing eligibility, actual languages and publication date. Drafts, archived, scheduled and private documents are omitted from the anonymous inventory. Missing translations return 404. Duplicate paths, base identities and reserved private namespaces are rejected. Disposing a registration immediately removes its provider.

Deployment indexing defaults off. Indexing requires `environment: "production"`, `enabled: true` and a real HTTPS `authBaseUrl`. Staging HTML is noindex; its sitemap is empty and robots does not advertise a sitemap. Login pages remain crawlable so their noindex can be read; server authentication and ownership checks remain independent.

The pinned official locale/web packages expose no server publication registry. See reuse metadata. No additional infrastructure, scheduled jobs or model calls are introduced.

Validation: `node --experimental-strip-types --test packages/cloudflare-worker/dsh-base-cloudflare-worker-public-pages/tests/*.test.ts`.
