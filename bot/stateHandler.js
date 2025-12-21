const twilio = require('twilio');
const supabase = require('../services/supabase');

const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = [
  { key: 'BEER', name_en: 'Perga Beer 5.2%', name_es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
  { key: 'COLA', name_en: 'Perga Cola', name_es: 'Perga Cola', price: 21.6, alcoholic: false },
  { key: 'ORANGE', name_en: 'Perga Orange', name_es: 'Perga Naranja', price: 21.6, alcoholic: false },
  { key: 'LIME', name_en: 'Perga Limon-Lime', name_es: 'Perga Limón-Lima', price: 21.6, alcoholic: false },
  { key: 'MALTA', name_en: 'Malta Perga', name_es: 'Malta Perga', price: 21.6, alcoholic: false }
];

/* =========================
   HELPERS
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

const t = (state, en, es) => (state.language === 'es' ? es : en);

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body, media = {}) {
  const twiml = new MessagingResponse();
  const whatsapp = from;
  const msg = (body || '').trim().toLowerCase();

  let state = await getState(whatsapp);

  /* ===== BOT TRIGGER ===== */
  if (!state && (msg === 'order' || msg === 'orden')) {
  await saveState(whatsapp, {
    current_step: 'LANGUAGE',
    language: null,
    account: {},
    order: { items: [] },
    temp: {}
  });

  twiml.message('English or Español?');
  return twiml.toString();
  }

  if (!state) {
    twiml.message('Send "Order" or "Orden" to start.');
    return twiml.toString();
  }

   // Ignore accidental restart words during active flow
if (state && (msg === 'order' || msg === 'orden')) {
  twiml.message(
    state.language === 'es'
      ? 'Su pedido ya está en progreso.'
      : 'Your order is already in progress.'
  );
  return twiml.toString();
}

  /* ===== LANGUAGE ===== */
  if (state.current_step === 'LANGUAGE') {
    state.language = msg.startsWith('es') ? 'es' : 'en';
    state.current_step = 'ACCOUNT_TYPE';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'New account or existing account?', '¿Cuenta nueva o cuenta existente?'));
    return twiml.toString();
  }

  /* ===== ACCOUNT TYPE ===== */
  if (state.current_step === 'ACCOUNT_TYPE') {
    state.current_step = msg.includes('exist') ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  /* ===== EXISTING ACCOUNT ===== */
  if (state.current_step === 'EXISTING_NAME') {
    const businessName = body.trim();
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_name', businessName)
      .eq('phone', whatsapp)
      .maybeSingle();

    if (!business) {
      state.current_step = 'NEW_BUSINESS_NAME';
      await saveState(whatsapp, state);
      twiml.message(t(state, 'Account not found. Creating new account.\nBusiness name?', 'Cuenta no encontrada. Creando cuenta nueva.\nNombre del negocio?'));
      return twiml.toString();
    }

    state.account = business;
    state.order = { items: [] };
    state.current_step = 'SELECT_PRODUCTS';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Account loaded. Let’s place your order.', 'Cuenta cargada. Vamos a ordenar.'));
    return twiml.toString();
  }

  /* ===== NEW ACCOUNT DATA COLLECTION ===== */
  if (state.current_step === 'NEW_BUSINESS_NAME') {
    state.account.business_name = body.trim();
    state.current_step = 'NEW_EMAIL';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Business email address?', 'Correo electrónico del negocio?'));
    return twiml.toString();
  }

  if (state.current_step === 'NEW_EMAIL') {
    state.account.email = body.trim();
    state.current_step = 'TAX_ID_TYPE';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Do you have a resale tax ID? (yes/no)', '¿Tiene ID de impuesto de reventa? (sí/no)'));
    return twiml.toString();
  }

  if (state.current_step === 'TAX_ID_TYPE') {
    state.temp.taxType = msg.startsWith('y') ? 'resale' : 'federal';
    state.current_step = 'TAX_ID_VALUE';
    await saveState(whatsapp, state);
    twiml.message(
      t(state,
        state.temp.taxType === 'resale' ? 'Resale tax ID number?' : 'Federal tax ID number?',
        state.temp.taxType === 'resale' ? 'Número de ID de reventa?' : 'Número de ID federal?'
      )
    );
    return twiml.toString();
  }

  if (state.current_step === 'TAX_ID_VALUE') {
    if (state.temp.taxType === 'resale') state.account.resale_tax_id = body.trim();
    else state.account.federal_tax_id = body.trim();
    state.current_step = 'BUSINESS_ADDRESS';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Business address?', 'Dirección del negocio?'));
    return twiml.toString();
  }

  if (state.current_step === 'BUSINESS_ADDRESS') {
    state.account.address = body.trim();
    state.current_step = 'CONTACT_NAME';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Contact name?', 'Nombre de contacto?'));
    return twiml.toString();
  }

  if (state.current_step === 'CONTACT_NAME') {
    state.account.contact_name = body.trim();
    state.current_step = 'ALCOHOL_LICENSE';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Does your business have an alcohol license? (yes/no)', '¿Tiene licencia de alcohol? (sí/no)'));
    return twiml.toString();
  }

  if (state.current_step === 'ALCOHOL_LICENSE') {
    state.account.alcohol_license = msg.startsWith('y');
    state.current_step = state.account.alcohol_license ? 'ALCOHOL_LICENSE_NUMBER' : 'SAVE_ACCOUNT';
    await saveState(whatsapp, state);
    twiml.message(
      state.account.alcohol_license
        ? t(state, 'Alcohol license number?', 'Número de licencia de alcohol?')
        : t(state, 'Account created. Let’s order.', 'Cuenta creada. Vamos a ordenar.')
    );
    return twiml.toString();
  }

  if (state.current_step === 'ALCOHOL_LICENSE_NUMBER') {
    state.account.alcohol_license_number = body.trim();
    state.current_step = 'SAVE_ACCOUNT';
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Account created. Let’s order.', 'Cuenta creada. Vamos a ordenar.'));
    return twiml.toString();
  }

  /* ===== SAVE BUSINESS ===== */
  if (state.current_step === 'SAVE_ACCOUNT') {
    await supabase.from('businesses').insert({
      ...state.account,
      phone: whatsapp
    });
    state.current_step = 'SELECT_PRODUCTS';
    state.order = { items: [] };
    await saveState(whatsapp, state);
    twiml.message(t(state, 'Starting order...', 'Iniciando pedido...'));
    return twiml.toString();
  }

  /* ===== PRODUCT ORDER FLOW ===== */
  if (state.current_step === 'SELECT_PRODUCTS') {
    const allowed = state.account.alcohol_license
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    state.temp = { index: 0, allowed };
    state.current_step = 'ASK_QTY';
    await saveState(whatsapp, state);

    const p = allowed[0];
    twiml.message(
      t(state,
        `How many cases of ${p.name_en}? (min 10)`,
        `¿Cuántas cajas de ${p.name_es}? (mín 10)`
      )
    );
    return twiml.toString();
  }

  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg, 10);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t(state, 'Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const { index, allowed } = state.temp;
    const product = allowed[index];

    state.order.items.push({ ...product, qty });

    if (index + 1 < allowed.length) {
      state.temp.index++;
      await saveState(whatsapp, state);
      const next = allowed[state.temp.index];
      twiml.message(
        t(state,
          `How many cases of ${next.name_en}?`,
          `¿Cuántas cajas de ${next.name_es}?`
        )
      );
      return twiml.toString();
    }

    let total = 0;
    let summary = '';
    state.order.items.forEach(i => {
      const line = i.qty * i.price;
      total += line;
      summary += `${i.name_en}: ${i.qty} → $${line.toFixed(2)}\n`;
    });

    state.order.total = total;
    state.current_step = 'CONFIRM';
    await saveState(whatsapp, state);

    twiml.message(
      `${summary}\nTOTAL: $${total.toFixed(2)}\n\nReply YES to confirm`
    );
    return twiml.toString();
  }

  /* ===== CONFIRM ===== */
  if (state.current_step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      twiml.message(t(state, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    // 👉 NEXT STEP: generate invoice + email
    await supabase.from('conversation_state').delete().eq('whatsapp_number', whatsapp);

    twiml.message(
      t(
        state,
        'Invoice sent to your email ✓\nA sales representative will contact you.\nThank you for choosing Perga!',
        'Factura enviada a su correo ✓\nUn representante se comunicará con usted.\n¡Gracias por elegir Perga!'
      )
    );
    return twiml.toString();
  }

  twiml.message(t(state, 'Type "order" to start.', 'Escriba "orden" para comenzar.'));
  return twiml.toString();
}

module.exports = { handleMessage };
