import { query } from '../config/db.js';
import { sendAdminNotification } from '../utils/adminNotification.js';

function cleanText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}

function isValidLanguage(value) {
  return value === 'en' || value === 'hi';
}

async function resolveCategory(categoryId, categoryName) {
  const id = cleanText(categoryId, 64);
  const name = cleanText(categoryName, 120);

  if (id) {
    const byId = await query(
      'SELECT id, name FROM categories WHERE id = $1::uuid AND COALESCE(is_active, true) = true LIMIT 1',
      [id],
    );
    if (byId.rows.length > 0) return byId.rows[0];
  }

  if (name) {
    const byName = await query(
      'SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1) AND COALESCE(is_active, true) = true LIMIT 1',
      [name],
    );
    if (byName.rows.length > 0) return byName.rows[0];
  }

  return null;
}

async function subcategoryExistsForCategory(categoryId, subcategory) {
  const res = await query(
    `SELECT 1
     FROM products
     WHERE category_id = $1::uuid
       AND status = 'active'
       AND LOWER(TRIM(subcategory)) = LOWER(TRIM($2))
     LIMIT 1`,
    [categoryId, subcategory],
  );
  return res.rows.length > 0;
}

async function notifyTeam(row, userRow) {
  const contactName = userRow?.full_name || row.guest_name || '—';
  const contactPhone = userRow?.phone_number || row.guest_phone || '—';
  const languageLabel = row.language === 'hi' ? 'Hindi' : 'English';

  const text = [
    'New product guidance request',
    `Language: ${languageLabel}`,
    `Category: ${row.category_name}`,
    `Subcategory: ${row.subcategory}`,
    `Contact name: ${contactName}`,
    `Contact phone: ${contactPhone}`,
    `Logged in: ${row.user_id ? 'Yes' : 'No'}`,
    `Skipped login: ${row.login_skipped ? 'Yes' : 'No'}`,
    `Page: ${row.page_path || '—'}`,
    `Request ID: ${row.id}`,
  ].join('\n');

  const html = `
    <h2>New product guidance request</h2>
    <p><strong>Language:</strong> ${escapeHtml(languageLabel)}</p>
    <p><strong>Category:</strong> ${escapeHtml(row.category_name)}</p>
    <p><strong>Subcategory:</strong> ${escapeHtml(row.subcategory)}</p>
    <p><strong>Contact name:</strong> ${escapeHtml(contactName)}</p>
    <p><strong>Contact phone:</strong> ${escapeHtml(contactPhone)}</p>
    <p><strong>Skipped login:</strong> ${row.login_skipped ? 'Yes' : 'No'}</p>
    <p><strong>Page:</strong> ${escapeHtml(row.page_path || '—')}</p>
    <p><strong>Request ID:</strong> ${escapeHtml(row.id)}</p>
  `;

  sendAdminNotification({
    subject: `[Guidance] ${row.category_name} — ${row.subcategory}`,
    text,
    html,
  }).catch((err) => {
    console.error('[Guidance] admin notification failed:', err?.message || err);
  });
}

export async function listGuidanceCategories(_req, res) {
  try {
    const result = await query(
      `SELECT id, name
       FROM categories
       WHERE COALESCE(is_active, true) = true
       ORDER BY sort_order NULLS LAST, name ASC`,
    );

    return res.status(200).json({
      success: true,
      data: result.rows || [],
    });
  } catch (error) {
    console.error('[listGuidanceCategories]', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load categories',
    });
  }
}

export async function createGuidanceRequest(req, res) {
  try {
    const language = cleanText(req.body?.language, 5);
    const categoryIdRaw = cleanText(req.body?.category_id, 64);
    const categoryNameRaw = cleanText(req.body?.category_name, 120);
    const subcategory = cleanText(req.body?.subcategory, 120);
    const loginSkipped = req.body?.login_skipped === true;
    const guestName = cleanText(req.body?.guest_name, 120) || null;
    const guestPhoneRaw = req.body?.guest_phone;
    const pagePath = cleanText(req.body?.page_path, 512) || null;
    const userAgent = cleanText(req.headers['user-agent'], 1000) || null;

    if (!isValidLanguage(language)) {
      return res.status(400).json({
        success: false,
        message: 'Language must be en or hi',
      });
    }

    if (!subcategory) {
      return res.status(400).json({
        success: false,
        message: 'Subcategory is required',
      });
    }

    const category = await resolveCategory(categoryIdRaw, categoryNameRaw);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category',
      });
    }

    const subcategoryOk = await subcategoryExistsForCategory(category.id, subcategory);
    if (!subcategoryOk) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subcategory for the selected category',
      });
    }

    const authUserId = req.user?.id ?? null;
    let userId = null;
    let guestPhone = null;

    if (authUserId) {
      userId = authUserId;
    } else {
      guestPhone = normalizePhone(guestPhoneRaw);
      if (!guestPhone) {
        return res.status(400).json({
          success: false,
          message: 'A valid 10-digit phone number is required',
        });
      }
    }

    const didSkipLogin = !authUserId && loginSkipped;

    const insertRes = await query(
      `INSERT INTO product_guidance_requests (
         user_id, guest_name, guest_phone, language,
         category_id, category_name, subcategory,
         login_skipped, source, page_path, user_agent
       )
       VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        userId,
        guestName,
        guestPhone,
        language,
        category.id,
        category.name,
        subcategory,
        didSkipLogin,
        'whatsapp_badge',
        pagePath,
        userAgent,
      ],
    );

    const row = insertRes.rows?.[0];
    if (!row) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save your request',
      });
    }

    let userRow = null;
    if (userId) {
      const userRes = await query(
        'SELECT full_name, phone_number FROM users WHERE id = $1 LIMIT 1',
        [userId],
      );
      userRow = userRes.rows?.[0] || null;
    }

    notifyTeam(row, userRow);

    return res.status(201).json({
      success: true,
      message: 'Request submitted successfully',
      data: {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.status(500).json({
        success: false,
        message: 'product_guidance_requests table not found. Please run the migration.',
      });
    }

    console.error('[createGuidanceRequest]', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit guidance request',
    });
  }
}
