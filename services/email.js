const nodemailer = require('nodemailer');
const fs = require('fs');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendInvoiceEmail({ to, subject, text, pdfPath }) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF not found for email');
  }

  await transporter.sendMail({
    from: `"Perga Beverages" <${process.env.COMPANY_EMAIL}>`,
    to,
    subject,
    text,
    attachments: [
      {
        filename: 'invoice.pdf',
        path: pdfPath
      }
    ]
  });
}

module.exports = { sendInvoiceEmail };
