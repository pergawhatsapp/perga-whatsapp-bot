const twilio = require('twilio');
const supabase = require('../services/supabase');
const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = [
  { key: 'BEER', en: 'Perga Beer 5.2%', es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
  { key: 'COLA', en: 'Perga Cola', es: 'Perga Cola', price: 21.6, alcoholic: false },
  { key: 'ORANGE', en: 'Perga Orange', es: 'Perga Naranja', price: 21.6, alcoholic: false },
  { key: 'LIME', en: 'Perga Limon-Lime', es: 'Perga Limón-Lima', price: 21.6, alcoholic: false },
  { key: 'MALTA', en: 'Malta Perga', es: 'Malta Perga', price: 21.6, alcoholic: false }
];

const normalize = from => from.replace('whatsapp:', '');
const t = (s, en, es) => (s.language === 'es' ? es : en);

/* =========================
   STATE HELPERS
========================= */
async function getState(whatsapp) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .maybeSingle();
  return data;
}

async function saveState(whatsapp, patch) {
  await supabase.from('conversation_state').upsert({
    whatsapp_number: whatsapp,
    ...patch,
    updated_at: new Date()
  });
}

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body, media = []) {
  const twiml = new MessagingResponse();
  const whatsapp = normalize(from);
  const msg = (body || '').trim().toLowerCase();
  let state = await getState(whatsapp);

  /* =========================
     BOT TRIGGER
  ========================= */
  if ((msg === 'order' || msg === 'orden') && (!state || state.current_step === 'DONE')) {
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

  /* =========================
     LANGUAGE
  ========================= */
  if (state.current_step === 'LANGUAGE') {
    const language = msg.startsWith('es') ? 'es' : 'en';
    await saveState(whatsapp, { ...state, language, current_step: 'ACCOUNT_TYPE' });
    twiml.message(t(state, 'New account or existing account?', '¿Cuenta nueva o cuenta existente?'));
    return twiml.toString();
  }

  /* =========================
     ACCOUNT TYPE
  ========================= */
  if (state.current_step === 'ACCOUNT_TYPE') {
    const existing = msg.includes('exist');
    await saveState(whatsapp, {
      ...state,
      current_step: existing ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME'
    });
    twiml.message(t(state, 'Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  /* =========================
     EXISTING ACCOUNT
  ========================= */
  if (state.current_step === 'EXISTING_NAME') {
    const name = body.trim();
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('business_name', name)
      .eq('phone', whatsapp)
      .maybeSingle();

    if (!data) {
      await saveState(whatsapp, { ...state, current_step: 'ACCOUNT_TYPE' });
      twiml.message(t(state, 'Account not found. Create new account?', 'Cuenta no encontrada. ¿Crear nueva cuenta?'));
      return twiml.toString();
    }

    await saveState(whatsapp, {
      ...state,
      account: data,
      current_step: 'SELECT_PRODUCTS'
    });
    twiml.message(t(state, 'Account loaded. Let’s place your order.', 'Cuenta cargada. Vamos a ordenar.'));
    return twiml.toString();
  }

  /* =========================
     NEW ACCOUNT FLOW
  ========================= */
  if (state.current_step === 'NEW_BUSINESS_NAME') {
    await saveState(whatsapp, {
      ...state,
      account: { business_name: body.trim() },
      current_step: 'BUSINESS_EMAIL'
    });
    twiml.message(t(state, 'Business email for invoices?', 'Correo electrónico del negocio para facturas?'));
    return twiml.toString();
  }

  if (state.current_step === 'BUSINESS_EMAIL') {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, email: body.trim() },
      current_step: 'TAX_TYPE'
    });
    twiml.message(t(state, 'Do you have a resale tax ID? (yes/no)', '¿Tiene ID de reventa? (sí/no)'));
    return twiml.toString();
  }

  if (state.current_step === 'TAX_TYPE') {
    const resale = msg.startsWith('y');
    await saveState(whatsapp, {
      ...state,
      temp: { resale },
      current_step: resale ? 'RESELLER_ID' : 'FEDERAL_ID'
    });
    twiml.message(t(state, 'Enter tax ID number', 'Ingrese número de identificación fiscal'));
    return twiml.toString();
  }

  if (['RESELLER_ID', 'FEDERAL_ID'].includes(state.current_step)) {
    await saveState(whatsapp, {
      ...state,
      account: {
        ...state.account,
        tax_id: body.trim(),
        tax_type: state.current_step === 'RESELLER_ID' ? 'resale' : 'federal'
      },
      current_step: 'BUSINESS_ADDRESS'
    });
    twiml.message(t(state, 'Business address?', 'Dirección del negocio?'));
    return twiml.toString();
  }

  if (state.current_step === 'BUSINESS_ADDRESS') {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, address: body.trim() },
      current_step: 'BUSINESS_PHONE'
    });
    twiml.message(t(state, 'Business phone number?', 'Teléfono del negocio?'));
    return twiml.toString();
  }

  if (state.current_step === 'BUSINESS_PHONE') {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, phone: body.trim() },
      current_step: 'CONTACT_NAME'
    });
    twiml.message(t(state, 'Contact name?', 'Nombre del contacto?'));
    return twiml.toString();
  }

  if (state.current_step === 'CONTACT_NAME') {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, contact_name: body.trim() },
      current_step: 'ALCOHOL_LICENSE'
    });
    twiml.message(t(state, 'Do you have an alcohol license? (yes/no)', '¿Tiene licencia de alcohol? (sí/no)'));
    return twiml.toString();
  }

  if (state.current_step === 'ALCOHOL_LICENSE') {
    const yes = msg.startsWith('y');
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, alcohol_license: yes },
      current_step: yes ? 'ALCOHOL_PHOTO' : 'SELECT_PRODUCTS'
    });
    twiml.message(
      yes
        ? t(state, 'Upload alcohol license photo', 'Suba la foto de la licencia')
        : t(state, 'Let’s place your order.', 'Vamos a ordenar.')
    );
    return twiml.toString();
  }

  if (state.current_step === 'ALCOHOL_PHOTO' && media.length) {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, alcohol_license_url: media[0] },
      current_step: 'ALCOHOL_NUMBER'
    });
    twiml.message(t(state, 'Enter license number', 'Ingrese número de licencia'));
    return twiml.toString();
  }

  if (state.current_step === 'ALCOHOL_NUMBER') {
    await saveState(whatsapp, {
      ...state,
      account: { ...state.account, alcohol_license_number: body.trim() },
      current_step: 'SELECT_PRODUCTS'
    });
    twiml.message(t(state, 'Let’s place your order.', 'Vamos a ordenar.'));
    return twiml.toString();
  }

  /* =========================
     PRODUCTS & ORDER
  ========================= */
  if (state.current_step === 'SELECT_PRODUCTS') {
    const allowed = state.account.alcohol_license
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    await saveState(whatsapp, {
      ...state,
      temp: { index: 0, allowed },
      current_step: 'ASK_QTY'
    });

    const p = allowed[0];
    twiml.message(t(state, `How many cases for ${p.en}? (min 10)`, `¿Cuántas cajas para ${p.es}? (mín 10)`));
    return twiml.toString();
  }

  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t(state, 'Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const { index, allowed } = state.temp;
    const product = allowed[index];
    const items = [...state.order.items, { ...product, qty }];

    if (index + 1 < allowed.length) {
      await saveState(whatsapp, {
        ...state,
        order: { items },
        temp: { index: index + 1, allowed }
      });
      const next = allowed[index + 1];
      twiml.message(t(state, `How many cases for ${next.en}?`, `¿Cuántas cajas para ${next.es}?`));
      return twiml.toString();
    }

    let total = 0;
    let summary = '';
    items.forEach(i => {
      const line = i.qty * i.price;
      total += line;
      summary += `${i.key}: ${i.qty} → $${line.toFixed(2)}\n`;
    });

    await saveState(whatsapp, {
      ...state,
      order: { items, total },
      current_step: 'CONFIRM'
    });

    twiml.message(`ORDER SUMMARY\n\n${summary}\nTOTAL: $${total.toFixed(2)}\n\nReply YES to confirm`);
    return twiml.toString();
  }

  if (state.current_step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      twiml.message(t(state, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    // 🔥 Invoice generation + email happens here (already planned)

    await saveState(whatsapp, { current_step: 'DONE' });

    twiml.message(
      t(
        state,
        'Invoice sent to your email ✓\nA sales representative will contact you.\nThank you for choosing Perga!',
        'Factura enviada a su correo ✓\nUn representante se comunicará con usted.\n¡Gracias por elegir Perga!'
      )
    );
    return twiml.toString();
  }

  twiml.message(t(state, 'Send "order" to start.', 'Envíe "orden" para comenzar.'));
  return twiml.toString();
}

module.exports = { handleMessage };
