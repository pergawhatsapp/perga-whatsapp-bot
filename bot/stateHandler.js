const twilio = require('twilio');
const supabase = require('../services/supabase');

const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS (STATIC FOR NOW)
========================= */
const PRODUCTS = [
  { id: 1, key: 'BEER', name_en: 'Perga Beer 5.2%', name_es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
  { id: 2, key: 'COLA', name_en: 'Perga Cola', name_es: 'Perga Cola', price: 21.6, alcoholic: false },
  { id: 3, key: 'ORANGE', name_en: 'Perga Orange', name_es: 'Perga Naranja', price: 21.6, alcoholic: false },
  { id: 4, key: 'LIME', name_en: 'Perga Limon-Lime', name_es: 'Perga Limón-Lima', price: 21.6, alcoholic: false },
  { id: 5, key: 'MALTA', name_en: 'Malta Perga', name_es: 'Malta Perga', price: 21.6, alcoholic: false }
];

/* =========================
   DATABASE HELPERS
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

function previousStep(state) {
  const history = state.temp_data.step_history || [];
  history.pop(); // remove current
  return history.pop(); // go back
}

/* =========================
   MAIN BOT HANDLER
========================= */
async function handleMessage(from, body) {
  const twiml = new MessagingResponse();
  const msg = body.trim().toLowerCase();

  let state = await getState(from);

  /* =========================
     START
  ========================= */
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

  /* =========================
     BACK COMMAND
  ========================= */
  if (msg === 'back' || msg === 'atrás') {
    const step = previousStep(state);
    if (!step) {
      twiml.message('Cannot go back.');
      return twiml.toString();
    }

    state.current_step = step;
    await saveState(from, state);
    twiml.message('Okay, going back.');
    return twiml.toString();
  }

  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* =========================
     LANGUAGE
  ========================= */
  if (state.current_step === 'LANGUAGE') {
    state.language = msg.includes('es') ? 'es' : 'en';
    state.current_step = 'ACCOUNT_TYPE';
    state.temp_data.step_history.push('LANGUAGE');

    await saveState(from, state);
    twiml.message(t('New or existing account?', '¿Cuenta nueva o existente?'));
    return twiml.toString();
  }

  /* =========================
     ACCOUNT TYPE
  ========================= */
  if (state.current_step === 'ACCOUNT_TYPE') {
  state.temp_data.step_history.push('ACCOUNT_TYPE');

  if (msg.includes('existing')) {
    state.current_step = 'EXISTING_NAME';
    await saveState(from, state);
    twiml.message(
      state.language === 'es'
        ? '¿Nombre del negocio?'
        : 'Business name?'
    );
    return twiml.toString();
  }

  state.current_step = 'NEW_BUSINESS';
  await saveState(from, state);
  twiml.message(
    state.language === 'es'
      ? '¿Nombre del negocio?'
      : 'Business name?'
  );
  return twiml.toString();
}

  /* =========================
     NEW BUSINESS FLOW (SHORTENED)
  ========================= */
  if (state.current_step === 'NEW_BUSINESS') {
    state.temp_data.business_name = body;
    state.current_step = 'TAX_ID';
    state.temp_data.step_history.push('NEW_BUSINESS');

    await saveState(from, state);
    twiml.message(t('Do you have a resale tax ID? (yes/no)', '¿Tiene ID de reventa? (sí/no)'));
    return twiml.toString();
  }

  if (state.current_step === 'TAX_ID') {
    state.temp_data.tax_exempt = msg.startsWith('y') || msg.startsWith('s');
    state.current_step = 'SELECT_PRODUCTS';
    state.temp_data.step_history.push('TAX_ID');

    await saveState(from, state);
  }

  /* =========================
     PRODUCT SELECTION
  ========================= */
  if (state.current_step === 'SELECT_PRODUCTS') {
    const allowed = state.temp_data.tax_exempt
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    const list = allowed.map(p => `${p.id}. ${t(p.name_en, p.name_es)}`).join('\n');

    state.current_step = 'ASK_QTY';
    state.temp_data.allowed = allowed;
    state.temp_data.index = 0;
    state.temp_data.step_history.push('SELECT_PRODUCTS');

    await saveState(from, state);
    twiml.message(t(
      `Select products by number:\n${list}`,
      `Seleccione productos por número:\n${list}`
    ));
    return twiml.toString();
  }

  /* =========================
     QUANTITY PER PRODUCT
  ========================= */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t('Minimum 10 cases.', 'Mínimo 10 cajas.'));
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

    /* =========================
       REVIEW
    ========================= */
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

    await saveState(from, { ...state, current_step: 'CONFIRM' });

    twiml.message(
      `ORDER REVIEW\n\n${summary}\nSubtotal: $${subtotal.toFixed(2)}\nTax: $${tax.toFixed(2)}\nTOTAL: $${total.toFixed(2)}\n\nReply YES to confirm`
    );

    return twiml.toString();
  }

  /* =========================
     CONFIRM
  ========================= */
  if (state.current_step === 'CONFIRM') {
  if (!msg.startsWith('y')) {
    twiml.message('Order cancelled.');
    return twiml.toString();
  }

  const { generateInvoice } = require('../services/invoice');
  const { sendInvoiceEmail } = require('../services/email');

  const items = Object.keys(state.order_items).map(key => {
    const p = PRODUCTS.find(x => x.key === key);
    return {
      name: p.name_en,
      qty: state.order_items[key],
      price: p.price
    };
  });

  const pdf = await generateInvoice({
    business_name: state.temp_data.business_name,
    contact_name: state.temp_data.contact_name || 'N/A',
    email: state.temp_data.email,
    phone: state.temp_data.phone || '',
    address: state.temp_data.address || '',
    alcohol_license: state.temp_data.alcohol_license,
    license_number: state.temp_data.license_number,
    tax_exempt: state.temp_data.tax_exempt,
    items
  });

  await sendInvoiceEmail(state.temp_data.email, pdf);
  await sendInvoiceEmail(process.env.COMPANY_EMAIL, pdf);

  await supabase.from('conversation_state').delete().eq('whatsapp_number', from);

  twiml.message(
    state.language === 'es'
      ? 'Factura enviada ✓ Un representante se comunicará con usted. ¡Gracias por elegir Perga!'
      : 'Invoice sent ✓ A sales representative will contact you. Thank you for choosing Perga!'
  );

  return twiml.toString();
}

module.exports = { handleMessage };
