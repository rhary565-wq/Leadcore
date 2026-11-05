const { Resend } = require('resend');

const getResend = () => new Resend(process.env.RESEND_API_KEY);

// Support comma-separated list of emails: "a@x.com,b@x.com"
const getRecipients = () =>
  (process.env.APPROVER_EMAIL || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

async function sendApprovalReady({ jobId, hot, warm, createdBy }) {
  const approvalUrl = `${process.env.FRONTEND_URL}/approval/${jobId}`;
  const total = hot + warm;

  await getResend().emails.send({
    from:    process.env.RESEND_FROM_EMAIL || 'leads@yourdomain.com',
    to:      getRecipients(),
    subject: `[Action Required] ${total} leads ready for HubSpot approval`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#111">Leads Ready for Review</h2>
        <p>A new batch of leads has been scraped, cleaned, and scored.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="background:#FEE2E2">
            <td style="padding:12px;font-weight:bold">Hot leads</td>
            <td style="padding:12px;font-size:22px;font-weight:bold">${hot}</td>
          </tr>
          <tr style="background:#FEF9C3">
            <td style="padding:12px;font-weight:bold">Warm leads</td>
            <td style="padding:12px;font-size:22px;font-weight:bold">${warm}</td>
          </tr>
        </table>
        <p>Only Hot and Warm leads need your review before going to HubSpot.</p>
        <a href="${approvalUrl}"
           style="display:inline-block;background:#4F46E5;color:white;
                  padding:14px 28px;border-radius:8px;text-decoration:none;
                  font-weight:bold;font-size:16px;margin-top:10px">
          Review and Approve Leads
        </a>
        <p style="color:#888;font-size:12px;margin-top:30px">
          Job ID: ${jobId}<br>
          Triggered by: ${createdBy || 'system'}
        </p>
      </div>
    `
  });
}

async function sendPushComplete({ jobId, pushed, failed }) {
  await getResend().emails.send({
    from:    process.env.RESEND_FROM_EMAIL || 'leads@yourdomain.com',
    to:      getRecipients(),
    subject: `${pushed} leads pushed to HubSpot`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#111">HubSpot Push Complete</h2>
        <p><strong>${pushed}</strong> leads have been created in HubSpot.</p>
        ${failed > 0 ? `<p style="color:#DC2626">${failed} leads failed - check the dashboard.</p>` : ''}
        <a href="${process.env.FRONTEND_URL}/dashboard"
           style="display:inline-block;background:#16A34A;color:white;
                  padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          View Dashboard
        </a>
      </div>
    `
  });
}

module.exports = { sendApprovalReady, sendPushComplete };
