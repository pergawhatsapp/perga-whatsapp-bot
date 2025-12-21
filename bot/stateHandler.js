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

  const numMedia = parseInt(req.body.NumMedia || '0');
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

  const lang = state.language;

  // =====================
  // STEP 1 — LANGUAGE
  // =====================
  if (state.step === 'LANGUAGE') {
    const language = msg.startsWith('es') ? 'es' : 'en';
    await saveState(phone, { ...state, language, step: 'ACCOUNT_TYPE' });
    twiml.message(t(language,
      'New account or existing account?',
      '¿Cuenta nueva o cuenta existente?'
    ));
    return twiml.toString();
  }

  // =====================
  // STEP 2 — ACCOUNT TYPE
  // =====================
  if (state.step === 'ACCOUNT_TYPE') {
    const existing = msg.includes('exist');
    await saveState(phone, {
      ...state,
      step: existing ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME'
    });
    twiml.message(t(lang, 'Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  // =====================
  // STEP 3A — EXISTING ACCOUNT
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
      twiml.message(t(lang,
        'Account not found. Creating new account.',
        'Cuenta no encontrada. Creando cuenta nueva.'
      ));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: data,
      step: 'PRODUCTS'
    });

    twiml.message(t(lang,
      'Account loaded. Let’s place your order.',
      'Cuenta cargada. Vamos a ordenar.'
    ));
    return twiml.toString();
  }

  // =====================
  // STEP 3B — NEW ACCOUNT
  // =====================
  if (state.step === 'NEW_BUSINESS_NAME') {
    await saveState(phone, {
      ...state,
      account: { business_name: body.trim(), phone },
      step: 'BUSINESS_EMAIL'
    });
    twiml.message(t(lang, 'Business email address?', 'Correo electrónico del negocio?'));
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
      '¿Tiene ID de reventa? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'TAX_QUESTION') {
    const resale = msg.startsWith('y');
    await saveState(phone, {
      ...state,
      account: { ...state.account, tax_type: resale ? 'resale' : 'federal' },
      step: 'TAX_NUMBER'
    });
    twiml.message(t(lang,
      'Enter tax ID number',
      'Ingrese número de identificación fiscal'
    ));
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
      'Does your business have an alcohol license? (yes/no)',
      '¿Tiene licencia de alcohol? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_QUESTION') {
    const yes = msg.startsWith('y');
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license: yes },
      step: yes ? 'ALCOHOL_PHOTO' : 'SAVE_ACCOUNT'
    });
    twiml.message(yes
      ? t(lang, 'Upload alcohol license photo', 'Suba la foto de la licencia')
      : t(lang, 'Saving account…', 'Guardando cuenta…')
    );
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_PHOTO') {
    if (numMedia === 0 || !mediaType?.startsWith('image/')) {
      twiml.message(t(lang,
        'Please upload a license photo.',
        'Por favor suba la foto de la licencia.'
      ));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_url: mediaUrl },
      step: 'ALCOHOL_NUMBER'
    });

    twiml.message(t(lang,
      'Enter alcohol license number',
      'Ingrese número de licencia'
    ));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_NUMBER') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_number: body.trim() },
      step: 'SAVE_ACCOUNT'
    });
  }

  if (state.step === 'SAVE_ACCOUNT') {
    await supabase.from('businesses').upsert(state.account);
    await saveState(phone, { ...state, step: 'PRODUCTS' });
  }

  // =====================
  // STEP 4–5 — PRODUCTS
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
      `How many cases for ${p.en}?`,
      `¿Cuántas cajas para ${p.es}?`
    ));
    return twiml.toString();
  }

  if (state.step === 'QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t(lang,
        'Minimum is 10 cases.',
        'El mínimo es 10 cajas.'
      ));
      return twiml.toString();
    }

    const { allowed, index } = state.order;
    state.order.items.push({ ...allowed[index], qty });

    if (index + 1 < allowed.length) {
      state.order.index++;
      await saveState(phone, state);
      const p = allowed[state.order.index];
      twiml.message(t(lang,
        `How many cases for ${p.en}?`,
        `¿Cuántas cajas para ${p.es}?`
      ));
      return twiml.toString();
    }

    let total = 0;
    state.order.items.forEach(i => total += i.qty * i.price);
    state.order.total = total;

    await saveState(phone, { ...state, step: 'CONFIRM' });

    twiml.message(t(lang,
      `Order total: $${total.toFixed(2)}\nReply YES to confirm`,
      `Total del pedido: $${total.toFixed(2)}\nResponda SÍ para confirmar`
    ));
    return twiml.toString();
  }

  // =====================
  // STEP 6–8 — CONFIRM & RESET
  // =====================
  if (state.step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      await resetState(phone);
      twiml.message(t(lang, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    // 👉 Invoice generation + WhatsApp + Email goes here

    await resetState(phone);

    twiml.message(t(lang,
      'Invoice sent to your email ✓\nA sales representative will contact you to confirm order details.\nThank you for choosing Perga!',
      'Factura enviada a su correo electrónico ✓\nUn representante de ventas se comunicará con usted para confirmar los detalles del pedido.\n¡Gracias por elegir Perga!'
    ));
    return twiml.toString();
  }

  twiml.message(t(lang,
    'Please follow the order process.',
    'Por favor siga el proceso.'
  ));
  return twiml.toString();
}

module.exports = { handleMessage };
