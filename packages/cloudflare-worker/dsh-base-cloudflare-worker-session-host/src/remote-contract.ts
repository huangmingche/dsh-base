/** Failure vocabulary shared by the official Session RPC bridge and its mapping. */

/**
 * One bridge failure that must cross the RPC envelope with a stable code.
 *
 * The generic wire-RPC plugin recognizes any thrown Error carrying `code`
 * and `details`, so this package keeps no runtime dependency on it.
 */
export class SessionRpcFault extends Error {
  /** Official cross-realm RemoteError discriminator used by the reused HTTP upload handler. */
  readonly isDSHRemoteError = true;
  /** Remote failure code returned to the client. */
  readonly code: string;
  /** JSON-safe failure context. */
  readonly details: Record<string, unknown>;

  /**
   * @param code - Remote failure code.
   * @param message - diagnostic for the caller.
   * @param details - JSON-safe context for the failure.
   */
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SessionRpcFault";
    this.code = code;
    this.details = details;
  }
}
