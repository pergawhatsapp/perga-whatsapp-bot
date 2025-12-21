const PDFDocument = require('pdfkit');

function generateInvoicePdf(invoice) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text('PERGA BEVERAGES', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Invoice: ${invoice.orderNumber}`);
    doc.text(`Date: ${invoice.date}`);
    doc.moveDown();

    doc.text(`Business: ${invoice.account.business_name}`);
    doc.text(`Address: ${invoice.account.address}`);
    doc.text(`Phone: ${invoice.account.phone}`);
    doc.text(`Tax ID: ${invoice.account.tax_id}`);

    if (invoice.account.alcohol_license) {
      doc.text(`Alcohol License #: ${invoice.account.alcohol_license_number}`);
    }

    doc.moveDown();
    doc.text('Items:');
    doc.moveDown(0.5);

    invoice.items.forEach(i => {
      doc.text(`${i.qty} x ${i.en} @ $${i.price} = $${(i.qty * i.price).toFixed(2)}`);
    });

    doc.moveDown();
    doc.text(`TOTAL: $${invoice.total.toFixed(2)}`, { bold: true });
    doc.moveDown();
    doc.text('Payment Terms: Net 30 days');

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
