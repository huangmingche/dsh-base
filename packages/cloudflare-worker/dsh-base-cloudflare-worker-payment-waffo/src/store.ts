import { PaymentError, type PaymentConfig, type PaymentPlan } from './config.ts';
export interface CheckoutRow {
  scope: string; id: string; user_id: string; request_key: string; request_hash: string;
  plan_id: string; product_id: string; kind: PaymentPlan['type']; currency: string; created_at: number;
}
export interface OrderRow {
  id: string; user_id: string; checkout_id: string; plan_id: string; kind: PaymentPlan['type'];
  status: string; period_end: string | null; refunded: number; eligible: number;
  superseded_by: string | null; revision: number; last_event: string; updated_at: number;
}
export interface AccountOrder {
  id: string; planId: string; type: PaymentPlan['type']; status: string;
  periodEnd: string | null; refunded: boolean; entitled: boolean;
}
export function accountOrder(row: OrderRow, now = Date.now()): AccountOrder {
  return { id: row.id, planId: row.plan_id, type: row.kind, status: row.status,
    periodEnd: row.period_end, refunded: row.refunded === 1,
    entitled: row.eligible === 1 && !row.superseded_by && (row.kind === 'one_time' || (row.period_end !== null && Date.parse(row.period_end) > now)) };
}
export class PaymentStore {
  readonly config: PaymentConfig;
  private readonly db: D1DatabaseSession;
  constructor(config: PaymentConfig) { this.config = config; this.db = config.db.withSession("first-primary"); }
  private statement(sql: string, ...values: (string | number | null)[]) { return this.db.prepare(sql).bind(...values); }
  async reserveCheckout(user: string, key: string, hash: string, plan: PaymentPlan): Promise<CheckoutRow> {
    const id = crypto.randomUUID();
    await this.statement(`INSERT INTO dsh_waffo_checkouts
      (scope,id,user_id,request_key,request_hash,plan_id,product_id,kind,currency,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,user_id,request_key) DO NOTHING`,
    this.config.scope, id, user, key, hash, plan.id, plan.productId, plan.type, plan.currency, Date.now()).run();
    const row = await this.statement('SELECT * FROM dsh_waffo_checkouts WHERE scope=? AND user_id=? AND request_key=?', this.config.scope, user, key).first<CheckoutRow>();
    if (!row) throw new Error('checkout storage unavailable');
    if (row.request_hash !== hash) throw new PaymentError(409, 'idempotency_conflict');
    // Waffo caches successful keys for 24h. Never reuse a key after that cache
    // can expire, including an ambiguous network failure on the first attempt.
    if (Date.now() - row.created_at > 23 * 60 * 60 * 1000) throw new PaymentError(409, 'idempotency_expired');
    return row;
  }
  checkout(id: string) { return this.statement('SELECT * FROM dsh_waffo_checkouts WHERE scope=? AND id=?', this.config.scope, id).first<CheckoutRow>(); }
  order(id: string) { return this.statement('SELECT * FROM dsh_waffo_orders WHERE scope=? AND id=?', this.config.scope, id).first<OrderRow>(); }
  async account(user: string): Promise<AccountOrder[]> {
    const rows = await this.statement('SELECT * FROM dsh_waffo_orders WHERE scope=? AND user_id=? ORDER BY updated_at DESC LIMIT 100', this.config.scope, user).all<OrderRow>();
    return rows.results.map(row => accountOrder(row));
  }
  async allows(user: string, planIds: readonly string[]): Promise<boolean> {
    if (planIds.length === 0 || planIds.length > 100) return false;
    const placeholders = planIds.map(() => '?').join(',');
    const row = await this.statement(`SELECT id FROM dsh_waffo_orders WHERE scope=? AND user_id=?
      AND eligible=1 AND superseded_by IS NULL AND plan_id IN (${placeholders})
      AND (kind='one_time' OR (period_end IS NOT NULL AND julianday(period_end)>julianday(?))) LIMIT 1`,
      this.config.scope, user, ...planIds, new Date().toISOString()).first();
    return row !== null;
  }
  async summary(): Promise<{orders: number; activeSubscriptions: number; refundedOrders: number}> {
    const row = await this.statement(`SELECT COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN kind='subscription' AND eligible=1 AND superseded_by IS NULL
        AND period_end IS NOT NULL AND julianday(period_end)>julianday(?) THEN 1 ELSE 0 END),0) AS activeSubscriptions,
      COALESCE(SUM(refunded),0) AS refundedOrders FROM dsh_waffo_orders WHERE scope=?`,
      new Date().toISOString(), this.config.scope).first<{orders: number; activeSubscriptions: number; refundedOrders: number}>();
    if (!row) throw new Error('payment summary unavailable');
    return row;
  }
  async duplicate(id: string, hash: string): Promise<boolean> {
    const row = await this.statement('SELECT payload_hash FROM dsh_waffo_events WHERE scope=? AND id=?', this.config.scope, id).first<{payload_hash: string}>();
    if (row && row.payload_hash !== hash) throw new PaymentError(400, 'event_id_conflict');
    return row !== null;
  }
  /** CAS and receipt share one D1 transaction; a race returns non-2xx for retry. */
  async commit(eventId: string, hash: string, row: Omit<OrderRow, 'revision' | 'last_event' | 'updated_at'>, previous: OrderRow | null, origin?: OrderRow, outbox: readonly D1PreparedStatement[] = []): Promise<void> {
    const revision = (previous?.revision ?? 0) + 1;
    const statement = this.statement(`INSERT INTO dsh_waffo_orders
      (scope,id,user_id,checkout_id,plan_id,kind,status,period_end,refunded,eligible,superseded_by,revision,last_event,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE (? IS NULL OR EXISTS (SELECT 1 FROM dsh_waffo_orders WHERE scope=? AND id=? AND revision=?))
      ON CONFLICT(scope,id) DO UPDATE SET
        plan_id=excluded.plan_id,status=excluded.status,period_end=excluded.period_end,refunded=excluded.refunded,
        eligible=CASE WHEN dsh_waffo_orders.superseded_by IS NULL THEN excluded.eligible ELSE 0 END,
        superseded_by=COALESCE(dsh_waffo_orders.superseded_by,excluded.superseded_by),revision=excluded.revision,
        last_event=excluded.last_event,updated_at=excluded.updated_at
      WHERE dsh_waffo_orders.revision=? AND dsh_waffo_orders.user_id=excluded.user_id
        AND NOT EXISTS (SELECT 1 FROM dsh_waffo_events WHERE scope=? AND id=?)`,
      this.config.scope, row.id, row.user_id, row.checkout_id, row.plan_id, row.kind, row.status, row.period_end,
      row.refunded, row.eligible, row.superseded_by, revision, eventId, Date.now(), origin?.id ?? null, this.config.scope, origin?.id ?? '', origin?.revision ?? 0, previous?.revision ?? 0, this.config.scope, eventId);
    const receipt = this.statement(`INSERT INTO dsh_waffo_events (scope,id,payload_hash,order_id,processed_at)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM dsh_waffo_orders WHERE scope=? AND id=? AND revision=? AND last_event=?)
      ON CONFLICT(scope,id) DO NOTHING`, this.config.scope, eventId, hash, row.id, Date.now(), this.config.scope, row.id, revision, eventId);
    const operations = [statement, receipt];
    if (origin) operations.push(this.statement(`UPDATE dsh_waffo_orders SET superseded_by=?,eligible=0,revision=revision+1
      WHERE scope=? AND id=? AND user_id=? AND revision=? AND EXISTS (SELECT 1 FROM dsh_waffo_events WHERE scope=? AND id=? AND payload_hash=?)`,
      row.id, this.config.scope, origin.id, row.user_id, origin.revision, this.config.scope, eventId, hash));
    const result = await this.db.batch([...operations, ...outbox]);
    if (result[0]?.meta.changes !== 1 || result[1]?.meta.changes !== 1) {
      if (await this.duplicate(eventId, hash)) return;
      throw new PaymentError(503, 'payment_update_conflict');
    }
  }
}
