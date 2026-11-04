/**
 * Encrypted per-owner credential storage for the Workers-native Session Host.
 *
 * Values are AES-GCM encrypted with the Worker-level `CREDENTIALS_KEY` secret
 * and only the ciphertext/IV are persisted in Durable Object SQLite. No remote
 * read path returns a plaintext value; the Agent claim uses the internal
 * `get` path to hand a key to the model runtime.
 */
import type { SqlStorage } from "./sqlite-storage.ts";

/** One redacted credential state for a reference. */
export interface CredentialInfo {
  /** Whether a value is stored. */
  readonly configured: boolean;
  /** Whether this provider can write the reference. */
  readonly writable: boolean;
  /** Source layer; always this Host's encrypted store when configured. */
  readonly source?: string;
}

/** Stable failure for a rejected credential write/read. */
export class CredentialError extends Error {
  /** Stable Remote failure code. */
  readonly code = "credential/rejected";

  /**
   * @param message - diagnostic that never contains the value.
   */
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

const TABLE = "dsh_session_host_credentials";
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_VALUE_BYTES = 16 * 1024;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode the configured key: base64-encoded 32 raw bytes. */
function decodeKey(secret: string): Uint8Array {
  const bytes = base64ToBytes(secret.trim());
  if (bytes.byteLength !== 32) throw new Error("CREDENTIALS_KEY must decode to 32 bytes");
  return bytes;
}

/** AES-GCM credential store over one owner's SQLite storage. */
export class CredentialStore {
  private readonly sql: SqlStorage;
  private readonly secret: string | undefined;
  private keyPromise: Promise<CryptoKey> | undefined;

  /**
   * @param sql - Durable Object SQL executor.
   * @param secret - base64 `CREDENTIALS_KEY`; undefined disables writes.
   */
  constructor(sql: SqlStorage, secret: string | undefined) {
    this.sql = sql;
    this.secret = secret === undefined || secret === "" ? undefined : secret;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      ref TEXT PRIMARY KEY,
      iv TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  /** Whether the encryption key is configured. */
  get writable(): boolean {
    return this.secret !== undefined;
  }

  private key(): Promise<CryptoKey> {
    if (this.secret === undefined) return Promise.reject(new CredentialError("credential storage is not configured"));
    this.keyPromise ??= crypto.subtle.importKey("raw", decodeKey(this.secret), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return this.keyPromise;
  }

  /**
   * Describe a batch of references without reading values.
   * @param refs - reference names.
   * @returns one redacted state per reference.
   */
  describe(refs: readonly string[]): Record<string, CredentialInfo> {
    const entries: Record<string, CredentialInfo> = {};
    const writable = this.writable;
    for (const ref of refs) {
      if (!REF_PATTERN.test(ref)) throw new CredentialError(`invalid credential reference: ${ref}`);
      const row = this.sql.exec(`SELECT 1 AS present FROM ${TABLE} WHERE ref = ?`, ref).toArray().at(0);
      entries[ref] = {
        configured: row !== undefined,
        writable,
        ...(row === undefined ? {} : { source: "host" }),
      };
    }
    return entries;
  }

  /**
   * Encrypt and store one credential value.
   * @param ref - reference name.
   * @param value - non-empty secret value.
   * @throws CredentialError when storage is disabled or input is invalid.
   */
  async set(ref: string, value: string): Promise<void> {
    if (!REF_PATTERN.test(ref)) throw new CredentialError(`invalid credential reference: ${ref}`);
    if (typeof value !== "string" || value.trim() === "") throw new CredentialError("credential value must be non-empty");
    if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) throw new CredentialError("credential value is too large");
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
    this.sql.exec(
      `INSERT INTO ${TABLE} (ref, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      ref,
      bytesToBase64(iv),
      bytesToBase64(ciphertext),
      Date.now(),
    );
  }

  /**
   * Remove one credential. Unknown references succeed.
   * @param ref - reference name.
   */
  unset(ref: string): void {
    if (!REF_PATTERN.test(ref)) throw new CredentialError(`invalid credential reference: ${ref}`);
    this.sql.exec(`DELETE FROM ${TABLE} WHERE ref = ?`, ref);
  }

  /**
   * Decrypt one stored value for an internal caller (never a Remote read).
   * @param ref - reference name.
   * @returns the plaintext value or undefined when unset.
   * @throws CredentialError when the stored value cannot be decrypted.
   */
  async get(ref: string): Promise<string | undefined> {
    if (!REF_PATTERN.test(ref)) throw new CredentialError(`invalid credential reference: ${ref}`);
    const row = this.sql.exec(`SELECT iv, ciphertext FROM ${TABLE} WHERE ref = ?`, ref).toArray().at(0);
    if (row === undefined) return undefined;
    const key = await this.key();
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(String(row.iv)) },
        key,
        base64ToBytes(String(row.ciphertext)),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new CredentialError(`credential "${ref}" cannot be decrypted`);
    }
  }
}
