/** Real logical R2 file boundary. This service makes no shell or POSIX claim. */
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval';

export interface PermissionSnapshot {
  readonly currentValue: string;
  readonly sandbox: SandboxMode;
  readonly approval: ApprovalPolicy;
}

export interface FilePermissionOperation {
  readonly ownerId: string;
  readonly targetOwnerId: string;
  readonly sessionWorkspaceId: string;
  readonly targetWorkspaceId: string;
  readonly sessionWorkspaceRoot: string;
  readonly targetWorkspaceRoot: string;
  readonly path: string;
  readonly write: boolean;
}

export class PermissionDeniedError extends Error {
  readonly code = 'permission/denied';
  constructor(readonly reason: 'owner' | 'path' | 'read-only' | 'outside-workspace' | 'approval-disabled' | 'invalid-state') {
    super(`Permission denied: ${reason}`); this.name = 'PermissionDeniedError';
  }
}

function rootPath(value: string): string {
  if (!value.startsWith('/') || value.includes('\\') || value.includes('\0')) throw new PermissionDeniedError('path');
  const trimmed = value === '/' ? '' : value.replace(/\/$/u, '');
  if (trimmed.split('/').slice(1).some(part => part === '' || part === '.' || part === '..')) throw new PermissionDeniedError('path');
  return trimmed || '/';
}

/** Resolve exactly one object path without traversal, implicit URL decoding or symlinks. */
export function permissionFilePath(root: string, path: string): string {
  const base = rootPath(root);
  if (path.includes('\\') || path.includes('\0')) throw new PermissionDeniedError('path');
  const candidate = path === '' || path === '/' ? base : path.startsWith('/') ? path : `${base === '/' ? '' : base}/${path}`;
  const absolute = rootPath(candidate);
  if (base !== '/' && absolute !== base && !absolute.startsWith(base + '/')) throw new PermissionDeniedError('path');
  return absolute;
}

/** Called with the latest durable session policy immediately before each file effect. */
export function assertFilePermission(snapshot: PermissionSnapshot, operation: FilePermissionOperation): string {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(snapshot.sandbox)
    || !['ask', 'never'].includes(snapshot.approval)) throw new PermissionDeniedError('invalid-state');
  if (operation.ownerId === '' || operation.ownerId !== operation.targetOwnerId) throw new PermissionDeniedError('owner');
  const absolute = permissionFilePath(operation.targetWorkspaceRoot, operation.path);
  const sessionRoot = rootPath(operation.sessionWorkspaceRoot);
  if (!operation.write) return absolute;
  if (snapshot.sandbox === 'read-only') throw new PermissionDeniedError('read-only');
  if (snapshot.sandbox === 'workspace-write' && (operation.sessionWorkspaceId === ''
    || operation.sessionWorkspaceId !== operation.targetWorkspaceId
    || (sessionRoot !== '/' && absolute !== sessionRoot && !absolute.startsWith(sessionRoot + '/')))) {
    throw new PermissionDeniedError('outside-workspace');
  }
  return absolute;
}

/** `never` rejects operations requiring consent; it never grants them. */
export function assertApprovalCanBeAsked(snapshot: PermissionSnapshot): void {
  if (snapshot.approval !== 'ask') throw new PermissionDeniedError(snapshot.approval === 'never' ? 'approval-disabled' : 'invalid-state');
}

export class LogicalR2PermissionExecutor {
  readonly sandboxMode: SandboxMode = 'workspace-write';
  assertFilePermission = assertFilePermission;
  assertApprovalCanBeAsked = assertApprovalCanBeAsked;
}

declare module '@deepseek-ai/cordis' {
  interface Context { permissionExecutor: LogicalR2PermissionExecutor }
}
