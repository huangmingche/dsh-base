/** Browser gateway → Remote → owner Session Host → SQLite and immutable R2 bytes. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { WireHandler } from "@dsh-base/cloudflare-worker-wire-rpc";
import { createOfficialWorkspaceFilesGateway } from "../../../client/dsh-base-client-session-host/src/workspace-files-gateway.ts";
import { createDurableObjectSessionHost } from "../src/durable-object.ts";
import { SESSION_HOST_STORAGE_ID } from "../src/migration.ts";
import { registerWorkspaceFilesRemoteEndpoints } from "../src/remote-workspace-files.ts";
import { dispatchSessionHost } from "../src/service.ts";
import type { SqlCursor, SqlStorage } from "../src/sqlite-storage.ts";
import { WorkspaceFileStore, type R2BucketLike } from "../src/workspace-files.ts";

export class NodeSqlStorage implements SqlStorage {
  private readonly db = new DatabaseSync(":memory:");

  exec(query: string, ...bindings: readonly unknown[]): SqlCursor {
    const statement = this.db.prepare(query);
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = statement.all(...bindings) as Array<Record<string, unknown>>;
    } catch {
      statement.run(...bindings);
    }
    return { toArray: () => rows };
  }
}

export class FakeR2 implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();

  async get(key: string, options?: { range: { offset: number; length: number } }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    const { offset, length } = options?.range ?? { offset: 0, length: stored.byteLength };
    const buffer = Uint8Array.from(stored.subarray(offset, offset + length)).buffer;
    return { arrayBuffer: async () => buffer };
  }

  async put(key: string, value: Uint8Array): Promise<unknown> {
    this.objects.set(key, Uint8Array.from(value));
    return { key };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** Only the transport and Cloudflare bindings are in-memory; both owners use the same session ID. */
export async function createFileReadFixture(bytes: Uint8Array) {
  const bucket = new FakeR2();
  const byObjectId = new Map<string, ReturnType<typeof createDurableObjectSessionHost>>();
  const sessionId = "preview-session", path = "Workbook.xlsx";
  for (const owner of ["preview-owner", "other-owner"]) {
    const sql = new NodeSqlStorage();
    const files = new WorkspaceFileStore(sql, bucket, owner);
    const host = createDurableObjectSessionHost(sql, [], undefined, files);
    await host.create({ sessionId });
    if (owner === "preview-owner") await files.write({ workspaceId: "default", root: "/" }, path, bytes);
    byObjectId.set(`owner:${owner}:${SESSION_HOST_STORAGE_ID}`, host);
  }
  const env = { SESSION_HOST: {
    idFromName: (name: string) => name,
    get: (id: string) => ({ async fetch(request: Request) {
      const host = byObjectId.get(id);
      assert.ok(host);
      if (new URL(request.url).pathname.endsWith("/migrate/status")) return Response.json({ migrated: true });
      return Response.json(await dispatchSessionHost(host, await request.json()));
    } }),
  } };
  const methods = new Map<string, WireHandler>();
  registerWorkspaceFilesRemoteEndpoints({ register(method, handler) {
    methods.set(method, handler);
    return () => { methods.delete(method); };
  } });
  async function read(options: { range?: { offset?: number; length?: number } } = {}, owner = "preview-owner") {
    const gateway = createOfficialWorkspaceFilesGateway({
      baseUrl: "https://workspace.test",
      fetch: async (url, init) => {
        const request = new Request(url, init);
        const { payload, rpcId, method } = await request.json();
        const handler = methods.get(method);
        assert.ok(handler);
        let result;
        try {
          const value = await handler(payload, { request, user: { id: owner }, rpcId, method, env });
          result = { ok: true, value };
        } catch (error) {
          if (!(error instanceof Error && "code" in error)) throw error;
          result = { ok: false, error: { message: error.message, code: error.code } };
        }
        return Response.json({ type: "server-response", rpcId, result });
      },
    });
    return gateway.readBytes(sessionId, path, options);
  }
  return { read };
}

export async function readWorkspaceFixture(bytes: Uint8Array): Promise<Uint8Array> {
  const fixture = await createFileReadFixture(bytes);
  const result = await fixture.read();
  assert.ok(result.ok);
  assert.equal(result.value.eof, true);
  assert.equal(result.value.bytes, bytes.byteLength);
  return result.value.data;
}

// The browser acceptance runs this CLI with its test-only runtime hook and sends the resulting bytes to the real Excel Worker.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(await readWorkspaceFixture(Buffer.concat(chunks)));
}
