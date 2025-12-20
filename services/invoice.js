const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');

function generateInvoice(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      resolve(pdf);
    });

    const orderNumber = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*1000)}`;

    doc.fontSize(18).text('PERGA DISTRIBUTION', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Order #: ${orderNumber}`);
    doc.text(`Date: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.text(`Business: ${data.business_name}`);
    doc.text(`Contact: ${data.contact_name}`);
    doc.text(`Email: ${data.email}`);
    doc.text(`Phone: ${data.phone}`);
    doc.text(`Address: ${data.address}`);
    doc.moveDown();

    if (data.alcohol_license) {
      doc.text(`Alcohol License #: ${data.license_number}`);
      doc.moveDown();
    }

    doc.text('Items:');
    doc.moveDown();

    let subtotal = 0;

    data.items.forEach(item => {
      const line = item.qty * item.price;
      subtotal += line;
      doc.text(`${item.name} | ${item.qty} × $${item.price} = $${line.toFixed(2)}`);
    });

    const tax = data.tax_exempt ? 0 : subtotal * 0.07;
    const total = subtotal + tax;

    doc.moveDown();
    doc.text(`Subtotal: $${subtotal.toFixed(2)}`);
    doc.text(`Tax: $${tax.toFixed(2)}`);
    doc.text(`TOTAL: $${total.toFixed(2)}`);
    doc.moveDown();

    doc.text('Payment Terms: Net 30 days');

    doc.end();
  });
}

module.exports = { generateInvoice };
