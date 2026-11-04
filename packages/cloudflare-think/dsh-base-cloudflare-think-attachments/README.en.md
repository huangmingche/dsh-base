# Think attachment reads

The Host seam reuses the official upload UI and HTTP contract. This plugin reads admitted files through the current Session's Host. R2 content is verified by SHA-256 and receipts are bound to a Session and message. `read_uploaded_file` returns up to 64 KiB of UTF-8 or exact base64 bytes and the next offset. It cannot read another Session's files or unsubmitted uploads.

Official `tool-fs` and `attachment-local` require the Node filesystem and official execution runtime; they cannot mount in Think or be reused through a Host-only fork. This plugin only adapts the Think tool contract. No PDF, Office or image parser is configured, so binary content interpretation is not claimed.
