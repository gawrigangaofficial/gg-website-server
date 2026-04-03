import pool, { query } from '../config/db.js';

let schemaEnsured = false;

export async function ensureCashbackSchema() {
  if (schemaEnsured) return;
  // Tables are expected to be created via migrations/manual SQL.
  // We only validate their presence once at runtime.
  await query('SELECT 1 FROM cashback_campaigns LIMIT 1');
  await query('SELECT 1 FROM cashback_campaign_awards LIMIT 1');
  await query('SELECT 1 FROM users LIMIT 1');
  await query('SELECT 1 FROM wallet_transactions LIMIT 1');
  schemaEnsured = true;
}

async function getWalletRow(client, userId) {
  const walletRes = await client.query(
    'SELECT id AS user_id, COALESCE(cashback_amount, 0) AS balance FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  return walletRes.rows[0];
}

function validateCampaignRow(campaign) {
  const now = new Date();
  if (!campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND' };
  if (campaign.status !== 'active') return { ok: false, code: 'CAMPAIGN_NOT_ACTIVE' };
  if (campaign.starts_at && new Date(campaign.starts_at) > now) return { ok: false, code: 'CAMPAIGN_NOT_ACTIVE' };
  if (campaign.ends_at && new Date(campaign.ends_at) < now) return { ok: false, code: 'CAMPAIGN_EXPIRED' };
  if (Number(campaign.awarded_users_count) >= Number(campaign.max_users)) return { ok: false, code: 'MAX_USERS_REACHED' };
  return { ok: true };
}

export async function awardCampaignTx(client, { campaignId, userId, triggerEvent = 'signup', idempotencyKey = null }) {
  const campaignRes = await client.query(
    'SELECT * FROM cashback_campaigns WHERE id = $1 FOR UPDATE',
    [campaignId],
  );
  const campaign = campaignRes.rows[0];
  const campaignValidation = validateCampaignRow(campaign);
  if (!campaignValidation.ok) return { success: false, code: campaignValidation.code };

  const alreadyRes = await client.query(
    'SELECT id, amount, awarded_at FROM cashback_campaign_awards WHERE campaign_id = $1 AND user_id = $2',
    [campaignId, userId],
  );
  if (alreadyRes.rows.length > 0) {
    return { success: false, code: 'ALREADY_AWARDED' };
  }

  const wallet = await getWalletRow(client, userId);
  if (!wallet) return { success: false, code: 'USER_NOT_FOUND' };
  const amount = Number(campaign.cashback_amount);
  const before = Number(wallet.balance);
  const after = before + amount;

  const awardRes = await client.query(
    `INSERT INTO cashback_campaign_awards (campaign_id, user_id, amount, trigger_event, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [campaignId, userId, amount, triggerEvent, idempotencyKey],
  );

  await client.query(
    `INSERT INTO wallet_transactions (user_id, txn_type, source_type, source_id, amount, balance_before, balance_after, remarks)
     VALUES ($1, 'credit', 'cashback_campaign', $2, $3, $4, $5, $6)`,
    [userId, campaignId, amount, before, after, `Cashback from campaign: ${campaign.name}`],
  );

  await client.query(
    'UPDATE users SET cashback_amount = $1 WHERE id = $2',
    [after, userId],
  );

  const updateCampaign = await client.query(
    `UPDATE cashback_campaigns
     SET awarded_users_count = awarded_users_count + 1,
         status = CASE WHEN awarded_users_count + 1 >= max_users THEN 'completed'::cashback_campaign_status ELSE status END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING awarded_users_count`,
    [campaignId],
  );

  return {
    success: true,
    data: {
      award: awardRes.rows[0],
      wallet_balance: after,
      awarded_users_count: updateCampaign.rows[0]?.awarded_users_count ?? campaign.awarded_users_count + 1,
      amount,
    },
  };
}

export const getActiveCampaigns = async (_req, res) => {
  try {
    await ensureCashbackSchema();
    const rows = await query(
      `SELECT *
       FROM cashback_campaigns
       WHERE status = 'active'
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY created_at DESC`,
    );
    res.status(200).json({ success: true, data: rows.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch active campaigns' });
  }
};

export const checkEligibility = async (req, res) => {
  try {
    await ensureCashbackSchema();
    const userId = req.user?.id;
    const campaignId = Number(req.params.id);
    if (!userId) return res.status(401).json({ success: false, code: 'NOT_AUTHENTICATED' });
    if (!campaignId) return res.status(400).json({ success: false, code: 'INVALID_CAMPAIGN_ID' });

    const campaignRes = await query('SELECT * FROM cashback_campaigns WHERE id = $1', [campaignId]);
    const campaignValidation = validateCampaignRow(campaignRes.rows[0]);
    if (!campaignValidation.ok) return res.status(200).json({ success: true, data: { eligible: false, reason_code: campaignValidation.code } });

    // Business rule: cashback only for true first-time buyers (no prior orders)
    const ordersRes = await query(
      'SELECT COUNT(*) AS c FROM orders WHERE user_id = $1',
      [userId],
    );
    const hasAnyOrder = Number(ordersRes.rows[0]?.c || 0) > 0;
    if (hasAnyOrder) {
      return res.status(200).json({
        success: true,
        data: { eligible: false, reason_code: 'NOT_FIRST_ORDER' },
      });
    }

    const awarded = await query(
      'SELECT 1 FROM cashback_campaign_awards WHERE campaign_id = $1 AND user_id = $2',
      [campaignId, userId],
    );
    if (awarded.rows.length > 0) {
      return res.status(200).json({ success: true, data: { eligible: false, reason_code: 'ALREADY_AWARDED' } });
    }
    return res.status(200).json({ success: true, data: { eligible: true, reason_code: 'ELIGIBLE' } });
  } catch (_error) {
    return res.status(500).json({ success: false, message: 'Eligibility check failed' });
  }
};

export const awardCampaign = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureCashbackSchema();
    const userId = req.user?.id;
    const campaignId = Number(req.params.id);
    const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : null;
    const triggerEvent = req.body?.trigger_type || 'signup';
    if (!userId) return res.status(401).json({ success: false, code: 'NOT_AUTHENTICATED' });
    if (!campaignId) return res.status(400).json({ success: false, code: 'INVALID_CAMPAIGN_ID' });

    // Safety: enforce first-time buyer rule at award-time as well
    const ordersRes = await client.query(
      'SELECT COUNT(*) AS c FROM orders WHERE user_id = $1',
      [userId],
    );
    const hasAnyOrder = Number(ordersRes.rows[0]?.c || 0) > 0;
    if (hasAnyOrder) {
      return res.status(200).json({
        success: true,
        data: { status: 'NOT_FIRST_ORDER' },
      });
    }

    await client.query('BEGIN');
    const result = await awardCampaignTx(client, { campaignId, userId, triggerEvent, idempotencyKey });
    if (!result.success) {
      await client.query('ROLLBACK');
      return res.status(200).json({ success: true, data: { status: result.code } });
    }
    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: 'Cashback awarded successfully',
      data: {
        status: 'GRANTED',
        campaign_id: campaignId,
        user_id: userId,
        amount: result.data.amount,
        wallet_balance: result.data.wallet_balance,
        awarded_at: result.data.award.awarded_at,
      },
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success: false, message: 'Failed to award cashback' });
  } finally {
    client.release();
  }
};

export const getWalletBalance = async (req, res) => {
  try {
    await ensureCashbackSchema();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });
    const walletRes = await query(
      'SELECT id AS user_id, COALESCE(cashback_amount, 0) AS balance, updated_at FROM users WHERE id = $1',
      [userId],
    );
    res.status(200).json({ success: true, data: walletRes.rows[0] || { user_id: userId, balance: 0 } });
  } catch (_error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet balance' });
  }
};

export const getWalletTransactions = async (req, res) => {
  try {
    await ensureCashbackSchema();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });
    const txRes = await query(
      `SELECT
         id,
         user_id,
         txn_type,
         source_type,
         source_id,
         amount,
         CASE
           WHEN LOWER(txn_type) = 'debit' THEN -ABS(amount)
           ELSE ABS(amount)
         END AS signed_amount,
         balance_before,
         balance_after,
         (COALESCE(balance_after, 0) - COALESCE(balance_before, 0)) AS balance_diff,
         remarks,
         created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId],
    );
    res.status(200).json({ success: true, data: txRes.rows });
  } catch (_error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet transactions' });
  }
};
