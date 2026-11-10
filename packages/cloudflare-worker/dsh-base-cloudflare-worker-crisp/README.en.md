# Crisp configuration

This Worker plugin exposes only the public configuration needed by the optional client support integration. Set `CRISP_ENABLED=true` and a valid UUID `CRISP_WEBSITE_ID`. The default is disabled; malformed or missing identifiers never produce an enabled widget.

`GET /api/saas/crisp` returns `{enabled,websiteId}` with no-store. Other methods return 405. The website ID is intentionally public and is not a secret. The Worker neither loads scripts nor sends conversations, email addresses or user identities to Crisp. The client companion owns user interaction and lazy widget loading; official Session feedback stays unchanged. No database, additional service or background request is required.

Configuration and UI behavior are exercised locally; no real Crisp account connection or support conversation is claimed verified.
