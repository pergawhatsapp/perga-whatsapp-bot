const twilio = require('twilio');
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

module.exports = async function sendWhatsappPDF(to, pdfUrl, language) {
  const body =
    language === 'es'
      ? 'Aquí está su factura. Gracias por elegir Perga.'
      : 'Here is your invoice. Thank you for choosing Perga.';

  await client.messages.create({
    from: 'whatsapp:+14155238886', // Twilio sandbox or approved number
    to: `whatsapp:${to}`,
    body,
    mediaUrl: [pdfUrl]
  });
};
