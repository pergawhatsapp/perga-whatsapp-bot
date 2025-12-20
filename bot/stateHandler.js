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
function normalizeWhatsApp(from) {
  return from.replace('whatsapp:', '');
}

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

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body) {
  const twiml = new MessagingResponse();
  const whatsapp = normalizeWhatsApp(from);
  const msg = (body || '').trim().toLowerCase();

  let state = await getState(whatsapp);

  /* ===== BOT TRIGGER ===== */
  if (!state && (msg === 'order' || msg === 'orden')) {
    await saveState(whatsapp, {
      current_step: 'LANGUAGE',
      language: null,
      account: {},
      order: { items: [] }
    });

    twiml.message('English or Español?');
    return twiml.toString();
  }

  if (!state) {
    twiml.message('Send "Order" or "Orden" to start.');
    return twiml.toString();
  }

  const t = (en, es) => (state.language === 'es' ? es : en);

  /* ===== LANGUAGE ===== */
  if (state.current_step === 'LANGUAGE') {
    const language = msg.includes('es') ? 'es' : 'en';

    await saveState(whatsapp, {
      ...state,
      language,
      current_step: 'ACCOUNT_TYPE'
    });

    twiml.message(
      language === 'es'
        ? '¿Cuenta nueva o cuenta existente?'
        : 'New account or existing account?'
    );
    return twiml.toString();
  }

  /* ===== ACCOUNT TYPE ===== */
  if (state.current_step === 'ACCOUNT_TYPE') {
    const isExisting = msg.includes('exist');

    await saveState(whatsapp, {
      ...state,
      current_step: isExisting ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME'
    });

    twiml.message(
      t('Business name?', '¿Nombre del negocio?')
    );
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
      await saveState(whatsapp, {
        ...state,
        current_step: 'ACCOUNT_TYPE'
      });

      twiml.message(
        t(
          'Business not found. Create new account?',
          'Negocio no encontrado. ¿Crear cuenta nueva?'
        )
      );
      return twiml.toString();
    }

    await saveState(whatsapp, {
      ...state,
      account: business,
      current_step: 'SELECT_PRODUCTS'
    });

    twiml.message(
      t('Account loaded. Let’s place your order.', 'Cuenta cargada. Vamos a ordenar.')
    );
    return twiml.toString();
  }

  /* ===== NEW ACCOUNT (MINIMAL FOR NOW) ===== */
  if (state.current_step === 'NEW_BUSINESS_NAME') {
    await saveState(whatsapp, {
      ...state,
      account: { business_name: body.trim() },
      current_step: 'SELECT_PRODUCTS'
    });

    twiml.message(
      t('Account created. Let’s order.', 'Cuenta creada. Vamos a ordenar.')
    );
    return twiml.toString();
  }

  /* ===== PRODUCT SELECTION ===== */
  if (state.current_step === 'SELECT_PRODUCTS') {
    const allowed = state.account.alcohol_license
      ? PRODUCTS
      : PRODUCTS.filter(p => !p.alcoholic);

    let list = allowed.map(
      p => `• ${state.language === 'es' ? p.name_es : p.name_en}`
    ).join('\n');

    await saveState(whatsapp, {
      ...state,
      current_step: 'ASK_QTY',
      temp: { index: 0, allowed }
    });

    twiml.message(
      t(
        `How many cases for ${allowed[0].name_en}? (min 10)`,
        `¿Cuántas cajas para ${allowed[0].name_es}? (mín 10)`
      )
    );
    return twiml.toString();
  }

  /* ===== QUANTITY LOOP ===== */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t('Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const { index, allowed } = state.temp;
    const product = allowed[index];

    state.order.items.push({
      key: product.key,
      qty,
      price: product.price
    });

    state.temp.index++;

    if (state.temp.index < allowed.length) {
      await saveState(whatsapp, state);
      const next = allowed[state.temp.index];
      twiml.message(
        t(
          `How many cases for ${next.name_en}?`,
          `¿Cuántas cajas para ${next.name_es}?`
        )
      );
      return twiml.toString();
    }

    /* ===== REVIEW ===== */
    let total = 0;
    let summary = '';

    state.order.items.forEach(i => {
      const line = i.qty * i.price;
      total += line;
      summary += `${i.key}: ${i.qty} → $${line.toFixed(2)}\n`;
    });

    await saveState(whatsapp, {
      ...state,
      current_step: 'CONFIRM'
    });

    twiml.message(
      `ORDER SUMMARY\n\n${summary}\nTOTAL: $${total.toFixed(2)}\n\nReply YES to confirm`
    );
    return twiml.toString();
  }

  /* ===== CONFIRM ===== */
  if (state.current_step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      twiml.message(t('Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    await supabase
      .from('conversation_state')
      .delete()
      .eq('whatsapp_number', whatsapp);

    twiml.message(
      t(
        'Invoice will be sent shortly. Thank you for choosing Perga!',
        'La factura será enviada pronto. ¡Gracias por elegir Perga!'
      )
    );
    return twiml.toString();
  }

  /* ===== FALLBACK ===== */
  twiml.message(
    t(
      'I didn’t understand that. Type "order" to start.',
      'No entendí eso. Escriba "orden" para comenzar.'
    )
  );
  return twiml.toString();
}

module.exports = { handleMessage };
