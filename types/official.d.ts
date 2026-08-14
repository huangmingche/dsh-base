/**
 * Minimal official type surface for the rc.6 persistence fork.
 *
 * The runtime always resolves these packages from the pinned rc.6 submodule
 * source (scripts/build.mjs); these declarations only let the fork and its host
 * adapter compile inside this tree.
 */
declare module "@deepseek-ai/dsh-session" {
  export default class SessionStore { constructor(ctx: unknown, config?: unknown); }
  export type SessionId = string & { readonly __sessionId: unique symbol };
  export type SurfaceOp = unknown;
  export type SurfaceEventType = string;
  export interface SessionHeader {
    version: number;
    id: SessionId;
    createdAt: number;
    cwd?: string;
    parentSession?: SessionId;
    seedLength?: number;
    origin?: "subagent";
    delegationDepth?: number;
    agentPreset?: string;
  }
  export interface SessionEvent<T = string> {
    type: T;
    seq: number;
    time: number;
    data: unknown;
    sourceEventSeqs?: number[];
    surfaceOp?: SurfaceOp;
    ignorable?: true;
  }
  export class SessionPreparation {
    static create(value: unknown): SessionPreparation;
  }
}

declare module "@deepseek-ai/dsh-session-persistence" {
  import type { Context, Service } from "@deepseek-ai/cordis";
  import type { SessionEvent, SessionId, SessionHeader, SessionPreparation } from "@deepseek-ai/dsh-session";

  export interface SessionLocation { readonly kind: string; readonly path: string }
  export interface SessionPersistenceSnapshot { readonly header: SessionHeader; readonly revision: unknown }
  export interface SessionInspection { readonly meta: SessionHeader; readonly events: SessionEvent[] }
  export interface StoredPrefix<T = number> {
    readonly meta: SessionHeader;
    readonly events: SessionEvent[];
    readonly revision: unknown;
    readonly tornMarker?: T;
  }
  export interface StoredSuffix { readonly meta: SessionHeader; readonly events: SessionEvent[] }
  export interface SessionPersistenceRevision { readonly value: string }
  export function SessionPersistenceRevision(value: string): SessionPersistenceRevision;
  export interface PersistenceBackend<T> {
    loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<T> | undefined>;
    loadStoredFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined>;
    appendBatch(meta: SessionHeader, events: readonly SessionEvent[], materialized: boolean): Promise<void>;
    commitRepair(meta: SessionHeader, tornMarker: T | undefined, closers: readonly SessionEvent[]): Promise<void>;
  }
  export class PersistenceCoordinator<T> {
    constructor(ctx: Context, backend: PersistenceBackend<T>, options: { preparedSessionCacheSize: number; writeBatchMaxDelayMs: number });
    create(meta: SessionHeader): Promise<void>;
    append(id: SessionId, events: readonly SessionEvent[]): Promise<void>;
    prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>;
    load(id: SessionId): Promise<SessionInspection>;
    inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>;
    readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>;
  }
  export abstract class SessionPersistence extends Service {
    abstract readonly supportsRawArtifacts: boolean;
    abstract locate(meta: SessionHeader): SessionLocation | undefined;
    abstract create(meta: SessionHeader): Promise<void>;
    abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>;
    abstract load(id: SessionId): Promise<SessionInspection>;
    abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>;
    abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>;
    abstract list(signal?: AbortSignal): Promise<SessionHeader[]>;
    abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>;
    prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>;
  }
  export const DEFAULT_PREPARED_SESSION_CACHE_SIZE: number;
  export const DEFAULT_WRITE_BATCH_MAX_DELAY_MS: number;
  export const MAX_WRITE_BATCH_DELAY_MS: number;
}
