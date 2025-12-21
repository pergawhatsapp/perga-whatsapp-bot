const PDFDocument = require('pdfkit');
const path = require('path');

function generateInvoice(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    /* =========================
       ORDER NUMBER
    ========================= */
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    const orderNumber = `PO-${datePart}-${rand}`;

    /* =========================
       LOGO + HEADER
    ========================= */
    const logoPath = path.join(__dirname, '../assets/logo.png');

    try {
      doc.image(logoPath, 50, 40, { width: 120 });
    } catch (e) {
      // logo optional, do nothing if missing
    }

    doc
      .fontSize(20)
      .text('PERGA DISTRIBUTION', 200, 50)
      .fontSize(10)
      .text('Wholesale Beverages', 200, 75);

    doc.moveDown(3);

    /* =========================
       ORDER INFO
    ========================= */
    doc.fontSize(11);
    doc.text(`Order Number: ${orderNumber}`);
    doc.text(`Order Date: ${new Date().toLocaleString()}`);
    doc.moveDown();

    /* =========================
       BUSINESS INFO
    ========================= */
    doc.text(`Business Name: ${data.business_name}`);
    doc.text(`Contact Name: ${data.contact_name || 'N/A'}`);
    doc.text(`Email: ${data.email}`);
    doc.text(`Phone: ${data.phone || 'N/A'}`);
    doc.text(`Address: ${data.address || 'N/A'}`);

    if (data.alcohol_license) {
      doc.moveDown();
      doc.text(`Alcohol License #: ${data.license_number}`);
    }

    doc.moveDown(2);

    /* =========================
       ITEMS TABLE
    ========================= */
    doc.fontSize(12).text('Order Items');
    doc.moveDown();

    let subtotal = 0;

    data.items.forEach(item => {
      const lineTotal = item.qty * item.price;
      subtotal += lineTotal;

      doc
        .fontSize(10)
        .text(
          `${item.name}  |  ${item.qty} cases × $${item.price.toFixed(2)}  =  $${lineTotal.toFixed(2)}`
        );
    });

    doc.moveDown();

    /* =========================
       TAX LOGIC
    ========================= */
    const tax = data.tax_exempt ? 0 : subtotal * 0.07;
    const total = subtotal + tax;

    doc.text(`Subtotal: $${subtotal.toFixed(2)}`);
    doc.text(`Tax (7%): $${tax.toFixed(2)}`);
    doc.fontSize(12).text(`TOTAL: $${total.toFixed(2)}`);

    doc.moveDown(2);

    /* =========================
       PAYMENT TERMS (SUPERmart ONLY)
    ========================= */
    const isSupermart =
      data.business_name &&
      data.business_name.toLowerCase().includes('supermart');

    const paymentTerms = isSupermart
      ? 'Payment Terms: Net 30 Days'
      : 'Payment Terms: Pay on Delivery';

    doc.fontSize(10).text(paymentTerms);

    doc.moveDown();

    /* =========================
       FOOTER
    ========================= */
    doc
      .fontSize(9)
      .text(
        'Perga Distribution • Thank you for your business',
        { align: 'center' }
      );

    doc.end();
  });
}

module.exports = { generateInvoice };
