/**
 * Chat-reference discovery shared by the session adapter and its tests.
 *
 * The official `@` menu asks the Host for file candidates for the current
 * Session and for other Sessions it can reference. These helpers keep the wire
 * shapes plain so the adapter can stay a thin composition seam.
 */

/** Structural transport the discovery helpers need. */
export interface ReferenceTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** One file or directory candidate accepted by the official mention menu. */
export interface FileReferenceCandidateLike {
  readonly path: string;
  readonly kind: "file" | "directory";
}

/** One other-Session candidate carrying its canonical mention. */
export interface SessionReferenceCandidateLike {
  readonly sessionId: string;
  readonly label: string;
  readonly displayTitle: string;
  readonly cwd?: string;
  readonly sameWorkspace: boolean;
  readonly createdAt: number;
  readonly mention: string;
}

/**
 * List workspace file/directory candidates for one `@` query.
 * @param transport - owner-scoped Host transport.
 * @param sessionId - Session whose Workspace is searched.
 * @param query - raw path text after `@`.
 * @param signal - caller cancellation.
 * @returns candidates sorted by path.
 */
export async function fileReferenceCandidates(
  transport: ReferenceTransport,
  sessionId: string,
  query: string,
  signal: AbortSignal,
): Promise<FileReferenceCandidateLike[]> {
  const normalized = query.replace(/^\.\//u, "");
  const separator = normalized.lastIndexOf("/");
  const directoryPart = separator === -1 ? "" : normalized.slice(0, separator);
  const leaf = (separator === -1 ? normalized : normalized.slice(separator + 1)).toLowerCase();
  const results: FileReferenceCandidateLike[] = [];
  const directories: Array<{ path: string; depth: number }> = [{ path: directoryPart, depth: 0 }];
  let inspected = 0;
  while (directories.length > 0 && results.length < 300 && inspected < 400) {
    signal.throwIfAborted();
    const current = directories.shift()!;
    inspected += 1;
    const page = await transport.request("workspaceFileList", { sessionId, path: current.path }) as {
      entries?: Array<{ name: string; type: "file" | "directory" }>;
    };
    // A cancelled/failed traversal is not an authoritative empty or partial
    // search result. The official menu must keep the failure semantics.
    signal.throwIfAborted();
    for (const entry of page.entries ?? []) {
      const entryPath = current.path === "" ? entry.name : `${current.path}/${entry.name}`;
      if (entry.type === "directory" && current.depth < 3) directories.push({ path: entryPath, depth: current.depth + 1 });
      if (leaf === "" || entry.name.toLowerCase().includes(leaf)) results.push({ path: entryPath, kind: entry.type });
      if (results.length >= 300) break;
    }
  }
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * List other Sessions that can be mentioned with `@`.
 * @param transport - owner-scoped Host transport.
 * @param sessionId - Session being typed in (excluded from candidates).
 * @param query - raw mention text after `@`.
 * @returns at most 20 candidates ordered as the Host listed them.
 */
export async function sessionReferenceCandidates(
  transport: ReferenceTransport,
  sessionId: string,
  query: string,
): Promise<SessionReferenceCandidateLike[]> {
  const listed = await transport.request("list", {}) as {
    sessions?: ReadonlyArray<{ sessionId: string; title: string; updatedAt?: number; createdAt?: number; cwd?: string }>;
  };
  const needle = query.trim().toLowerCase();
  return (listed.sessions ?? [])
    .filter((session) => session.sessionId !== sessionId && (needle === "" || session.title.toLowerCase().includes(needle)))
    .slice(0, 20)
    .map((session) => ({
      sessionId: session.sessionId,
      label: session.title,
      displayTitle: session.title,
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
      sameWorkspace: false,
      createdAt: session.createdAt ?? session.updatedAt ?? Date.now(),
      mention: `@[${session.title}](dsh-session:${session.sessionId})`,
    }));
}
