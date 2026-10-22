export const COD_CONFIRMATION_AMOUNT = 100;

const COD_ADVANCE_NOTE =
  /COD advance paid ₹([\d.]+)\. Collect ₹([\d.]+) on delivery\./;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatRupeeAmount(value) {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function codPayNowAmount(amountDue) {
  return Math.min(COD_CONFIRMATION_AMOUNT, roundMoney(Math.max(0, amountDue)));
}

export function codCollectAmount(orderTotal, paidNow) {
  return roundMoney(Math.max(0, roundMoney(orderTotal) - roundMoney(paidNow)));
}

export function formatCodAdvanceNote(paidNow, collectOnDelivery) {
  return `COD advance paid ₹${formatRupeeAmount(paidNow)}. Collect ₹${formatRupeeAmount(collectOnDelivery)} on delivery.`;
}

export function parseCodAdvanceNote(notes) {
  const match = String(notes || '').match(COD_ADVANCE_NOTE);
  if (!match) return null;
  const paidNow = Number(match[1]);
  const collectOnDelivery = Number(match[2]);
  if (!Number.isFinite(paidNow) || !Number.isFinite(collectOnDelivery)) return null;
  return { paidNow, collectOnDelivery };
}
