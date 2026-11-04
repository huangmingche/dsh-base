# @dsh-base/client-session-host

Browser transport seam for the Workers-native Session Host.

## Scope

- `POST /api/session-host` JSON requests
- `GET /api/session-host/follow` SSE
- `GET /api/session-host/control` SSE
- list/state/page/projections/rename/create/fork/selectModel/models/prompt/cancel/updateQueue/claim/follow/control
- `createOfficialSessionGateway()`: official `session/<method>` envelope client (first migrated namespace)
- `createOfficialWorkspaceGateway()`: official `workspace/<method>` envelope client plus `workspace/follow` (second migrated namespace)
- `openWireStream()`: `/api/remote.mux` logical-stream browser carrier (`session/follow`, `session/control`, `workspace/follow`)
- official envelopes for `session/page`, `session/prompt` and `session/fork(atSeq)`

## Boundary

This is a transport seam, not the official session-controller client, and it
does not fake UI. The official `api-session-controller` client will consume this
transport later.

## Verify

```bash
pnpm check:session-client
pnpm check:workspace
```

## Official Remote seam

The application uses `@dsh-base/client-session-adapter` for Host adaptation;
the unchanged official Session controller owns lifecycle. This package's
`remote-stream` directly uses the official `RemoteStream` and only classifies
physical carrier loss separately from business/protocol errors. The unused
`createOfficialSessionRemote` placeholder was removed: no successful empty
commands/subagent API, fixed cursor or handwritten single-generation iterator
is exported as an official Session/recovery implementation.

## Official session RPC gateway

`createOfficialSessionGateway()` sends the generated official Remote contract as
`{ type: "client-request", payload: { args } }`:

- endpoint prefix: `/api/session/<method>`
- when the Connection plugin is active it calls
  `connection.rpc.call("/api", endpoint, payload)`; before activation it uses a
  same-origin `fetch` with the same official envelope
- methods: `list / state / projections / create / fork / rename / selectModel /
  modelCatalog / cancel / page`
- `page` accepts `throughSeq`, `beforeSeq`, `maxMessages`, and `turnWindow` and
  returns the official `{ records, hasMore }` page over the shared dense journal
- `isOfficialEndpointUnavailable()` classifies only "no such endpoint" as
  fallback-eligible; business errors and carrier failures after an admitted call
  are not replayed
- `SESSION_REMOTE_ENDPOINTS` / `SESSION_REMOTE_DESCRIPTOR` expose the bridged
  method inventory

The custom `/api/session-host` transport is unchanged; the session adapter falls
back to it when the official endpoint is unavailable. Prompt/claim and `fork`
remain on the custom transport, and direct-subagent history keeps the custom
`page` read because the bridge serves ordinary Session addresses only;
`follow`/`control` use the `/api/remote.mux` streams with the custom SSE
transport as fallback. See `docs/typed-remote-mapping.md` for the exact reasons.

## Official workspace RPC gateway

`createOfficialWorkspaceGateway()` reuses the same official envelope and the
same Connection/fetch selection:

- methods: `create / initializeDefault / rename / delete / insertBefore /
  insertSessionBefore / archiveSession / unarchiveSession / pinSession /
  unpinSession`
- payloads follow the generated official contract: `{ args: { request } }`, and
  `{ args: {} }` for `initializeDefault`
- `follow(signal)` consumes the `/api/remote.mux` `workspace/follow` logical
  stream and yields the official `baseline` / `replace` / `upsert` / `remove` /
  `order` / `archived` / `pinned` frames
- `WORKSPACE_REMOTE_ENDPOINTS` / `WORKSPACE_REMOTE_DESCRIPTOR` /
  `WORKSPACE_FOLLOW_ENDPOINT` expose the bridged method and stream inventory
- `isOfficialEndpointUnavailable()` again classifies only "no such endpoint" as
  fallback-eligible

The session adapter calls the official `remote.workspace.*` endpoints first and
falls back to the custom `/api/session-host` transport only when the endpoint is
unavailable; `follow` falls back to polling only when the stream fails before
its baseline.
JSON requests validate both HTTP success and an explicit `result` field. Error status, empty envelopes, invalid JSON and Host business failures reject; business `code/message/details` are preserved. Successful void operations acknowledge with `result: null`, so a missing response cannot look successful. `tests/transport.test.ts` covers real HTTP/SSE and failure envelopes.


Projection versions come from Host SQLite transactions and are independent of chat event cursors. Baselines, control frames, rename acknowledgements and the legacy SSE seam use the same server version. The client never creates Date.now() sequence numbers or recomputes an older snapshot against a separately read newer state. Older Hosts without a genuine version fail explicitly. This separate version domain is a recorded compatibility gap, not the official unified event-log consistent cut.

Stream recovery directly uses the pinned stable-exported `RemoteStream`, preserving official Connection generations, opening-frame acceptance, restart and cancellation. Only physical WebSocket loss becomes `RemoteStreamCarrierError`; Host business envelopes, invalid JSON and unserializable parameters remain terminal rather than being hidden by fallback or retry. `tests/reconnect.test.ts` exercises actual official control, Workspace and Session journal consumers plus the projection store: replacement baselines/cursors, stale projection rejection, no duplicate user message, offline waiting, bounded retries and disposal. A separate client seam integration test covers the actual Connection/Gateway handshake.
