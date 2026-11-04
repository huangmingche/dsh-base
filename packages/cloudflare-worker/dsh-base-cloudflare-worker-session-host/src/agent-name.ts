/**
 * Owner-scoped Agent Durable Object naming.
 *
 * The browser only ever knows its Session id; the Worker maps it to an Agent DO
 * name that also carries the authenticated Better Auth user id. Two accounts
 * that pick the same Session id therefore get different Agent instances, and a
 * forged `/agents/...` name cannot cross the owner boundary.
 */

/** Prefix of every owner-named Agent Durable Object. */
export const AGENT_OWNER_PREFIX = "owner:";

/**
 * Build the Agent Durable Object name for one Session.
 * @param ownerId - authenticated Better Auth user id, if known.
 * @param sessionId - durable Session id.
 * @returns `owner:<userId>:<sessionId>` when the owner is known.
 */
export function agentName(ownerId: string | undefined, sessionId: string): string {
  return ownerId === undefined ? sessionId : `${AGENT_OWNER_PREFIX}${ownerId}:${sessionId}`;
}

/**
 * Read the owner user id encoded in a Session Host Durable Object name.
 * @param name - `state.id.name`, for example `owner:<userId>:default-v23`.
 * @returns the user id, or undefined for a non-owner instance or test double.
 */
export function ownerIdOf(name: string | undefined): string | undefined {
  if (typeof name !== "string" || !name.startsWith(AGENT_OWNER_PREFIX)) return undefined;
  const rest = name.slice(AGENT_OWNER_PREFIX.length);
  const separator = rest.indexOf(":");
  return separator === -1 || separator === 0 ? undefined : rest.slice(0, separator);
}

/**
 * Whether a client-supplied Agent DO name already belongs to the owner.
 * @param name - DO name taken from the request path.
 * @param ownerId - authenticated user id.
 * @returns true when the name is prefixed with this owner.
 */
export function isOwnedAgentName(name: string, ownerId: string): boolean {
  return name.startsWith(`${AGENT_OWNER_PREFIX}${ownerId}:`);
}
