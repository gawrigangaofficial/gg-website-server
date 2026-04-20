import { randomUUID } from 'crypto';
import { query } from '../config/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createPreorder = async (req, res) => {
  try {
    const {
      product_id,
      product_name,
      product_price,
      quantity = 1,
      email,
    } = req.body || {};

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedProductId = String(product_id || '').trim();
    const normalizedProductName = String(product_name || '').trim();
    const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
    const normalizedPrice = Number(product_price || 0);

    if (!normalizedProductId || !normalizedProductName) {
      return res.status(400).json({
        success: false,
        message: 'product_id and product_name are required',
      });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email is required for preorder notifications',
      });
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product_price',
      });
    }

    const userId = req.user?.id || null;

    const insertRes = await query(
      `INSERT INTO preorders
         (id, user_id, email, product_id, product_name, product_price, quantity, created_at, notified_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
       RETURNING id, user_id, email, product_id, product_name, product_price, quantity, created_at, notified_at`,
      [
        randomUUID(),
        userId,
        normalizedEmail,
        normalizedProductId,
        normalizedProductName,
        normalizedPrice,
        normalizedQuantity,
      ],
    );

    return res.status(201).json({
      success: true,
      message: 'Preorder request saved',
      data: insertRes.rows?.[0] || null,
    });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.status(500).json({
        success: false,
        message: 'preorders table not found. Please create the table first.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to save preorder request',
    });
  }
};
