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
  const prev = history.pop();

  if (prev === 'SELECT_PRODUCTS') {
    state.order_items = {};
  }
  return prev;
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

    if (msg.includes('existing')) {
      state.current_step = 'EXISTING_NAME';
      await saveState(from, state);
      twiml.message(t('Business name?', '¿Nombre del negocio?'));
      return twiml.toString();
    }

    state.current_step = 'NEW_BUSINESS';
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

  /* ===== NEW BUSINESS (TEMP SHORT) ===== */
  if (state.current_step === 'NEW_BUSINESS') {
    state.temp_data.business_name = body;
    state.temp_data.tax_exempt = false;
    state.temp_data.alcohol_license = false;
    state.temp_data.step_history.push('NEW_BUSINESS');
    state.current_step = 'SELECT_PRODUCTS';
    await saveState(from, state);
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

    const list = allowed.map(p => `${p.id}. ${t(p.name_en, p.name_es)}`).join('\n');
    twiml.message(t(
      `How many cases for ${allowed[0].name_en}?`,
      `¿Cuántas cajas para ${allowed[0].name_es}?`
    ));
    return twiml.toString();
  }

  /* ===== QUANTITY ===== */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 0) {
      twiml.message(t('Invalid quantity.', 'Cantidad inválida.'));
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
    let totalCases = 0;
    let summary = '';

    for (const key in state.order_items) {
      const p = PRODUCTS.find(x => x.key === key);
      const qty = state.order_items[key];
      const line = qty * p.price;
      subtotal += line;
      totalCases += qty;
      summary += `${p.name_en}: ${qty} → $${line.toFixed(2)}\n`;
    }

    if (totalCases < 10) {
      state.current_step = 'SELECT_PRODUCTS';
      await saveState(from, state);
      twiml.message(t(
        'Minimum order is 10 total cases.',
        'El pedido mínimo es de 10 cajas en total.'
      ));
      return twiml.toString();
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

    const { generateInvoice } = require('../services/invoice');
    const { uploadInvoice } = require('../services/storage');
    const { sendInvoiceEmail } = require('../services/email');

    const items = Object.keys(state.order_items).map(key => {
      const p = PRODUCTS.find(x => x.key === key);
      return { name: p.name_en, qty: state.order_items[key], price: p.price };
    });

    const paymentTerms =
      state.temp_data.business_name?.toLowerCase().includes('supermart')
        ? 'Net 30 days'
        : 'Due on receipt';

    const pdf = await generateInvoice({
      business_name: state.temp_data.business_name,
      contact_name: state.temp_data.contact_name || 'N/A',
      email: state.temp_data.email || '',
      phone: state.temp_data.phone || '',
      address: state.temp_data.address || '',
      alcohol_license: state.temp_data.alcohol_license,
      license_number: state.temp_data.license_number,
      tax_exempt: state.temp_data.tax_exempt,
      payment_terms: paymentTerms,
      items
    });

    const invoiceUrl = await uploadInvoice(pdf);

    await sendInvoiceEmail(state.temp_data.email, pdf);

    const mediaMsg = new MessagingResponse();
    mediaMsg.message({
      body: '📄 Invoice ready',
      mediaUrl: invoiceUrl
    });

    await supabase.from('conversation_state').delete().eq('whatsapp_number', from);

    return mediaMsg.toString();
  }
}

module.exports = { handleMessage };
