/**
 * Mailer for Brevo (brevo.com).
 * - Prefer BREVO_API_KEY (HTTPS API): works on Render free tier (no SMTP ports blocked).
 * - Fallback: SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) for localhost.
 * Optional MAIL_FROM = "Name <email@domain.com>" (use a verified sender in Brevo).
 */
import './loadEnv.js';
import nodemailer from 'nodemailer';

function env(name) {
  return String(process.env[name] || '').trim();
}

function getMailConfig() {
  const BREVO_API_KEY = env('BREVO_API_KEY');
  const SMTP_HOST = env('SMTP_HOST');
  const SMTP_PORT = env('SMTP_PORT');
  const SMTP_SECURE = env('SMTP_SECURE');
  const SMTP_USER = env('SMTP_USER');
  const SMTP_PASS = env('SMTP_PASS');
  const MAIL_FROM = env('MAIL_FROM');

  const useBrevoApi = Boolean(BREVO_API_KEY);
  const useSmtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

  return {
    BREVO_API_KEY,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM,
    useBrevoApi,
    useSmtp,
    isConfigured: useBrevoApi || useSmtp,
    isBrevo: useBrevoApi || String(SMTP_HOST).toLowerCase().includes('brevo'),
  };
}

/** Parse "Name <email>" or "email" into { name, email }. */
function parseSender(fromStr, smtpUser) {
  const raw = String(fromStr || smtpUser || '').trim();
  if (!raw) return { name: 'Gawri Ganga', email: 'noreply@gawriganga.com' };
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: 'Gawri Ganga', email: raw };
}

function getFromAddress(cfg) {
  const { name, email } = parseSender(cfg.MAIL_FROM, cfg.SMTP_USER);
  return `${name} <${email}>`;
}

function createSmtpTransporter(cfg) {
  const port = parseInt(cfg.SMTP_PORT, 10) || 587;
  return nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port,
    secure: cfg.SMTP_SECURE === 'true',
    auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });
}

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

function normalizeRecipients(to) {
  if (Array.isArray(to)) {
    return to.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(to || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Send email via Brevo HTTP API (works on Render free tier; uses HTTPS).
 */
async function sendViaBrevoApi(options, cfg) {
  const sender = parseSender(cfg.MAIL_FROM, cfg.SMTP_USER);
  const recipients = normalizeRecipients(options.to);
  if (!recipients.length) {
    throw new Error('No email recipients provided');
  }

  const body = {
    sender: { name: sender.name, email: sender.email },
    to: recipients.map((email) => ({ email })),
    subject: options.subject,
    htmlContent: options.html != null ? options.html : options.text,
    textContent: options.text || undefined,
  };

  const res = await fetch(BREVO_EMAIL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': cfg.BREVO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = errText;
    try {
      const j = JSON.parse(errText);
      errMsg = j.message || j.code || errText;
    } catch (_) {}
    throw new Error(errMsg || `Brevo API ${res.status}`);
  }

  const data = await res.json();
  return { messageId: data.messageId || data.messageIds?.[0] };
}

/**
 * Send an email. Uses Brevo API if BREVO_API_KEY is set (e.g. on Render), else SMTP.
 * If Brevo API rejects due to unauthorized IP, falls back to SMTP when configured.
 * @param {Object} options - { to, subject, text, html? }
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendMail(options) {
  const cfg = getMailConfig();
  if (!cfg.isConfigured) {
    console.warn(
      '[Mail] Not configured. Set BREVO_API_KEY (for Render) or SMTP_HOST/SMTP_USER/SMTP_PASS.',
    );
    return { success: false, error: 'Mail not configured' };
  }

  const recipients = normalizeRecipients(options.to);
  const toMasked = recipients.length
    ? recipients
        .map((email) => `${email.slice(0, 2)}***@${email.split('@')[1] || ''}`)
        .join(', ')
    : '?';

  try {
    if (cfg.useBrevoApi) {
      try {
        const result = await sendViaBrevoApi(options, cfg);
        console.log('[Mail] Sent via Brevo API', result.messageId, 'to', toMasked);
        return { success: true, messageId: result.messageId };
      } catch (apiErr) {
        const apiMsg = apiErr?.message || String(apiErr);
        const shouldFallbackToSmtp =
          cfg.useSmtp && /unrecognised ip|unauthorized|authorised_ips|authorized_ips/i.test(apiMsg);
        if (!shouldFallbackToSmtp) throw apiErr;
        console.warn('[Mail] Brevo API blocked, falling back to SMTP:', apiMsg);
      }
    }

    if (!cfg.useSmtp) {
      throw new Error('SMTP is not configured');
    }

    const transporter = createSmtpTransporter(cfg);
    const mailOptions = {
      from: getFromAddress(cfg),
      to: recipients.join(', '),
      subject: options.subject,
      text: options.text,
      html: options.html != null ? options.html : options.text,
    };
    const result = await transporter.sendMail(mailOptions);
    console.log('[Mail] Sent via SMTP', result.messageId, 'to', toMasked);
    return { success: true, messageId: result.messageId };
  } catch (err) {
    console.error('[Mail] Send failed:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

export const isConfigured = getMailConfig().isConfigured;
export const isBrevo = getMailConfig().isBrevo;
