/** Durable logical workspace directories; no host OS filesystem is implied. */
import type { DirectoryListing } from "@deepseek-ai/dsh-host-directory-picker/types";
import type { SqlStorage } from "./sqlite-storage.ts";
import { SessionRpcFault } from "./remote-contract.ts";

/** POSIX-like absolute identity. Path composition stays on the Host. */
export function canonicalDirectoryPath(value: string): string {
  if (value.length > 4096 || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(value)) throw new Error("directory path must be an absolute logical path");
  const segments: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `/${segments.join("/")}`;
}

function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return ["/", ...parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`)];
}

/** Same owner SQLite, separate from registered Workspaces until a user selects one. */
export class LogicalDirectoryStore {
  private readonly sql: SqlStorage;
  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS dsh_session_host_directories (path TEXT PRIMARY KEY)");
  }

  /** Include legacy Workspace paths without changing their identities or creating new workspaces. */
  private known(): Set<string> {
    const known = new Set<string>(["/"]);
    const rows = this.sql.exec("SELECT path FROM dsh_session_host_directories UNION SELECT path FROM dsh_session_host_workspaces").toArray();
    for (const row of rows) {
      try { for (const path of ancestors(canonicalDirectoryPath(String(row.path)))) known.add(path); }
      catch { /* A legacy non-POSIX Workspace remains registered, outside this logical browser. */ }
    }
    return known;
  }

  remember(path: string): void {
    try { path = canonicalDirectoryPath(path); } catch { return; }
    this.sql.exec("INSERT OR IGNORE INTO dsh_session_host_directories (path) VALUES (?)", path);
  }

  list(input?: string): DirectoryListing {
    let path: string;
    try { path = canonicalDirectoryPath(input ?? "/"); }
    catch { throw new SessionRpcFault("directory-picker/unreadable", "Directory path must be absolute", { path: input }); }
    const known = this.known();
    if (!known.has(path)) throw new SessionRpcFault("directory-picker/unreadable", "Logical directory does not exist", { path });
    const prefix = path === "/" ? "/" : `${path}/`;
    const children = [...known].filter(candidate => candidate !== path && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"));
    const rows = children.map(child => ({ name: child.slice(prefix.length), path: child, hidden: child.slice(prefix.length).startsWith(".") })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      path, home: "/", crumbs: ancestors(path).map(ancestor => ({ name: ancestor === "/" ? "/" : ancestor.slice(ancestor.lastIndexOf("/") + 1), path: ancestor, hidden: false })),
      entries: rows.slice(0, 1000), truncated: rows.length > 1000,
    };
  }

  create(parentInput: string, name: string): string {
    if (name.trim() === "" || name === "." || name === ".." || /[/\\\u0000-\u001f\u007f]/u.test(name)) throw new SessionRpcFault("gateway/bad-request", "Directory name must be one non-blank path segment", { path: parentInput });
    let parent: string;
    try { parent = canonicalDirectoryPath(parentInput); }
    catch { throw new SessionRpcFault("directory-picker/create-failed", "Parent path must be absolute", { path: parentInput }); }
    const target = `${parent === "/" ? "" : parent}/${name}`;
    if (target.length > 4096) throw new SessionRpcFault("directory-picker/create-failed", "Directory path is too long", { path: target });
    const create = () => {
      const known = this.known();
      if (!known.has(parent)) throw new SessionRpcFault("directory-picker/create-failed", "Parent directory does not exist", { path: target });
      if (known.has(target)) throw new SessionRpcFault("directory-picker/exists", "Directory already exists", { path: target });
      this.sql.exec("INSERT INTO dsh_session_host_directories (path) VALUES (?)", target);
      return target;
    };
    return this.sql.transactionSync === undefined ? create() : this.sql.transactionSync(create);
  }
}
