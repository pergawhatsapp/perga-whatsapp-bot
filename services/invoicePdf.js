const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateInvoicePdf({ orderNumber, business, order }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const filePath = path.join(
        __dirname,
        `../tmp/invoice-${orderNumber}.pdf`
      );

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // =====================
      // HEADER
      // =====================
      doc
        .fontSize(20)
        .text('PERGA BEVERAGES', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(12)
        .text('Invoice', { align: 'center' })
        .moveDown(1);

      doc.fontSize(10).text(`Order #: ${orderNumber}`);
      doc.text(`Date: ${new Date().toLocaleString()}`);
      doc.moveDown();

      // =====================
      // BUSINESS INFO
      // =====================
      doc.fontSize(11).text('Bill To:', { underline: true });
      doc.text(business.business_name);
      doc.text(business.address);
      doc.text(`Phone: ${business.phone}`);
      doc.text(`Email: ${business.email}`);
      doc.text(
        business.tax_type === 'resale'
          ? `Resale Tax ID: ${business.tax_id}`
          : `Federal Tax ID: ${business.tax_id}`
      );

      if (business.alcohol_license) {
        doc.text(`Alcohol License #: ${business.alcohol_license_number}`);
      }

      doc.moveDown();

      // =====================
      // TABLE HEADER
      // =====================
      doc
        .fontSize(11)
        .text('Item', 50, doc.y, { continued: true })
        .text('Qty', 280, doc.y, { continued: true })
        .text('Price', 330, doc.y, { continued: true })
        .text('Total', 420);

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // =====================
      // ITEMS
      // =====================
      order.items.forEach(item => {
        const lineTotal = item.qty * item.price;

        doc
          .fontSize(10)
          .text(item.en, 50, doc.y, { continued: true })
          .text(item.qty.toString(), 280, doc.y, { continued: true })
          .text(`$${item.price.toFixed(2)}`, 330, doc.y, { continued: true })
          .text(`$${lineTotal.toFixed(2)}`, 420);

        doc.moveDown();
      });

      doc.moveDown();

      // =====================
      // TOTALS
      // =====================
      doc.moveTo(350, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      doc.text(`Subtotal: $${order.subtotal.toFixed(2)}`, 350);

      if (order.tax > 0) {
        doc.text(`Tax (7%): $${order.tax.toFixed(2)}`, 350);
      }

      doc
        .fontSize(12)
        .text(`Total: $${order.total.toFixed(2)}`, 350);

      doc.moveDown(2);

      // =====================
      // FOOTER
      // =====================
      doc
        .fontSize(10)
        .text('Payment Terms: Net 30 days')
        .moveDown(0.5)
        .text('Thank you for choosing Perga Beverages!');

      doc.end();

      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePdf };
