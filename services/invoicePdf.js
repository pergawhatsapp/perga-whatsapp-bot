const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

async function generateInvoicePdf({ orderNumber, business, order }) {
  const tmpDir = path.join(process.cwd(), 'tmp');

  // ✅ ENSURE TMP DIRECTORY EXISTS
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const filePath = path.join(tmpDir, `invoice-${orderNumber}.pdf`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // ===== PDF CONTENT =====
    doc.fontSize(18).text('Perga Beverages', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Order Number: ${orderNumber}`);
    doc.text(`Business: ${business.business_name}`);
    doc.text(`Email: ${business.email}`);
    doc.text(`Address: ${business.address}`);
    doc.moveDown();

    doc.text('Order Items:');
    order.items.forEach(item => {
      if (item.qty > 0) {
        doc.text(
          `${item.en} — ${item.qty} × $${item.price.toFixed(2)}`
        );
      }
    });

    doc.moveDown();
    doc.text(`Subtotal: $${order.subtotal.toFixed(2)}`);
    if (order.tax > 0) {
      doc.text(`Tax: $${order.tax.toFixed(2)}`);
    }
    doc.text(`Total: $${order.total.toFixed(2)}`);

    doc.end();

    // ✅ WAIT UNTIL FILE IS FULLY WRITTEN
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateInvoicePdf };
