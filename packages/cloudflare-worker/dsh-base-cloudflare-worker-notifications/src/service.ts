import {hash, notificationConfig, NotificationError, type Channel, type DeliveryState, type NotificationEnv} from './config.ts';
import {createNotificationTransport, type NotificationTransport, type PaymentNotice} from './provider.ts';
export interface NotificationPayment extends PaymentNotice {readonly scope: string; readonly eventId: string; readonly payloadHash: string}
export interface SafeDelivery {id: string; channel: Channel; kind: 'payment'; orderId: string; state: DeliveryState; attempts: number; createdAt: number; updatedAt: number}
interface DeliveryRow {
  id: string; event_key: string; channel: Channel; destination_hash: string; kind: 'payment'; order_id: string;
  payload_json: string; state: DeliveryState; attempts: number; created_at: number; updated_at: number;
}
export interface NotificationsService {
  status(env: unknown): {enabled: boolean; ready: boolean; channels: {discord: boolean; feishu: boolean}};
  /** Statements must be appended to the same D1 transaction as the matching payment receipt. */
  paymentStatements(env: unknown, notice: NotificationPayment): Promise<readonly D1PreparedStatement[]>;
  flush(env: unknown, eventKey: string): Promise<void>;
  list(env: unknown): Promise<SafeDelivery[]>;
  retry(env: unknown, id: string, expectedAttempts: number, reviewedUncertain: boolean): Promise<void>;
}
function primary(env: unknown): D1DatabaseSession {
  const db = (env as NotificationEnv)?.AUTH_DB;
  if (!db) throw new NotificationError(503, 'notifications_unavailable');
  return db.withSession('first-primary');
}
export function createNotifications(transport: NotificationTransport = createNotificationTransport()): NotificationsService {
  async function deliver(env: unknown, id: string): Promise<void> {
    const config = notificationConfig((env ?? {}) as NotificationEnv);
    if (!config) return;
    const db = primary(env);
    const row = await db.prepare('SELECT * FROM dsh_notification_outbox WHERE id=?').bind(id).first<DeliveryRow>();
    if (!row || row.state !== 'pending') return;
    const target = config.destinations.find(target => target.channel === row.channel);
    if (!target || await hash(target.url) !== row.destination_hash) return;
    const claimed = await db.prepare(`UPDATE dsh_notification_outbox SET state='sending',attempts=attempts+1,updated_at=?
      WHERE id=? AND state='pending' AND attempts=? RETURNING attempts`).bind(Date.now(), id, row.attempts).first<{attempts: number}>();
    if (!claimed) return;
    let outcome: 'accepted' | 'rejected' | 'uncertain' = 'uncertain';
    try { outcome = await transport(target, JSON.parse(row.payload_json) as PaymentNotice); } catch { /* Durable uncertain result, never automatic retry. */ }
    await db.prepare(`UPDATE dsh_notification_outbox SET state=?,updated_at=? WHERE id=? AND state='sending' AND attempts=?`)
      .bind(outcome, Date.now(), id, claimed.attempts).run();
  }
  return {
    status(env) {
      const typed = (env ?? {}) as NotificationEnv; const config = notificationConfig(typed);
      return {enabled: typed.NOTIFICATIONS_ENABLED === 'true', ready: config !== undefined,
        channels: {discord: config?.destinations.some(value => value.channel === 'discord') ?? false, feishu: config?.destinations.some(value => value.channel === 'feishu') ?? false}};
    },
    async paymentStatements(env, notice) {
      const config = notificationConfig((env ?? {}) as NotificationEnv);
      if (!config) return [];
      const db = primary(env); const eventKey = `${notice.scope}:${notice.eventId}`;
      const payload: PaymentNotice = {eventType: notice.eventType, orderId: notice.orderId, planId: notice.planId, status: notice.status, refunded: notice.refunded};
      return Promise.all(config.destinations.map(async target => {
        const destinationHash = await hash(target.url);
        const id = await hash(`${eventKey}:${target.channel}:${destinationHash}`);
        return db.prepare(`INSERT INTO dsh_notification_outbox
          (id,event_key,channel,destination_hash,kind,order_id,payload_json,state,attempts,created_at,updated_at)
          SELECT ?,?,?,?,'payment',?,?,'pending',0,?,? WHERE EXISTS
            (SELECT 1 FROM dsh_waffo_events WHERE scope=? AND id=? AND payload_hash=?)
          ON CONFLICT(id) DO NOTHING`).bind(id, eventKey, target.channel, destinationHash, notice.orderId, JSON.stringify(payload), Date.now(), Date.now(), notice.scope, notice.eventId, notice.payloadHash);
      }));
    },
    async flush(env, eventKey) {
      if (!notificationConfig((env ?? {}) as NotificationEnv)) return;
      const rows = await primary(env).prepare("SELECT id FROM dsh_notification_outbox WHERE event_key=? AND state='pending' LIMIT 2").bind(eventKey).all<{id: string}>();
      await Promise.all(rows.results.map(row => deliver(env, row.id)));
    },
    async list(env) {
      const rows = await primary(env).prepare('SELECT * FROM dsh_notification_outbox ORDER BY created_at DESC LIMIT 100').all<DeliveryRow>();
      return rows.results.map(row => ({id: row.id, channel: row.channel, kind: row.kind, orderId: row.order_id, state: row.state, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at}));
    },
    async retry(env, id, expectedAttempts, reviewedUncertain) {
      const config = notificationConfig((env ?? {}) as NotificationEnv);
      if (!config) throw new NotificationError(503, 'notifications_unavailable');
      const db = primary(env);
      const row = await db.prepare('SELECT * FROM dsh_notification_outbox WHERE id=?').bind(id).first<DeliveryRow>();
      if (!row) throw new NotificationError(404, 'notification_not_found');
      if (row.state === 'accepted') throw new NotificationError(409, 'notification_already_accepted');
      if (row.attempts !== expectedAttempts) throw new NotificationError(409, 'notification_revision_conflict');
      if ((row.state === 'uncertain' || row.state === 'sending') && !reviewedUncertain) throw new NotificationError(409, 'notification_review_required');
      if (row.state === 'sending' && Date.now() - row.updated_at < 15_000) throw new NotificationError(409, 'notification_in_flight');
      const target = config.destinations.find(target => target.channel === row.channel);
      if (!target || await hash(target.url) !== row.destination_hash) throw new NotificationError(409, 'notification_destination_changed');
      const result = await db.prepare("UPDATE dsh_notification_outbox SET state='pending',updated_at=? WHERE id=? AND state=? AND attempts=?")
        .bind(Date.now(), id, row.state, row.attempts).run();
      if (result.meta.changes !== 1) throw new NotificationError(409, 'notification_revision_conflict');
      await deliver(env, id);
    },
  };
}
