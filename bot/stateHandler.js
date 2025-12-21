const twilio = require('twilio');
const MessagingResponse = twilio.twiml.MessagingResponse;

const supabase = require('../services/supabaseClient');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { sendWhatsappPdf } = require('../services/sendWhatsappPdf');
const { sendInvoiceEmail } = require('../services/email');

// =====================
// PRODUCTS
// =====================
const PRODUCTS = [
  { key: 'BEER', en: 'Perga Beer 5.2%', es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
  { key: 'COLA', en: 'Perga Cola', es: 'Perga Cola', price: 21.6, alcoholic: false },
  { key: 'ORANGE', en: 'Perga Orange', es: 'Perga Naranja', price: 21.6, alcoholic: false },
  { key: 'LIME', en: 'Perga Limon-Lime', es: 'Perga Limón-Lima', price: 21.6, alcoholic: false },
  { key: 'MALTA', en: 'Malta Perga', es: 'Malta Perga', price: 21.6, alcoholic: false }
];

// =====================
// HELPERS
// =====================
const normalize = n => n.replace('whatsapp:', '');
const lower = t => (t || '').trim().toLowerCase();
const t = (lang, en, es) => (lang === 'es' ? es : en);
const isYes = msg => msg.startsWith('y') || msg.startsWith('s');

// =====================
// STATE HELPERS
// =====================
async function getState(phone) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('whatsapp_number', phone)
    .maybeSingle();
  return data;
}

async function saveState(phone, state) {
  await supabase.from('conversation_state').upsert({
    whatsapp_number: phone,
    ...state,
    updated_at: new Date()
  });
}

async function resetState(phone) {
  await supabase.from('conversation_state')
    .delete()
    .eq('whatsapp_number', phone);
}

// =====================
// MAIN HANDLER
// =====================
async function handleMessage(from, body, req) {
  const twiml = new MessagingResponse();
  const phone = normalize(from);
  const msg = lower(body);

  const numMedia = parseInt(req.body.NumMedia || '0', 10);
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;

  let state = await getState(phone);

  // =====================
  // TRIGGER
  // =====================
  if (!state) {
    if (msg === 'order' || msg === 'orden') {
      await saveState(phone, {
        step: 'LANGUAGE',
        language: null,
        account: {},
        order: {}
      });
      twiml.message('English or Español?');
      return twiml.toString();
    }
    twiml.message('Send "order" or "orden" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';

  // =====================
  // LANGUAGE
  // =====================
  if (state.step === 'LANGUAGE') {
    const language = msg.startsWith('es') ? 'es' : 'en';
    await saveState(phone, { ...state, language, step: 'ACCOUNT_TYPE' });
    twiml.message(t(language, 'New or existing account?', '¿Cuenta nueva o existente?'));
    return twiml.toString();
  }

  // =====================
  // ACCOUNT TYPE
  // =====================
  if (state.step === 'ACCOUNT_TYPE') {
    const existing =
      msg.includes('exist') ||
      msg.includes('ya') ||
      msg.includes('tengo') ||
      msg.includes('old');

    await saveState(phone, {
      ...state,
      step: existing ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME'
    });

    twiml.message(t(lang, 'Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  // =====================
  // EXISTING ACCOUNT
  // =====================
  if (state.step === 'EXISTING_NAME') {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_name', body.trim())
      .eq('phone', phone)
      .maybeSingle();

    if (!data) {
      await saveState(phone, { ...state, step: 'NEW_BUSINESS_NAME' });
      twiml.message(t(lang, 'Account not found. Creating new one.', 'Cuenta no encontrada.'));
      return twiml.toString();
    }

    await saveState(phone, { ...state, account: data, step: 'PRODUCTS' });
    twiml.message(t(lang, 'Account loaded. Let’s order.', 'Cuenta cargada.'));
    return twiml.toString();
  }

  // =====================
  // NEW ACCOUNT FLOW
  // =====================
  if (state.step === 'NEW_BUSINESS_NAME') {
    await saveState(phone, {
      ...state,
      account: { business_name: body.trim(), phone },
      step: 'BUSINESS_EMAIL'
    });
    twiml.message(t(lang, 'Business email?', 'Correo del negocio?'));
    return twiml.toString();
  }

  if (state.step === 'BUSINESS_EMAIL') {
    if (!body.includes('@')) {
      twiml.message(t(lang, 'Enter a valid email.', 'Ingrese un correo válido.'));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: { ...state.account, email: body.trim() },
      step: 'TAX_QUESTION'
    });

    twiml.message(t(lang,
      'Do you have a resale tax ID? (yes/no)',
      '¿Tiene tax ID de reventa? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'TAX_QUESTION') {
    const resale = isYes(msg);
    await saveState(phone, {
      ...state,
      account: { ...state.account, tax_type: resale ? 'resale' : 'federal' },
      step: 'TAX_NUMBER'
    });

    twiml.message(t(lang, 'Enter tax ID number', 'Ingrese tax ID'));
    return twiml.toString();
  }

  if (state.step === 'TAX_NUMBER') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, tax_id: body.trim() },
      step: 'BUSINESS_ADDRESS'
    });
    twiml.message(t(lang, 'Business address?', 'Dirección del negocio?'));
    return twiml.toString();
  }

  if (state.step === 'BUSINESS_ADDRESS') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, address: body.trim() },
      step: 'CONTACT_NAME'
    });
    twiml.message(t(lang, 'Contact name?', 'Nombre del contacto?'));
    return twiml.toString();
  }

  if (state.step === 'CONTACT_NAME') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, contact_name: body.trim() },
      step: 'ALCOHOL_QUESTION'
    });
    twiml.message(t(lang,
      'Do you have an alcohol license? (yes/no)',
      '¿Tiene licencia de alcohol? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_QUESTION') {
    const yes = isYes(msg);
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license: yes },
      step: yes ? 'ALCOHOL_PHOTO' : 'SAVE_ACCOUNT'
    });

    twiml.message(yes
      ? t(lang, 'Upload license photo', 'Suba la licencia')
      : t(lang, 'Saving account… (type ok)', 'Guardando cuenta… (ok)')
    );
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_PHOTO') {
    if (!mediaType?.startsWith('image/')) {
      twiml.message(t(lang, 'Upload a photo.', 'Suba una imagen.'));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_url: mediaUrl },
      step: 'ALCOHOL_NUMBER'
    });

    twiml.message(t(lang, 'License number?', 'Número de licencia?'));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_NUMBER') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_number: body.trim() },
      step: 'SAVE_ACCOUNT'
    });
    twiml.message(t(lang, 'Saving account…', 'Guardando cuenta…'));
    return twiml.toString();
  }

  if (state.step === 'SAVE_ACCOUNT') {
    await supabase.from('businesses').upsert(state.account);
    await saveState(phone, { ...state, step: 'PRODUCTS' });
    twiml.message(t(lang, 'Account saved.', 'Cuenta guardada.'));
    return twiml.toString();
  }

  // =====================
  // PRODUCTS & QTY
  // =====================
  if (state.step === 'PRODUCTS') {
    const allowed = state.account.alcohol_license
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    await saveState(phone, {
      ...state,
      step: 'QTY',
      order: { items: [], index: 0, allowed }
    });

    const p = allowed[0];
    twiml.message(t(lang,
      `How many cases of ${p.en}?`,
      `¿Cuántas cajas de ${p.es}?`
    ));
    return twiml.toString();
  }

  if (state.step === 'QTY') {
    const qty = parseInt(msg, 10);
    if (isNaN(qty) || qty < 0) {
      twiml.message(t(lang, 'Enter a valid number.', 'Ingrese un número válido.'));
      return twiml.toString();
    }

    const { allowed, index, items } = state.order;
    items.push({ ...allowed[index], qty });

    if (index + 1 < allowed.length) {
      state.order.index++;
      await saveState(phone, state);
      const p = allowed[state.order.index];
      twiml.message(t(lang,
        `How many cases of ${p.en}?`,
        `¿Cuántas cajas de ${p.es}?`
      ));
      return twiml.toString();
    }

    let totalCases = 0;
    let subtotal = 0;

    for (const i of items) {
      if (i.qty > 0) {
        totalCases += i.qty;
        subtotal += i.qty * i.price;
      }
    }

    if (totalCases < 10) {
      await saveState(phone, { ...state, step: 'PRODUCTS' });
      twiml.message(t(lang,
        'Minimum 10 total cases. Start again.',
        'Mínimo 10 cajas. Intente de nuevo.'
      ));
      return twiml.toString();
    }

    const tax = state.account.tax_type === 'resale' ? 0 : subtotal * 0.07;
    const total = subtotal + tax;

    await saveState(phone, {
      ...state,
      step: 'CONFIRM',
      order: { items, subtotal, tax, total, totalCases }
    });

    twiml.message(
      `${t(lang, 'Total:', 'Total:')} $${total.toFixed(2)}\n` +
      t(lang, 'Reply YES to confirm', 'Responda SÍ para confirmar')
    );
    return twiml.toString();
  }

  // =====================
  // CONFIRM
  // =====================
  if (state.step === 'CONFIRM') {
    if (!isYes(msg)) {
      await resetState(phone);
      twiml.message(t(lang, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    const orderNumber = `PO-${Date.now()}`;
    const pdfPath = await generateInvoicePdf({
      orderNumber,
      business: state.account,
      order: state.order
    });

    await sendWhatsappPdf(phone, pdfPath, 'Invoice from Perga');
    await sendInvoiceEmail({
      to: state.account.email,
      subject: `Invoice ${orderNumber}`,
      text: 'Attached invoice.',
      pdfPath
    });

    await resetState(phone);

    twiml.message(t(lang,
      'Invoice sent. Thank you!',
      'Factura enviada. ¡Gracias!'
    ));
    return twiml.toString();
  }

  twiml.message('Something went wrong. Send "order" to restart.');
  return twiml.toString();
}

module.exports = { handleMessage };
