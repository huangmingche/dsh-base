/** Official workspaceFiles bridge contract. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@dsh-base/session-wire") {
      return {
        url: new URL("../../../boot/dsh-base-session-wire/src/index.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { registerWorkspaceFilesRemoteEndpoints, registerWorkspaceFilesStreamEndpoints } = await import("../src/remote-workspace-files.ts");

const unary: string[] = [];
const handlers = new Map<string, (payload: unknown, invocation: unknown) => unknown>();
const wireRpc = {
  register(method: string, handler: (payload: unknown, invocation: unknown) => unknown) {
    unary.push(method);
    handlers.set(method, handler);
    return () => undefined;
  },
};
const disposeUnary = registerWorkspaceFilesRemoteEndpoints(wireRpc as never);
assert.deepEqual([...unary].sort(), [
  "workspaceFiles/list",
  "workspaceFiles/read",
  "workspaceFiles/readBytes",
  "workspaceFiles/stat",
]);
const statHandler = handlers.get("workspaceFiles/stat")!;
await assert.rejects(async () => statHandler({ args: {} }, {}), /workspaceFileScope/);
await assert.rejects(async () => statHandler({ args: { request: { workspaceFileScope: 42 } } }, {}), /workspaceFileScope/);
disposeUnary();

const streams: string[] = [];
let streamHandler: ((payload: unknown, invocation: unknown) => unknown) | undefined;
const streamWire = {
  register(method: string, handler: (payload: unknown, invocation: unknown) => unknown) {
    streams.push(method);
    streamHandler = handler;
    return () => undefined;
  },
};
const disposeStream = registerWorkspaceFilesStreamEndpoints(streamWire as never);
assert.deepEqual(streams, ["workspaceFiles/changes"]);
await assert.rejects(async () => {
  const invocation = { request: { signal: new AbortController().signal } };
  const iterable = streamHandler!({ args: { request: {} } }, invocation) as AsyncIterable<unknown>;
  for await (const _value of iterable) { /* invalid request */ }
}, /workspaceFileScope/);
disposeStream();
console.log("session-host: official workspace files bridge passed");
