// Email helper. Wraps Resend with a single sendVerificationCode()
// function — keeps every email template in this one file so design
// tweaks don't require touching the auth route.
//
// Phase 1 sender is Resend's default `onboarding@resend.dev`. Custom
// domain (noreply@thematch.app) was deferred — domain isn't
// registered yet. Swap FROM_ADDRESS when it is. (2026-05-02)
//
// Failure modes:
//   - RESEND_API_KEY missing: log + return { ok: false, reason: 'no-api-key' }
//     so signup can decide whether to hard-fail or soft-degrade.
//   - send error: log + return { ok: false, reason: 'send-failed', error }
//
// Lazy-init the Resend client so missing env vars don't crash boot
// (mirrors the lazy-init pattern in db.js).

const FROM_ADDRESS = 'The Match <onboarding@resend.dev>'

let _resend = null
function getResend() {
  if (_resend) return _resend
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  // Resend SDK is a small CJS-friendly package; require lazily so
  // boot works even when the env var is missing in dev.
  const { Resend } = require('resend')
  _resend = new Resend(key)
  return _resend
}

// 6-digit numeric verification code. The full HTML + plaintext
// versions both render the code prominently. Subject line includes
// the code itself so iOS Mail's lockscreen preview shows it without
// opening the message — saves a step on mobile.
async function sendVerificationCode(email, code, name) {
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY missing; cannot send verification email')
    return { ok: false, reason: 'no-api-key' }
  }

  const greeting = name ? `Hey ${name.split(' ')[0]},` : 'Hey,'
  const subject  = `${code} is your The Match verification code`

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:24px;background:#070C09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0D1F12">
        <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 8px 24px rgba(0,0,0,0.35)">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.18em;color:#C9A040;text-transform:uppercase;margin-bottom:6px">The Match</div>
          <div style="font-size:20px;font-weight:800;color:#0D1F12;margin-bottom:18px">Verify your email</div>
          <p style="font-size:14px;line-height:1.55;color:rgba(13,31,18,0.78);margin:0 0 18px">
            ${greeting} use the code below to finish setting up your account. The code expires in <strong>10 minutes</strong>.
          </p>
          <div style="text-align:center;background:#F5F2E8;border:2px solid #C9A040;border-radius:12px;padding:18px;margin:18px 0">
            <div style="font-size:32px;font-weight:900;letter-spacing:0.4em;color:#0D1F12;font-family:'SF Mono',Menlo,monospace">${code}</div>
          </div>
          <p style="font-size:12px;line-height:1.55;color:rgba(13,31,18,0.55);margin:18px 0 0">
            If you didn't sign up for The Match, you can safely ignore this email.
          </p>
        </div>
        <div style="max-width:480px;margin:14px auto 0;text-align:center;font-size:11px;color:rgba(255,255,255,0.40)">
          The Match · Sent via Resend
        </div>
      </body>
    </html>
  `

  const text = `${greeting}

Your The Match verification code is: ${code}

This code expires in 10 minutes.

If you didn't sign up for The Match, you can safely ignore this email.`

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject,
      html,
      text,
    })
    if (result?.error) {
      console.error('[email] Resend returned error', result.error)
      return { ok: false, reason: 'send-failed', error: result.error }
    }
    return { ok: true, id: result?.data?.id }
  } catch (err) {
    console.error('[email] sendVerificationCode threw', err.message)
    return { ok: false, reason: 'send-failed', error: err }
  }
}

module.exports = { sendVerificationCode, FROM_ADDRESS }
