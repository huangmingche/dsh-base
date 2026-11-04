/**
 * Real workspace file storage for the Workers-native Session Host.
 *
 * Content bytes live in the `FILES` R2 bucket as immutable version objects;
 * only metadata lives in the Session Host Durable Object SQLite store. Every
 * write inserts a new version row and R2 object and re-points the node at it,
 * so a version token a reader observed never changes its bytes. Directory
 * nodes are created implicitly on write and keep the tree listable without an
 * object per directory.
 *
 * All paths are workspace paths: canonical, `/`-separated names relative to a
 * Session Workspace root, with no `.`/`..`/empty segments and no NUL bytes.
 */
import type { SqlStorage } from "./sqlite-storage.ts";

/** Stable failure codes the workspace file store and its transport raise. */
export type WorkspaceFileErrorCode =
  | "workspace-file/not-found"
  | "workspace-file/outside-workspace"
  | "workspace-file/too-large"
  | "workspace-file/not-text"
  | "workspace-file/not-directory"
  | "workspace-file/not-regular-file"
  | "workspace-file/unavailable"
  | "gateway/bad-request";

/** One workspace file operation failure carrying its stable code. */
export class WorkspaceFileError extends Error {
  /** Stable failure code returned to the caller. */
  readonly code: WorkspaceFileErrorCode;

  /**
   * @param code - Stable failure code.
   * @param message - Diagnostic describing the rejected operation.
   */
  constructor(code: WorkspaceFileErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceFileError";
    this.code = code;
  }
}

/**
 * Minimal structural subset of the Workers `R2Bucket` binding this store uses.
 *
 * `get`/`put` accept an options argument the store ignores so a real
 * `R2Bucket` stays assignable without importing `@cloudflare/workers-types`.
 */
export interface R2BucketLike {
  get(key: string, options?: unknown): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** One Workspace whose files are addressed; the root is its logical workspace path. */
export interface WorkspaceFileScope {
  /** Durable Workspace id owning the file nodes. */
  readonly workspaceId: string;
  /** Workspace root path; `"/"` for the default Workspace. */
  readonly root: string;
}

/** One direct child of a listed workspace directory. */
export interface WorkspaceFileEntry {
  /** Basename inside the listed directory. */
  readonly name: string;
  /** Whether the child is a file or a directory. */
  readonly type: "file" | "directory";
  /** Byte size of a regular file. */
  readonly size?: number;
}

/** Direct children of one workspace directory. */
export interface WorkspaceFileListing {
  /** Listed directory as a workspace-relative path; empty for the root. */
  readonly path: string;
  /** Direct children in name order, cut to the entry cap. */
  readonly entries: readonly WorkspaceFileEntry[];
  /** Whether the entry cap dropped children from {@link entries}. */
  readonly truncated: boolean;
}

/** Identity and freshness of one workspace file, without its content. */
export interface WorkspaceFileStat {
  /** Absolute workspace path of the file. */
  readonly absolutePath: string;
  /** Opaque freshness token, never parsed by a caller. */
  readonly version: string;
  /** Byte size of the complete file. */
  readonly bytes?: number;
}

/** One immutable write result: identity, freshness, and size together. */
export interface WorkspaceFileWriteResult {
  /** Absolute workspace path of the written file. */
  readonly absolutePath: string;
  /** Version id of the newly written content. */
  readonly version: string;
  /** Byte size of the newly written content. */
  readonly bytes: number;
}

/** One page of a workspace text file. */
export interface WorkspaceFileTextPage extends WorkspaceFileStat {
  /** First line of the page, 1-based. */
  readonly offset: number;
  /** The page's lines joined by `\n`, without a trailing terminator. */
  readonly text: string;
  /** How many lines the page holds. */
  readonly lines: number;
  /** Whether the page includes the file's last line. */
  readonly eof: boolean;
}

/** One byte window of a workspace file, without text decoding. */
export interface WorkspaceFileBytesPage extends WorkspaceFileStat {
  /** First byte of the window, 0-based. */
  readonly offset: number;
  /** Native bytes of the window. */
  readonly data: Uint8Array;
  /** Whether the window includes the file's last byte. */
  readonly eof: boolean;
}

/** Entry cap of one directory listing. */
export const MAX_LIST_ENTRIES = 2000;
/** Byte cap of one complete text read. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Default and maximum line count of one text page. */
export const DEFAULT_READ_LINES = 5000;
/** Default byte window of one binary read. */
export const DEFAULT_BYTE_WINDOW = 1024 * 1024;
/** Byte cap of one workspace file write; reads never serve a larger file window. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Media type stored for a write that names none. */
export const DEFAULT_MEDIA_TYPE = "application/octet-stream";

/** SQL table holding one node per file or directory per workspace. */
const NODES_TABLE = "dsh_session_host_file_nodes";
/** SQL table holding every immutable file version ever written. */
const VERSIONS_TABLE = "dsh_session_host_file_versions";

/**
 * Normalize a Workspace root to one absolute `/`-prefixed path without a
 * trailing separator; the root itself stays `"/"`.
 * @param root - Workspace path from its durable record.
 * @returns the normalized root.
 */
export function normalizeWorkspaceRoot(root: string | undefined): string {
  const parts = (root ?? "").split("/").filter((part) => part !== "" && part !== ".");
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/**
 * Canonicalize one requested path against a Workspace root.
 *
 * The empty string and both the relative and absolute forms of the root name
 * the root itself. An absolute path inside a non-root Workspace is rebased onto
 * the root; anything resolving outside it is refused.
 * @param root - Workspace root path.
 * @param path - workspace-relative or absolute request path.
 * @returns the canonical relative path; empty for the root.
 * @throws WorkspaceFileError with `gateway/bad-request` or
 * `workspace-file/outside-workspace` when the path is not a workspace path.
 */
export function workspaceRelativePath(root: string, path: string | undefined): string {
  const normalizedRoot = normalizeWorkspaceRoot(root);
  const raw = path ?? "";
  if (raw.includes("\u0000")) throw new WorkspaceFileError("gateway/bad-request", "path contains a NUL byte");
  let relative: string;
  if (raw === "" || raw === "/") {
    relative = "";
  } else if (raw.startsWith("/")) {
    if (normalizedRoot === "/") relative = raw.slice(1);
    else if (raw === normalizedRoot) relative = "";
    else if (raw.startsWith(`${normalizedRoot}/`)) relative = raw.slice(normalizedRoot.length + 1);
    else throw new WorkspaceFileError("workspace-file/outside-workspace", `"${raw}" is outside the workspace`);
  } else {
    relative = raw;
  }
  if (relative === "") return "";
  for (const segment of relative.split("/")) {
    if (segment === "") throw new WorkspaceFileError("gateway/bad-request", `"${raw}" has an empty path segment`);
    if (segment === "..") throw new WorkspaceFileError("workspace-file/outside-workspace", `"${raw}" is outside the workspace`);
  }
  return relative;
}

/**
 * Join a canonical relative path onto a Workspace root.
 * @param root - Workspace root path.
 * @param relative - canonical workspace-relative path; empty for the root.
 * @returns the `/`-joined absolute workspace path.
 */
export function workspaceAbsolutePath(root: string, relative: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(root);
  if (relative === "") return normalizedRoot;
  return normalizedRoot === "/" ? `/${relative}` : `${normalizedRoot}/${relative}`;
}

/**
 * Parent of one canonical relative path.
 * @param relative - canonical workspace-relative path.
 * @returns the parent path; empty for a direct root child.
 */
export function workspaceParentPath(relative: string): string {
  const cut = relative.lastIndexOf("/");
  return cut === -1 ? "" : relative.slice(0, cut);
}

/**
 * Basename of one canonical relative path.
 * @param relative - canonical non-empty workspace-relative path.
 * @returns the last path segment.
 */
export function workspaceBaseName(relative: string): string {
  const cut = relative.lastIndexOf("/");
  return cut === -1 ? relative : relative.slice(cut + 1);
}

/**
 * Encode native bytes as standard base64, chunked so a large file does not
 * spread one call's arguments over the engine argument limit.
 * @param data - bytes to encode.
 * @returns base64 text.
 */
export function encodeBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < data.byteLength; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Decode standard base64 request data.
 * @param value - base64 text from the wire.
 * @returns decoded native bytes.
 * @throws WorkspaceFileError with `gateway/bad-request` when the text is not
 * valid base64.
 */
export function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new WorkspaceFileError("gateway/bad-request", "dataBase64 is not valid base64");
  }
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return data;
}

/** One node row as stored in the Session Host Durable Object SQLite store. */
interface WorkspaceFileNode {
  readonly relPath: string;
  readonly parentPath: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly size: number;
  readonly versionId: string | undefined;
  readonly mediaType: string | undefined;
  readonly objectKey: string | undefined;
  readonly updatedAt: number;
}

/** Test-double-friendly view over the SQL node row. */
function toNode(row: Record<string, unknown>): WorkspaceFileNode {
  const versionId = row.version_id;
  const mediaType = row.media_type;
  const objectKey = row.object_key;
  return {
    relPath: String(row.path),
    parentPath: String(row.parent_path),
    name: String(row.name),
    kind: row.kind === "directory" ? "directory" : "file",
    size: Number(row.size),
    versionId: typeof versionId === "string" && versionId !== "" ? versionId : undefined,
    mediaType: typeof mediaType === "string" ? mediaType : undefined,
    objectKey: typeof objectKey === "string" && objectKey !== "" ? objectKey : undefined,
    updatedAt: Number(row.updated_at),
  };
}

/** Validate one 1-based line offset; omitted fields take the page default. */
function lineOffset(value: number | undefined): number {
  return value === undefined ? 1 : integerAtLeast(value, 1, "offset");
}

/** Validate one line count against the page cap. */
function lineLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_READ_LINES;
  const limit = integerAtLeast(value, 1, "limit");
  if (limit > DEFAULT_READ_LINES) {
    throw new WorkspaceFileError("gateway/bad-request", `limit must be at most ${DEFAULT_READ_LINES}`);
  }
  return limit;
}

/** Validate one 0-based byte offset; omitted fields take the window default. */
function byteOffset(value: number | undefined): number {
  return value === undefined ? 0 : integerAtLeast(value, 0, "offset");
}

/** Validate one byte window length; omitted fields take the window default. */
function byteLength(value: number | undefined): number {
  return value === undefined ? DEFAULT_BYTE_WINDOW : integerAtLeast(value, 1, "length");
}

/** Refuse a number a file index cannot use; only safe integers index content. */
function integerAtLeast(value: number, min: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new WorkspaceFileError("gateway/bad-request", `${name} must be a safe integer of at least ${min}`);
  }
  return value;
}

/** Split UTF-8 text into lines where a final `\n` terminates the last line. */
function splitTextLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * R2-backed immutable workspace file store over Durable Object SQLite metadata.
 *
 * One store instance serves every Workspace of one owner; each operation names
 * its {@link WorkspaceFileScope}. The R2 object key of a version is
 * `owner/<ownerId>/workspaces/<workspaceId>/versions/<versionId>`, so objects
 * from one owner's Workspaces cannot collide.
 */
export class WorkspaceFileStore {
  private readonly sql: SqlStorage;
  private readonly bucket: R2BucketLike | undefined;
  /** Authenticated owner scope, also used by the model-action permission boundary. */
  readonly ownerId: string;

  /**
   * @param sql - Durable Object SQL executor holding the metadata tables.
   * @param bucket - `FILES` R2 binding holding content bytes; undefined only
   * for a deployment without the binding, where every content read/write
   * fails with `workspace-file/unavailable`.
   * @param ownerId - authenticated owner id scoping every R2 object key.
   */
  constructor(sql: SqlStorage, bucket: R2BucketLike | undefined, ownerId: string) {
    this.sql = sql;
    this.bucket = bucket;
    this.ownerId = ownerId;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const statements = [
      `CREATE TABLE IF NOT EXISTS ${NODES_TABLE} (
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        version_id TEXT,
        media_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, path)
      )`,
      `CREATE INDEX IF NOT EXISTS ${NODES_TABLE}_parent
        ON ${NODES_TABLE} (workspace_id, parent_path, name)`,
      `CREATE TABLE IF NOT EXISTS ${VERSIONS_TABLE} (
        version_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        media_type TEXT NOT NULL,
        object_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${VERSIONS_TABLE}_path
        ON ${VERSIONS_TABLE} (workspace_id, path, created_at)`,
    ];
    for (const statement of statements) this.sql.exec(statement);
  }

  /**
   * List the direct children of one workspace directory.
   * @param scope - Workspace whose tree is listed.
   * @param path - workspace-relative or absolute directory path; empty for the root.
   * @returns the children in name order, bounded by {@link MAX_LIST_ENTRIES}.
   * @throws WorkspaceFileError with `workspace-file/not-found`,
   * `workspace-file/not-directory`, `workspace-file/outside-workspace`, or
   * `gateway/bad-request`.
   */
  list(scope: WorkspaceFileScope, path: string): WorkspaceFileListing {
    const relative = workspaceRelativePath(scope.root, path);
    if (relative !== "") {
      const node = this.nodeAt(scope.workspaceId, relative);
      if (node === undefined) throw new WorkspaceFileError("workspace-file/not-found", `no workspace entry at "${path}"`);
      if (node.kind !== "directory") throw new WorkspaceFileError("workspace-file/not-directory", `"${path}" is a file`);
    }
    const rows = this.sql.exec(
      `SELECT name, kind, size FROM ${NODES_TABLE}
        WHERE workspace_id = ? AND parent_path = ?
        ORDER BY name LIMIT ?`,
      scope.workspaceId,
      relative,
      MAX_LIST_ENTRIES + 1,
    ).toArray();
    const truncated = rows.length > MAX_LIST_ENTRIES;
    const entries = (truncated ? rows.slice(0, MAX_LIST_ENTRIES) : rows).map((row) => {
      const entry: WorkspaceFileEntry = {
        name: String(row.name),
        type: row.kind === "directory" ? "directory" : "file",
        ...(row.kind === "directory" ? {} : { size: Number(row.size) }),
      };
      return entry;
    });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return { path: relative, entries, truncated };
  }

  /**
   * Report one workspace file's identity, version, and size.
   * @param scope - Workspace holding the file.
   * @param path - workspace-relative or absolute file path.
   * @returns the file's absolute path, current immutable version, and byte size.
   * @throws WorkspaceFileError with `workspace-file/not-found`,
   * `workspace-file/not-regular-file`, `workspace-file/outside-workspace`, or
   * `gateway/bad-request`.
   */
  stat(scope: WorkspaceFileScope, path: string): WorkspaceFileStat {
    const node = this.requireFileNode(scope, path);
    return this.statOf(scope, node);
  }

  /**
   * Read one page of lines from a UTF-8 workspace file.
   * @param scope - Workspace holding the file.
   * @param path - workspace-relative or absolute file path.
   * @param range - optional 1-based line offset (default 1) and page size (default and cap 5000).
   * @returns the page, the file's version, and whether it reaches the last line.
   * @throws WorkspaceFileError with `workspace-file/not-found`,
   * `workspace-file/not-regular-file`, `workspace-file/too-large`,
   * `workspace-file/not-text`, `workspace-file/unavailable`,
   * `workspace-file/outside-workspace`, or `gateway/bad-request`.
   */
  async read(
    scope: WorkspaceFileScope,
    path: string,
    range: { readonly offset?: number; readonly limit?: number } = {},
  ): Promise<WorkspaceFileTextPage> {
    const offset = lineOffset(range.offset);
    const limit = lineLimit(range.limit);
    const node = this.requireFileNode(scope, path);
    if (node.size > MAX_TEXT_BYTES) {
      throw new WorkspaceFileError("workspace-file/too-large", `"${path}" exceeds the ${MAX_TEXT_BYTES} byte text read cap`);
    }
    const data = await this.readObject(node, path);
    if (data.byteLength > MAX_TEXT_BYTES) {
      throw new WorkspaceFileError("workspace-file/too-large", `"${path}" exceeds the ${MAX_TEXT_BYTES} byte text read cap`);
    }
    if (data.includes(0)) throw new WorkspaceFileError("workspace-file/not-text", `"${path}" contains NUL bytes`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
    } catch {
      throw new WorkspaceFileError("workspace-file/not-text", `"${path}" is not UTF-8 text`);
    }
    const lines = splitTextLines(text);
    const page = lines.slice(offset - 1, offset - 1 + limit);
    return {
      ...this.statOf(scope, node),
      offset,
      text: page.join("\n"),
      lines: page.length,
      eof: offset - 1 + page.length >= lines.length,
    };
  }

  /**
   * Read one byte window of a workspace file without text decoding.
   * @param scope - Workspace holding the file.
   * @param path - workspace-relative or absolute file path.
   * @param range - optional 0-based byte offset (default 0) and window length (default 1 MiB).
   * @returns native bytes of the window, the file's version and size, and whether the window reaches the last byte.
   * @throws WorkspaceFileError with `workspace-file/not-found`,
   * `workspace-file/not-regular-file`, `workspace-file/too-large`,
   * `workspace-file/unavailable`, `workspace-file/outside-workspace`, or
   * `gateway/bad-request`.
   */
  async readBytes(
    scope: WorkspaceFileScope,
    path: string,
    range: { readonly offset?: number; readonly length?: number } = {},
  ): Promise<WorkspaceFileBytesPage> {
    const offset = byteOffset(range.offset);
    const length = byteLength(range.length);
    if (offset + length > Number.MAX_SAFE_INTEGER) {
      throw new WorkspaceFileError("gateway/bad-request", "offset plus length must stay a safe integer");
    }
    const node = this.requireFileNode(scope, path);
    if (node.size > MAX_FILE_BYTES) {
      throw new WorkspaceFileError("workspace-file/too-large", `"${path}" exceeds the ${MAX_FILE_BYTES} byte file read cap`);
    }
    const data = await this.readObject(node, path);
    if (data.byteLength > MAX_FILE_BYTES) {
      throw new WorkspaceFileError("workspace-file/too-large", `"${path}" exceeds the ${MAX_FILE_BYTES} byte file read cap`);
    }
    const window = data.subarray(offset, Math.min(data.byteLength, offset + length));
    return {
      ...this.statOf(scope, node),
      offset,
      data: window,
      eof: offset + window.byteLength >= data.byteLength,
    };
  }

  /**
   * Write one new immutable version of a workspace file.
   *
   * Missing parent directories are created implicitly, an existing directory at
   * the target path is refused, and previous versions and their R2 objects stay
   * readable forever.
   * @param scope - Workspace holding the file.
   * @param path - workspace-relative or absolute file path.
   * @param data - native bytes of the new version.
   * @param mediaType - media type to record for the new version.
   * @returns the written file's absolute path, new version, and byte size.
   * @throws WorkspaceFileError with `workspace-file/unavailable`,
   * `workspace-file/too-large`, `workspace-file/not-regular-file`,
   * `workspace-file/not-directory`, `workspace-file/outside-workspace`, or
   * `gateway/bad-request`.
   */
  async write(
    scope: WorkspaceFileScope,
    path: string,
    data: Uint8Array,
    mediaType: string = DEFAULT_MEDIA_TYPE,
  ): Promise<WorkspaceFileWriteResult> {
    const relative = workspaceRelativePath(scope.root, path);
    if (relative === "") throw new WorkspaceFileError("workspace-file/not-regular-file", "the workspace root is a directory");
    if (data.byteLength > MAX_FILE_BYTES) {
      throw new WorkspaceFileError("workspace-file/too-large", `"${path}" exceeds the ${MAX_FILE_BYTES} byte write cap`);
    }
    const bucket = this.requireBucket();
    const existing = this.nodeAt(scope.workspaceId, relative);
    if (existing !== undefined && existing.kind !== "file") {
      throw new WorkspaceFileError("workspace-file/not-regular-file", `"${path}" is a directory`);
    }
    const parents = this.parentDirectories(relative);
    for (const parent of parents) {
      const node = this.nodeAt(scope.workspaceId, parent.path);
      if (node !== undefined && node.kind !== "directory") {
        throw new WorkspaceFileError("workspace-file/not-directory", `"${parent.path}" is a file, not a directory`);
      }
    }
    const versionId = crypto.randomUUID();
    const objectKey = `owner/${this.ownerId}/workspaces/${scope.workspaceId}/versions/${versionId}`;
    await bucket.put(objectKey, data);
    const now = Date.now();
    for (const parent of parents) {
      if (this.nodeAt(scope.workspaceId, parent.path) !== undefined) continue;
      this.sql.exec(
        `INSERT INTO ${NODES_TABLE}
          (workspace_id, path, parent_path, name, kind, size, version_id, media_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'directory', 0, NULL, NULL, ?, ?)`,
        scope.workspaceId,
        parent.path,
        parent.parentPath,
        parent.name,
        now,
        now,
      );
    }
    this.sql.exec(
      `INSERT INTO ${VERSIONS_TABLE} (version_id, workspace_id, path, size, media_type, object_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      versionId,
      scope.workspaceId,
      relative,
      data.byteLength,
      mediaType,
      objectKey,
      now,
    );
    if (existing === undefined) {
      this.sql.exec(
        `INSERT INTO ${NODES_TABLE}
          (workspace_id, path, parent_path, name, kind, size, version_id, media_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
        scope.workspaceId,
        relative,
        workspaceParentPath(relative),
        workspaceBaseName(relative),
        data.byteLength,
        versionId,
        mediaType,
        now,
        now,
      );
    } else {
      this.sql.exec(
        `UPDATE ${NODES_TABLE}
            SET size = ?, version_id = ?, media_type = ?, updated_at = ?
          WHERE workspace_id = ? AND path = ?`,
        data.byteLength,
        versionId,
        mediaType,
        now,
        scope.workspaceId,
        relative,
      );
    }
    return {
      absolutePath: workspaceAbsolutePath(scope.root, relative),
      version: versionId,
      bytes: data.byteLength,
    };
  }

  /**
   * Whether any file node exists in one Workspace.
   * @param scope - Workspace to inspect.
   * @returns true when at least one regular file node exists.
   */
  hasFiles(scope: WorkspaceFileScope): boolean {
    const rows = this.sql.exec(
      `SELECT 1 AS present FROM ${NODES_TABLE} WHERE workspace_id = ? AND kind = 'file' LIMIT 1`,
      scope.workspaceId,
    ).toArray();
    return rows.length > 0;
  }

  /** Resolve canonical relative paths into parent directory entries, outermost first. */
  private parentDirectories(relative: string): Array<{ path: string; parentPath: string; name: string }> {
    const segments = relative.split("/");
    const directories: Array<{ path: string; parentPath: string; name: string }> = [];
    for (let index = 1; index < segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      directories.push({ path, parentPath: workspaceParentPath(path), name: segments[index - 1]! });
    }
    return directories;
  }

  /** Load one node row joined with the current version's R2 object key. */
  private nodeAt(workspaceId: string, relative: string): WorkspaceFileNode | undefined {
    const row = this.sql.exec(
      `SELECT n.path, n.parent_path, n.name, n.kind, n.size, n.version_id, n.media_type, n.updated_at, v.object_key
         FROM ${NODES_TABLE} n
         LEFT JOIN ${VERSIONS_TABLE} v ON v.version_id = n.version_id
        WHERE n.workspace_id = ? AND n.path = ?`,
      workspaceId,
      relative,
    ).toArray().at(0);
    return row === undefined ? undefined : toNode(row);
  }

  /** Resolve one requested path to a regular file node. */
  private requireFileNode(scope: WorkspaceFileScope, path: string): WorkspaceFileNode {
    const relative = workspaceRelativePath(scope.root, path);
    const node = this.nodeAt(scope.workspaceId, relative);
    if (node === undefined) throw new WorkspaceFileError("workspace-file/not-found", `no workspace entry at "${path}"`);
    if (node.kind !== "file") throw new WorkspaceFileError("workspace-file/not-regular-file", `"${path}" is a directory`);
    return node;
  }

  /** Build the public stat of one node, falling back to a derived token only without a version row. */
  private statOf(scope: WorkspaceFileScope, node: WorkspaceFileNode): WorkspaceFileStat {
    return {
      absolutePath: workspaceAbsolutePath(scope.root, node.relPath),
      version: node.versionId ?? `${node.updatedAt}:${node.size}`,
      bytes: node.size,
    };
  }

  /** The configured R2 binding, or the `unavailable` failure when absent. */
  private requireBucket(): R2BucketLike {
    if (this.bucket === undefined) {
      throw new WorkspaceFileError("workspace-file/unavailable", "workspace file storage is not configured (FILES R2 binding missing)");
    }
    return this.bucket;
  }

  /** Read the complete bytes of one file version from R2. */
  private async readObject(node: WorkspaceFileNode, path: string): Promise<Uint8Array> {
    const bucket = this.requireBucket();
    if (node.objectKey === undefined) throw new WorkspaceFileError("workspace-file/not-found", `no content for "${path}"`);
    const object = await bucket.get(node.objectKey);
    if (object === null) throw new WorkspaceFileError("workspace-file/not-found", `no stored content for "${path}"`);
    return new Uint8Array(await object.arrayBuffer());
  }
  /**
   * Delete immutable versions older than a cutoff that no node still points at,
   * including their R2 objects. The latest version of every live file is
   * retained because the node row references it.
   * @param input - cutoff age, batch limit, and optional R2 delete toggle.
   * @returns deleted metadata and object counts.
   */
  async pruneVersions(input: { olderThanMs?: number; limit?: number } = {}): Promise<{ deletedVersions: number; deletedObjects: number }> {
    const cutoff = Date.now() - Math.max(0, input.olderThanMs ?? 30 * 24 * 60 * 60 * 1000);
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const rows = this.sql.exec(
      `SELECT v.version_id, v.object_key FROM ${VERSIONS_TABLE} v
        WHERE v.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM ${NODES_TABLE} n
            WHERE n.workspace_id = v.workspace_id AND n.path = v.path AND n.version_id = v.version_id)
        ORDER BY v.created_at LIMIT ?`,
      cutoff,
      limit,
    ).toArray() as Array<{ version_id: string; object_key: string }>;
    if (rows.length === 0) return { deletedVersions: 0, deletedObjects: 0 };
    for (const row of rows) this.sql.exec(`DELETE FROM ${VERSIONS_TABLE} WHERE version_id = ?`, row.version_id);
    let deletedObjects = 0;
    if (this.bucket !== undefined) {
      for (const row of rows) {
        try { await this.bucket.delete(row.object_key); deletedObjects += 1; } catch { /* metadata is already gone; R2 cleanup is best-effort */ }
      }
    }
    return { deletedVersions: rows.length, deletedObjects };
  }

}
