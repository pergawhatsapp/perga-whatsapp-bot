const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendInvoiceEmail(to, pdfBuffer) {
  const msg = {
    to,
    from: process.env.COMPANY_EMAIL,
    subject: 'Perga Sales Order Invoice',
    text: 'Please find your invoice attached.',
    attachments: [
      {
        content: pdfBuffer.toString('base64'),
        filename: 'invoice.pdf',
        type: 'application/pdf',
        disposition: 'attachment'
      }
    ]
  };

  await sgMail.send(msg);
}

module.exports = { sendInvoiceEmail };
