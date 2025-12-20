const twilio = require('twilio');
const supabase = require('../services/supabase');

const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = [
  { id: 1, key: 'BEER', name_en: 'Perga Beer 5.2%', name_es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
  { id: 2, key: 'COLA', name_en: 'Perga Cola', name_es: 'Perga Cola', price: 21.6, alcoholic: false },
  { id: 3, key: 'ORANGE', name_en: 'Perga Orange', name_es: 'Perga Naranja', price: 21.6, alcoholic: false },
  { id: 4, key: 'LIME', name_en: 'Perga Limon-Lime', name_es: 'Perga Limón-Lima', price: 21.6, alcoholic: false },
  { id: 5, key: 'MALTA', name_en: 'Malta Perga', name_es: 'Malta Perga', price: 21.6, alcoholic: false }
];

/* =========================
   DB HELPERS
========================= */
async function getState(whatsapp) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .maybeSingle();
  return data;
}

async function saveState(whatsapp, state) {
  await supabase.from('conversation_state').upsert({
    whatsapp_number: whatsapp,
    ...state,
    updated_at: new Date()
  });
}

function goBack(state) {
  const history = state.temp_data.step_history || [];
  history.pop();
  return history.pop();
}

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body) {
  const twiml = new MessagingResponse();
  const msg = body.trim().toLowerCase();
  let state = await getState(from);

  /* ===== START ===== */
  if (!state && msg === 'order') {
    await saveState(from, {
      current_step: 'LANGUAGE',
      language: null,
      temp_data: { step_history: [] },
      order_items: {}
    });
    twiml.message('English or Español?');
    return twiml.toString();
  }

  if (!state) {
    twiml.message('Send "order" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* ===== BACK ===== */
  if (msg === 'back' || msg === 'atrás') {
    const prev = goBack(state);
    if (!prev) {
      twiml.message(t('Cannot go back.', 'No se puede regresar.'));
      return twiml.toString();
    }
    state.current_step = prev;
    await saveState(from, state);
    twiml.message(t('Going back.', 'Regresando.'));
    return twiml.toString();
  }

  /* ===== LANGUAGE ===== */
  if (state.current_step === 'LANGUAGE') {
    state.language = msg.includes('es') ? 'es' : 'en';
    state.current_step = 'ACCOUNT_TYPE';
    state.temp_data.step_history.push('LANGUAGE');
    await saveState(from, state);
    twiml.message(t('New or existing account?', '¿Cuenta nueva o existente?'));
    return twiml.toString();
  }

  /* ===== ACCOUNT TYPE ===== */
  if (state.current_step === 'ACCOUNT_TYPE') {
    state.temp_data.step_history.push('ACCOUNT_TYPE');

    state.current_step = msg.includes('existing')
      ? 'EXISTING_NAME'
      : 'NEW_BUSINESS';

    await saveState(from, state);
    twiml.message(t('Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  /* ===== EXISTING ACCOUNT ===== */
  if (state.current_step === 'EXISTING_NAME') {
    const businessName = body.trim();

    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_name', businessName)
      .eq('phone', from)
      .maybeSingle();

    if (!business) {
      state.current_step = 'ACCOUNT_TYPE';
      await saveState(from, state);
      twiml.message(t(
        'Business not found. Create new account?',
        'Negocio no encontrado. ¿Crear cuenta nueva?'
      ));
      return twiml.toString();
    }

    state.temp_data = {
      ...state.temp_data,
      business_name: business.business_name,
      email: business.email,
      phone: business.phone,
      address: business.address,
      contact_name: business.contact_name,
      tax_exempt: business.tax_id_type === 'resale',
      alcohol_license: business.alcohol_license,
      license_number: business.license_number
    };

    state.current_step = 'SELECT_PRODUCTS';
    await saveState(from, state);
    twiml.message(t('Account loaded. Let’s order.', 'Cuenta cargada. Vamos a ordenar.'));
    return twiml.toString();
  }

  /* ===== NEW BUSINESS ===== */
  if (state.current_step === 'NEW_BUSINESS') {
    state.temp_data.business_name = body;
    state.temp_data.tax_exempt = false;
    state.temp_data.alcohol_license = false;
    state.temp_data.step_history.push('NEW_BUSINESS');
    state.current_step = 'SELECT_PRODUCTS';

    await saveState(from, state);
    twiml.message(t(
      'Account created. Let’s select products.',
      'Cuenta creada. Vamos a seleccionar productos.'
    ));
    return twiml.toString();
  }

  /* ===== PRODUCT LIST ===== */
  if (state.current_step === 'SELECT_PRODUCTS') {
    const allowed = state.temp_data.alcohol_license
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    state.temp_data.allowed = allowed;
    state.temp_data.index = 0;
    state.temp_data.step_history.push('SELECT_PRODUCTS');
    state.current_step = 'ASK_QTY';

    await saveState(from, state);
    const p = allowed[0];

    twiml.message(t(
      `How many cases for ${p.name_en}? (min 10)`,
      `¿Cuántas cajas para ${p.name_es}? (mín 10)`
    ));
    return twiml.toString();
  }

  /* ===== QUANTITY ===== */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t('Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const product = state.temp_data.allowed[state.temp_data.index];
    state.order_items[product.key] = qty;
    state.temp_data.index++;

    if (state.temp_data.index < state.temp_data.allowed.length) {
      await saveState(from, state);
      const next = state.temp_data.allowed[state.temp_data.index];
      twiml.message(t(
        `How many cases for ${next.name_en}?`,
        `¿Cuántas cajas para ${next.name_es}?`
      ));
      return twiml.toString();
    }

    /* ===== REVIEW ===== */
    let subtotal = 0;
    let summary = '';

    for (const key in state.order_items) {
      const p = PRODUCTS.find(x => x.key === key);
      const line = state.order_items[key] * p.price;
      subtotal += line;
      summary += `${p.name_en}: ${state.order_items[key]} → $${line.toFixed(2)}\n`;
    }

    const tax = state.temp_data.tax_exempt ? 0 : subtotal * 0.07;
    const total = subtotal + tax;

    state.current_step = 'CONFIRM';
    await saveState(from, state);

    twiml.message(
      `ORDER REVIEW\n\n${summary}\nSubtotal: $${subtotal.toFixed(2)}\nTax: $${tax.toFixed(2)}\nTOTAL: $${total.toFixed(2)}\n\nReply YES to confirm`
    );
    return twiml.toString();
  }

  /* ===== CONFIRM ===== */
  if (state.current_step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      twiml.message('Order cancelled.');
      return twiml.toString();
    }

    await supabase.from('conversation_state').delete().eq('whatsapp_number', from);
    twiml.message(t(
      'Invoice will be sent shortly. Thank you for choosing Perga!',
      'La factura será enviada pronto. ¡Gracias por elegir Perga!'
    ));
    return twiml.toString();
  }

  /* ===== SAFETY FALLBACK ===== */
  twiml.message(t(
    'I didn’t understand that. Type "back" to go back.',
    'No entendí eso. Escriba "back" para regresar.'
  ));
  return twiml.toString();
}

module.exports = { handleMessage };
