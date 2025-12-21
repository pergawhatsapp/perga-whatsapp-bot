const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

module.exports = function generateInvoicePDF(order, account) {
  try {
    const invoicesDir = path.join(__dirname, '../invoices');
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir);
    }

    const orderNumber = `PO-${new Date()
      .toISOString()
      .slice(0,10)
      .replace(/-/g,'')}-${Math.floor(Math.random()*900+100)}`;

    const fileName = `${orderNumber}.pdf`;
    const filePath = path.join(invoicesDir, fileName);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(fs.createWriteStream(filePath));

    /* ===== HEADER ===== */
    doc
      .fontSize(20)
      .text('PERGA SALES ORDER', { align: 'center' })
      .moveDown();

    doc.fontSize(10).text(`Order #: ${orderNumber}`);
    doc.text(`Date: ${new Date().toLocaleString()}`);
    doc.moveDown();

    /* ===== BUSINESS INFO ===== */
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10)
      .text(account.business_name || '')
      .text(account.address || '')
      .text(`Phone: ${account.phone || ''}`)
      .text(`Email: ${account.email || ''}`)
      .moveDown();

    doc.text(
      account.tax_type === 'resale'
        ? `Resale Tax ID: ${account.tax_id}`
        : `Federal Tax ID: ${account.tax_id}`
    );

    if (account.alcohol_license) {
      doc.text(`Alcohol License #: ${account.alcohol_license_number}`);
    }

    doc.moveDown();

    /* ===== ITEMS ===== */
    doc.fontSize(12).text('Items:', { underline: true });
    doc.moveDown(0.5);

    let total = 0;

    order.items.forEach(item => {
      const lineTotal = item.qty * item.price;
      total += lineTotal;

      doc
        .fontSize(10)
        .text(
          `${item.en} — ${item.qty} cases × $${item.price.toFixed(2)} = $${lineTotal.toFixed(2)}`
        );
    });

    doc.moveDown();
    doc.fontSize(12).text(`TOTAL: $${total.toFixed(2)}`, { align: 'right' });
    doc.moveDown();

    doc.fontSize(10).text('Payment Terms: Net 30 days');
    doc.moveDown(2);

    doc.text(
      'Perga Beverages\nThank you for your business!',
      { align: 'center' }
    );

    doc.end();

    return { filePath, fileName };

  } catch (err) {
    console.error('PDF GENERATION ERROR:', err);
    throw err;
  }
};
