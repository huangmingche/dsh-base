# @dsh-base/client-locale-url

Synchronizes the official locale runtime with the URL prefix: Chinese is `/zh-CN`, the other six languages use their bare id (`/ja`, `/es`, `/fr`, `/de`, `/pt`, `/ru`), English is unprefixed.

## Behavior

- **Boot**: a canonical prefix (`/zh-CN/...`, `/ja/...`) selects that language; a bare address does not force English — it keeps the language preference saved by the official runtime and mirrors that preference into the prefix.
- **Language switch**: only the prefix changes; path, query and hash are preserved.
- **`/en/*`**: the server 301s to the bare path (this plugin never joins prefixes itself; it uses the shared module).
- **Retired `/zh` path**: no language meaning any more — an ordinary SPA route that selects no language.
- Prefix rules come only from `@dsh-base/locale-path`; `check:locale-path` rejects a second hand-written copy here.

## Reuse decision

The official locale plugin owns the runtime, dictionaries, settings row and Host preference but has no address strategy (a language switch does not update the URL). This plugin composes the official locale service and adds only prefix synchronization — no fork, no replacement. See `dshBase.reuse` in `package.json`.
