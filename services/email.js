const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendInvoiceEmail(to, pdfBuffer) {
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Perga Invoice',
    html: '<p>Your invoice is attached.</p>',
    attachments: [
      {
        filename: 'invoice.pdf',
        content: pdfBuffer.toString('base64')
      }
    ]
  });
}

module.exports = { sendInvoiceEmail };
