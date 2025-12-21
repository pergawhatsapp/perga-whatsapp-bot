const twilio = require('twilio');
const MessagingResponse = twilio.twiml.MessagingResponse;

const supabase = require('../services/supabaseClient');

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
  await supabase
    .from('conversation_state')
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
  // START
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
    const existing = msg.includes('exist') || msg.includes('old');
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
  // NEW ACCOUNT
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
      step: 'SAVE_ACCOUNT'
    });
    twiml.message(t(lang, 'Saving account…', 'Guardando cuenta…'));
    return twiml.toString();
  }

  if (state.step === 'SAVE_ACCOUNT') {
    await supabase.from('businesses').upsert(state.account);
    await saveState(phone, { ...state, step: 'PRODUCTS' });
    twiml.message(t(lang, 'Account saved. Let’s order.', 'Cuenta guardada.'));
    return twiml.toString();
  }

  // =====================
  // PRODUCTS
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
      totalCases += i.qty;
      subtotal += i.qty * i.price;
    }

    if (totalCases < 10) {
      await resetState(phone);
      twiml.message(t(lang,
        'Minimum order is 10 total cases.',
        'El pedido mínimo es de 10 cajas.'
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
      `Total: $${total.toFixed(2)}\n` +
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

    await supabase.from('orders').insert({
      phone,
      business_name: state.account.business_name,
      items: state.order.items,
      total: state.order.total,
      created_at: new Date()
    });

    await resetState(phone);

    twiml.message(t(lang,
         '✅ Invoice will soon be sent to your email ✓\n A sales representative will contact you to confirm order details.\nThank you for choosing Perga!',
         '✅ La factura se enviará pronto a su correo electrónico. ✓\nUn representante de ventas se comunicará con usted para confirmar los detalles del pedido.\n¡Gracias por elegir Perga!'
    ));
    return twiml.toString();
  }

  twiml.message('Send "order" to start again.');
  return twiml.toString();
}

// ✅ CORRECT EXPORT
module.exports = handleMessage;
