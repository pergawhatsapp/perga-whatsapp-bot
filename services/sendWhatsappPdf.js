const twilio = require('twilio');
const fs = require('fs');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsappPdf(to, pdfPath, caption = 'Invoice') {
  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF file not found');
  }

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${to}`,
    body: caption,
    mediaUrl: [`https://YOUR_PUBLIC_DOMAIN/${pdfPath.split('/tmp/')[1]}`]
  });
}

module.exports = { sendWhatsappPdf };
