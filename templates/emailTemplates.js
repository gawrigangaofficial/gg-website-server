/**
 * Email templates for Nodemailer.
 * Uses inline styles for email client compatibility.
 */

const BRAND_NAME = 'Gawri Ganga';
const PRIMARY_COLOR = '#c2410c';   // orange-700
const BG_LIGHT = '#fff7ed';        // orange-50

/**
 * Base wrapper HTML for all emails.
 */
function wrapHtml(content) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND_NAME}</title>
</head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding: 24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">
          <tr>
            <td style="background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #ea580c 100%); padding: 24px 32px; text-align: center;">
              <h1 style="margin:0; color:#ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">${BRAND_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: ${BG_LIGHT}; border-top: 1px solid #fed7aa;">
              <p style="margin:0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Preorder confirmation email.
 * @param {{ product_name: string, quantity: number }[]} items
 * @returns {{ subject: string, text: string, html: string }}
 */
export function preorderConfirmation(items) {
    const subject = "You're on the list! – " + BRAND_NAME;
    const itemLines = items.map(r => `• ${r.product_name} (Qty: ${r.quantity})`).join('\n');
    const text = [
        'Thank you for your preorder.',
        '',
        "We'll email you as soon as we launch so you can complete your purchase.",
        '',
        'Your preorder:',
        itemLines,
        '',
        '– ' + BRAND_NAME
    ].join('\n');

    const itemsRows = items
        .map(
            (r) => `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6;">${escapeHtml(r.product_name)}</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: center;">${r.quantity}</td>
        </tr>`
        )
        .join('');

    const html = wrapHtml(`
      <p style="margin:0 0 16px; font-size: 16px; color: #374151;">Thank you for your preorder.</p>
      <p style="margin:0 0 24px; font-size: 15px; color: #6b7280; line-height: 1.5;">We'll email you as soon as we launch so you can complete your purchase.</p>
      <p style="margin:0 0 12px; font-size: 14px; font-weight: 600; color: #374151;">Your preorder:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px;">
        <thead>
          <tr style="background-color: ${BG_LIGHT};">
            <th style="padding: 12px 16px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Product</th>
            <th style="padding: 12px 16px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemsRows}
        </tbody>
      </table>
      <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">– ${BRAND_NAME}</p>
    `);

    return { subject, text, html };
}

/**
 * Launch notification email (use when you go live).
 * @param {string} [siteUrl] - e.g. https://gawriganga.com
 * @returns {{ subject: string, text: string, html: string }}
 */
export function launchNotification(siteUrl = '') {
    const subject = "We're live! – " + BRAND_NAME;
    const text = [
        "We're officially launched!",
        '',
        'You preordered with us — thank you. You can now complete your purchase.',
        siteUrl ? `Visit: ${siteUrl}` : 'Visit our website to shop.',
        '',
        '– ' + BRAND_NAME
    ].join('\n');

    const ctaHtml = siteUrl
        ? `<a href="${escapeHtml(siteUrl)}" style="display: inline-block; margin-top: 16px; padding: 14px 28px; background-color: ${PRIMARY_COLOR}; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">Shop Now</a>`
        : '';

    const html = wrapHtml(`
      <p style="margin:0 0 16px; font-size: 18px; font-weight: 600; color: #374151;">We're officially launched!</p>
      <p style="margin:0 0 16px; font-size: 15px; color: #6b7280; line-height: 1.5;">You preordered with us — thank you. You can now complete your purchase.</p>
      ${ctaHtml}
      <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">– ${BRAND_NAME}</p>
    `);

    return { subject, text, html };
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
