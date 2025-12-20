const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendInvoiceEmail(customerEmail, pdfBuffer, orderNumber) {
  const msg = {
    to: [customerEmail, process.env.COMPANY_EMAIL],
    from: process.env.COMPANY_EMAIL,
    subject: `Invoice ${orderNumber}`,
    text: 'Your invoice is attached.',
    attachments: [
      {
        content: pdfBuffer.toString('base64'),
        filename: `${orderNumber}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }
    ]
  };

  await sgMail.send(msg);
}

module.exports = { sendInvoiceEmail };
