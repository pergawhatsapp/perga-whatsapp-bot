const twilio = require('twilio');
const supabase = require('../services/supabase');

const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = [
  { id: 1, key: 'PERGA_COLA', name_en: 'Perga Cola', name_es: 'Perga Cola', price: 21.6 },
  { id: 2, key: 'PERGA_ORANGE', name_en: 'Perga Orange', name_es: 'Perga Naranja', price: 21.6 },
  { id: 3, key: 'PERGA_LIME', name_en: 'Perga Lime', name_es: 'Perga Limón-Lima', price: 21.6 },
  { id: 4, key: 'MALTA', name_en: 'Malta Perga', name_es: 'Malta Perga', price: 21.6 }
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

async function resetState(whatsapp) {
  await supabase
    .from('conversation_state')
    .delete()
    .eq('whatsapp_number', whatsapp);
}

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body = '') {
  const twiml = new MessagingResponse();
  const msg = body.trim().toLowerCase();

  /* ===== HARD RESTART (ABSOLUTE PRIORITY) ===== */
  if (msg === 'order') {
    await resetState(from);

    await saveState(from, {
      current_step: 'LANGUAGE',
      language: null,
      temp_data: {},
      order_items: {}
    });

    twiml.message('English or Español?');
    return twiml.toString();
  }

  /* ===== LOAD STATE AFTER ORDER CHECK ===== */
  const state = await getState(from);

  if (!state) {
    twiml.message('Send "Order" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* ===== LANGUAGE ===== */
  if (state.current_step === 'LANGUAGE') {
    state.language = msg.includes('es') ? 'es' : 'en';
    state.current_step = 'SELECT_PRODUCTS';

    await saveState(from, state);

    const list = PRODUCTS
      .map(p => `${p.id}. ${t(p.name_en, p.name_es)}`)
      .join('\n');

    twiml.message(t(
      `Select products by number (ex: 1,3) or type ALL:\n${list}`,
      `Seleccione productos por número (ej: 1,3) o escriba ALL:\n${list}`
    ));
    return twiml.toString();
  }

  /* ===== SELECT PRODUCTS ===== */
  if (state.current_step === 'SELECT_PRODUCTS') {
    let selected = [];

    if (msg === 'all') {
      selected = PRODUCTS.map(p => p.key);
    } else {
      const nums = msg.split(/[\s,]+/).map(n => parseInt(n)).filter(Boolean);
      selected = PRODUCTS.filter(p => nums.includes(p.id)).map(p => p.key);
    }

    if (!selected.length) {
      twiml.message(t('Invalid selection.', 'Selección inválida.'));
      return twiml.toString();
    }

    state.temp_data = { selected, index: 0 };
    state.order_items = {};
    state.current_step = 'ASK_QTY';

    await saveState(from, state);

    const first = PRODUCTS.find(p => p.key === selected[0]);

    twiml.message(t(
      `How many cases for ${first.name_en}? (min 10)`,
      `¿Cuántas cajas para ${first.name_es}? (mín 10)`
    ));
    return twiml.toString();
  }

  /* ===== ASK QTY ===== */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);
    if (isNaN(qty) || qty < 10) {
      twiml.message(t('Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const key = state.temp_data.selected[state.temp_data.index];
    state.order_items[key] = qty;
    state.temp_data.index++;

    if (state.temp_data.index < state.temp_data.selected.length) {
      const nextKey = state.temp_data.selected[state.temp_data.index];
      const next = PRODUCTS.find(p => p.key === nextKey);

      await saveState(from, state);
      twiml.message(t(
        `How many cases for ${next.name_en}?`,
        `¿Cuántas cajas para ${next.name_es}?`
      ));
      return twiml.toString();
    }

    state.current_step = 'DONE';
    await saveState(from, state);

    twiml.message(t(
      'Order received. Invoice will be sent shortly.',
      'Pedido recibido. La factura será enviada pronto.'
    ));
    return twiml.toString();
  }

  /* ===== FALLBACK ===== */
  twiml.message('Send "Order" to start.');
  return twiml.toString();
}

module.exports = { handleMessage };
