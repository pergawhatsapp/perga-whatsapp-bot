const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsappPdf(to, pdfUrl) {
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${to}`,
    body: 'Your invoice is attached.',
    mediaUrl: [pdfUrl]
  });
}

module.exports = { sendWhatsappPdf };
