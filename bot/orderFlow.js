const supabase = require('../services/supabase');
const messages = require('./messages');
const { generateInvoice } = require('../services/invoiceService');
const { sendInvoiceEmail } = require('../services/emailService');
const { v4: uuidv4 } = require('uuid');

async function handleOrderFlow(state, from, body, twiml, req) {
  const lang = state.language || 'en';
  const temp = state.temp_data || {};
  const order = state.order_items || [];

  switch (state.current_step) {

    /* ---------- ACCOUNT CREATION FLOW ---------- */

    case 'new_business_name':
      temp.business_name = body;
      return next(from, 'new_email', temp, twiml, messages.businessEmail[lang]);

    case 'new_email':
      temp.email = body;
      return next(from, 'resale_tax', temp, twiml, messages.resaleTax[lang]);

    case 'resale_tax':
      temp.tax_id_type = body.includes('yes') ? 'resale' : 'federal';
      return next(from, 'tax_id_number', temp, twiml, messages.taxIdNumber[lang]);

    case 'tax_id_number':
      temp.tax_id_number = body;
      return next(from, 'address', temp, twiml, messages.address[lang]);

    case 'address':
      temp.address = body;
      return next(from, 'phone', temp, twiml, messages.phone[lang]);

    case 'phone':
      temp.phone = body;
      return next(from, 'contact_name', temp, twiml, messages.contactName[lang]);

    case 'contact_name':
      temp.contact_name = body;
      return next(from, 'alcohol_license', temp, twiml, messages.alcoholLicense[lang]);

    case 'alcohol_license':
      temp.alcohol_license = body.includes('yes');
      if (temp.alcohol_license) {
        return next(from, 'upload_license', temp, twiml, messages.uploadLicense[lang]);
      } else {
        await saveBusiness(temp);
        return startOrder(from, temp, twiml, lang);
      }

    case 'upload_license':
      if (req.body.NumMedia > 0) {
        temp.license_photo_url = req.body.MediaUrl0;
        return next(from, 'license_number', temp, twiml, messages.licenseNumber[lang]);
      }
      twiml.message(messages.uploadLicense[lang]);
      break;

    case 'license_number':
      temp.license_number = body;
      await saveBusiness(temp);
      return startOrder(from, temp, twiml, lang);

    /* ---------- ORDER FLOW ---------- */

    case 'order_select':
      const products = await getProducts(temp.alcohol_license);
      const product = products.find(p => body.toLowerCase().includes(p.name.toLowerCase()));
      if (!product) {
        twiml.message(lang === 'en' ? 'Invalid product.' : 'Producto inválido.');
        break;
      }
      temp.current_product = product;
      return next(from, 'order_quantity', temp, twiml,
        lang === 'en'
          ? `How many cases of ${product.name}?`
          : `¿Cuántas cajas de ${product.name_es}?`
      );

    case 'order_quantity':
      const qty = parseInt(body);
      if (isNaN(qty) || qty <= 0) {
        twiml.message(lang === 'en' ? 'Enter a valid number.' : 'Ingrese un número válido.');
        break;
      }
      order.push({
        ...temp.current_product,
        quantity: qty,
        line_total: qty * temp.current_product.price
      });
      await supabase.from('conversation_state').upsert({
        whatsapp_number: from,
        current_step: 'order_more',
        temp_data: temp,
        order_items: order
      });
      twiml.message(lang === 'en' ? 'Add another product? (yes/no)' : '¿Agregar otro producto? (sí/no)');
      break;

    case 'order_more':
      if (body.includes('yes')) {
        return showProducts(from, temp, twiml, lang);
      } else {
        return finalizeOrder(from, temp, order, twiml, lang);
      }
  }

  return twiml.toString();
}

/* ---------- HELPERS ---------- */

async function next(from, step, temp, twiml, message) {
  await supabase.from('conversation_state').upsert({
    whatsapp_number: from,
    current_step: step,
    temp_data: temp
  });
  twiml.message(message);
  return twiml.toString();
}

async function saveBusiness(data) {
  await supabase.from('businesses').insert(data);
}

async function startOrder(from, temp, twiml, lang) {
  await supabase.from('conversation_state').upsert({
    whatsapp_number: from,
    current_step: 'order_select',
    temp_data: temp,
    order_items: []
  });
  return showProducts(from, temp, twiml, lang);
}

async function getProducts(alcoholAllowed) {
  const { data } = await supabase.from('products').select('*');
  return alcoholAllowed ? data : data.filter(p => !p.is_alcoholic);
}

async function showProducts(from, temp, twiml, lang) {
  const products = await getProducts(temp.alcohol_license);
  let text = lang === 'en' ? 'Available products:\n' : 'Productos disponibles:\n';
  products.forEach(p => {
    text += `- ${lang === 'en' ? p.name : p.name_es} ($${p.price})\n`;
  });
  twiml.message(text);
  return twiml.toString();
}

async function finalizeOrder(from, temp, order, twiml, lang) {
  const totalCases = order.reduce((sum, i) => sum + i.quantity, 0);
  if (totalCases < 10) {
    twiml.message(lang === 'en'
      ? 'Minimum order is 10 cases.'
      : 'El pedido mínimo es de 10 cajas.');
    return twiml.toString();
  }

  const subtotal = order.reduce((sum, i) => sum + i.line_total, 0);
  const orderNumber = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*900+100)}`;

  const pdfBuffer = await generateInvoice(temp, order, subtotal, orderNumber, lang);
  await sendInvoiceEmail(temp.email, pdfBuffer, orderNumber);

  await supabase.from('orders').insert({
    business_id: uuidv4(),
    order_number: orderNumber,
    order_date: new Date(),
    items: order,
    subtotal,
    total: subtotal,
    status: 'sent'
  });

  await supabase.from('conversation_state').delete().eq('whatsapp_number', from);

  twiml.message(lang === 'en'
    ? 'Invoice sent to your email ✓\nA sales representative will contact you.\nThank you for choosing Perga!'
    : 'Factura enviada a su correo electrónico ✓\nUn representante se comunicará con usted.\n¡Gracias por elegir Perga!');
  return twiml.toString();
}

module.exports = { handleOrderFlow };
