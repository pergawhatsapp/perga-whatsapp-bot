const PDFDocument = require('pdfkit');

async function generateInvoice(business, items, subtotal, orderNumber, lang) {
  const doc = new PDFDocument();
  const buffers = [];

  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  doc.fontSize(20).text('Perga Distribution', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Order #: ${orderNumber}`);
  doc.text(`Date: ${new Date().toLocaleString()}`);
  doc.moveDown();

  doc.text(`Business: ${business.business_name}`);
  doc.text(`Address: ${business.address}`);
  doc.text(`Phone: ${business.phone}`);
  doc.text(`Tax ID: ${business.tax_id_number}`);

  if (business.alcohol_license) {
    doc.text(`Alcohol License: ${business.license_number}`);
  }

  doc.moveDown();
  doc.text('Items:');

  items.forEach(i => {
    doc.text(`${i.quantity} x ${lang === 'en' ? i.name : i.name_es} - $${i.line_total.toFixed(2)}`);
  });

  doc.moveDown();
  doc.text(`Subtotal: $${subtotal.toFixed(2)}`);
  doc.text('Payment Terms: Net 30 Days');

  doc.end();

  return Buffer.concat(buffers);
}

module.exports = { generateInvoice };
