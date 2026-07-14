import { query } from '../config/db.js';

export const DEFAULT_DELIVERY_CHARGES = {
  prepaid: { payment_type: 'prepaid', amount: 70, is_standard: true, reason_code: null, reason_message: null },
  cod: { payment_type: 'cod', amount: 120, is_standard: true, reason_code: null, reason_message: null },
};

function normalizeAmount(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeRow(row, fallbackType) {
  if (!row) return { ...DEFAULT_DELIVERY_CHARGES[fallbackType] };
  return {
    payment_type: row.payment_type,
    amount: normalizeAmount(row.amount, DEFAULT_DELIVERY_CHARGES[fallbackType].amount),
    is_standard: Boolean(row.is_standard),
    reason_code: row.is_standard ? null : row.reason_code || null,
    reason_message: row.is_standard ? null : row.reason_message || null,
    updated_at: row.updated_at || null,
  };
}

export async function getDeliveryChargeSettings() {
  try {
    const result = await query(
      `SELECT payment_type, amount, is_standard, reason_code, reason_message, updated_at
       FROM public.delivery_charge_settings
       WHERE payment_type IN ('prepaid', 'cod')`,
    );
    const map = {
      prepaid: { ...DEFAULT_DELIVERY_CHARGES.prepaid },
      cod: { ...DEFAULT_DELIVERY_CHARGES.cod },
    };
    for (const row of result.rows || []) {
      const key = String(row.payment_type || '').toLowerCase();
      if (key === 'prepaid' || key === 'cod') {
        map[key] = normalizeRow(row, key);
      }
    }
    return map;
  } catch (err) {
    console.warn('[deliveryCharges] Falling back to defaults:', err?.message);
    return {
      prepaid: { ...DEFAULT_DELIVERY_CHARGES.prepaid },
      cod: { ...DEFAULT_DELIVERY_CHARGES.cod },
    };
  }
}

export async function getShippingAmountForPaymentMethod(paymentMethod) {
  const settings = await getDeliveryChargeSettings();
  const isCod = String(paymentMethod || '').toLowerCase() === 'cod';
  return isCod ? settings.cod.amount : settings.prepaid.amount;
}

export const listPublicDeliveryCharges = async (_req, res) => {
  try {
    const settings = await getDeliveryChargeSettings();
    res.status(200).json({
      success: true,
      data: [settings.prepaid, settings.cod],
    });
  } catch (_error) {
    res.status(200).json({
      success: true,
      data: [DEFAULT_DELIVERY_CHARGES.prepaid, DEFAULT_DELIVERY_CHARGES.cod],
    });
  }
};
