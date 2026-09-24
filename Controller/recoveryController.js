import { query } from '../config/db.js';

let schemaReady = false;

async function ensureRecoverySchema() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS abandoned_carts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number VARCHAR(15) NOT NULL,
      full_name TEXT,
      user_id TEXT,
      cart_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      cart_total NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      recovered_order_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS abandoned_carts_phone_status_idx
      ON abandoned_carts (phone_number, status)
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS review_request_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL,
      user_id TEXT,
      phone_number VARCHAR(15),
      product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      scheduled_for TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS review_request_queue_order_uidx
      ON review_request_queue (order_id)
  `);
  schemaReady = true;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const n = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

/** Capture cart when checkout is abandoned after phone is known. */
export const upsertAbandonedCart = async (req, res) => {
  try {
    await ensureRecoverySchema();
    const phone = normalizePhone(req.body?.phone_number);
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Valid phone number is required' });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart items are required' });
    }
    const fullName =
      req.body?.full_name != null && String(req.body.full_name).trim()
        ? String(req.body.full_name).trim().slice(0, 120)
        : null;
    const cartTotal = Number(req.body?.cart_total) || 0;
    const userId = req.user?.id || null;

    await query(
      `UPDATE abandoned_carts
       SET status = 'superseded', updated_at = NOW()
       WHERE phone_number = $1 AND status = 'open'`,
      [phone],
    );

    const inserted = await query(
      `INSERT INTO abandoned_carts (phone_number, full_name, user_id, cart_items, cart_total, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'open')
       RETURNING id, phone_number, status, created_at`,
      [phone, fullName, userId, JSON.stringify(items), cartTotal],
    );

    return res.status(201).json({
      success: true,
      message: 'Abandoned cart saved',
      data: inserted.rows[0],
    });
  } catch (err) {
    console.error('upsertAbandonedCart:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** Mark open abandoned carts recovered after a successful order. */
export async function markAbandonedCartsRecovered({ phoneNumber, userId, orderId }) {
  try {
    await ensureRecoverySchema();
    const phone = normalizePhone(phoneNumber);
    if (!phone && !userId) return;
    if (phone) {
      await query(
        `UPDATE abandoned_carts
         SET status = 'recovered', recovered_order_id = $1, updated_at = NOW()
         WHERE phone_number = $2 AND status = 'open'`,
        [orderId || null, phone],
      );
    }
    if (userId) {
      await query(
        `UPDATE abandoned_carts
         SET status = 'recovered', recovered_order_id = COALESCE($1, recovered_order_id), updated_at = NOW()
         WHERE user_id = $2 AND status = 'open'`,
        [orderId || null, userId],
      );
    }
  } catch (err) {
    console.error('markAbandonedCartsRecovered:', err.message);
  }
}

/**
 * Queue a review request ~3 days after delivery.
 * Sending is left to an ops/cron job that reads pending rows.
 */
export async function enqueueReviewRequestForOrder(orderId) {
  try {
    await ensureRecoverySchema();
    if (!orderId) return;

    const orderRes = await query(
      `SELECT o.id, o.user_id, a.receiver_phone
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.id = $1
       LIMIT 1`,
      [orderId],
    );
    const order = orderRes.rows[0];
    if (!order) return;

    const itemsRes = await query(
      'SELECT product_id FROM order_items WHERE order_id = $1',
      [orderId],
    );
    const productIds = (itemsRes.rows || []).map((r) => r.product_id).filter(Boolean);
    const phone = normalizePhone(order.receiver_phone);
    const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO review_request_queue (order_id, user_id, phone_number, product_ids, status, scheduled_for)
       VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        orderId,
        order.user_id || null,
        phone,
        JSON.stringify(productIds),
        scheduledFor.toISOString(),
      ],
    );
  } catch (err) {
    console.error('enqueueReviewRequestForOrder:', err.message);
  }
}

export { ensureRecoverySchema };
