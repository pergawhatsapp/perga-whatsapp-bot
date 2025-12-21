const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

module.exports = function generateInvoicePDF(order, business) {
  const fileName = `invoice-${order.order_number}.pdf`;
  const filePath = path.join('/tmp', fileName);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text('PERGA DISTRIBUTORS', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`Order #: ${order.order_number}`);
  doc.text(`Date: ${new Date().toLocaleString()}`);
  doc.moveDown();

  doc.text(`Business: ${business.business_name}`);
  doc.text(`Address: ${business.address}`);
  doc.text(`Phone: ${business.phone}`);
  doc.text(`Contact: ${business.contact_name}`);
  doc.text(`Tax ID: ${business.tax_id}`);

  if (business.alcohol_license) {
    doc.text(`Alcohol License #: ${business.alcohol_license_number}`);
  }

  doc.moveDown().text('Items:', { underline: true });

  order.items.forEach(i => {
    doc.text(`${i.en || i.key} — ${i.qty} × $${i.price.toFixed(2)}`);
  });

  doc.moveDown();
  doc.text(`TOTAL: $${order.total.toFixed(2)}`, { bold: true });
  doc.moveDown();
  doc.text('Payment Terms: Net 30 days');

  doc.end();

  return { filePath, fileName };
};
