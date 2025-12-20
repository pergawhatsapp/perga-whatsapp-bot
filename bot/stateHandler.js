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

async function clearState(whatsapp) {
  await supabase.from('conversation_state')
    .delete()
    .eq('whatsapp_number', whatsapp);
}

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body) {
  const twiml = new MessagingResponse();

  // 🔒 HARD GUARD — prevents your crash
  const msg = (body || '').trim().toLowerCase();

  let state = await getState(from);

  /* ================= START ================= */
  if (!state && msg === 'order') {
    await saveState(from, {
      current_step: 'LANGUAGE',
      language: null,
      temp_data: {},
      order_items: {}
    });

    twiml.message('English or Español?');
    return twiml.toString();
  }

  if (!state) {
    twiml.message('Send "Order" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* ================= LANGUAGE ================= */
  if (state.current_step === 'LANGUAGE') {
    const language = msg.includes('es') ? 'es' : 'en';

    await saveState(from, {
      ...state,
      language,
      current_step: 'SELECT_PRODUCTS'
    });

    const list = PRODUCTS
      .map(p => `${p.id}. ${language === 'es' ? p.name_es : p.name_en}`)
      .join('\n');

    twiml.message(
      t(
        `Select products (example: 1,3) or type ALL:\n${list}`,
        `Seleccione productos (ej: 1,3) o escriba ALL:\n${list}`
      )
    );
    return twiml.toString();
  }

  /* ================= SELECT PRODUCTS ================= */
  if (state.current_step === 'SELECT_PRODUCTS') {
    let selected = [];

    if (msg === 'all') {
      selected = PRODUCTS.map(p => p.key);
    } else {
      const nums = msg
        .split(/[\s,]+/)
        .map(n => parseInt(n))
        .filter(Boolean);

      selected = PRODUCTS
        .filter(p => nums.includes(p.id))
        .map(p => p.key);
    }

    if (!selected.length) {
      twiml.message(t('Invalid selection.', 'Selección inválida.'));
      return twiml.toString();
    }

    await saveState(from, {
      ...state,
      current_step: 'ASK_QTY',
      temp_data: {
        selected_products: selected,
        index: 0
      }
    });

    const p = PRODUCTS.find(x => x.key === selected[0]);

    twiml.message(
      t(
        `How many cases for ${p.name_en}? (minimum 10)`,
        `¿Cuántas cajas para ${p.name_es}? (mínimo 10)`
      )
    );
    return twiml.toString();
  }

  /* ================= ASK QUANTITY ================= */
  if (state.current_step === 'ASK_QTY') {
    const qty = parseInt(msg);

    if (isNaN(qty) || qty < 10) {
      twiml.message(t('Minimum is 10 cases.', 'El mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const index = state.temp_data.index;
    const productKey = state.temp_data.selected_products[index];

    const order_items = state.order_items || {};
    order_items[productKey] = qty;

    state.temp_data.index++;

    if (state.temp_data.index < state.temp_data.selected_products.length) {
      const nextKey = state.temp_data.selected_products[state.temp_data.index];
      const next = PRODUCTS.find(p => p.key === nextKey);

      await saveState(from, {
        ...state,
        order_items,
        temp_data: state.temp_data
      });

      twiml.message(
        t(
          `How many cases for ${next.name_en}? (minimum 10)`,
          `¿Cuántas cajas para ${next.name_es}? (mínimo 10)`
        )
      );
      return twiml.toString();
    }

    /* ================= REVIEW ================= */
    let subtotal = 0;
    let summary = '';

    for (const key in order_items) {
      const p = PRODUCTS.find(x => x.key === key);
      const line = p.price * order_items[key];
      subtotal += line;
      summary += `${p.name_en}: ${order_items[key]} → $${line.toFixed(2)}\n`;
    }

    const tax = subtotal * 0.07;
    const total = subtotal + tax;

    await saveState(from, {
      ...state,
      order_items,
      current_step: 'CONFIRM'
    });

    twiml.message(
      `ORDER REVIEW\n\n${summary}\nSubtotal: $${subtotal.toFixed(
        2
      )}\nTax: $${tax.toFixed(2)}\nTOTAL: $${total.toFixed(
        2
      )}\n\nReply YES to confirm`
    );
    return twiml.toString();
  }

  /* ================= CONFIRM ================= */
  if (state.current_step === 'CONFIRM') {
    if (!msg.startsWith('y')) {
      await clearState(from);
      twiml.message('Order cancelled.');
      return twiml.toString();
    }

    // 🔜 PDF + Supabase invoice insert goes here next
    await clearState(from);

    twiml.message(
      t(
        'Invoice will be sent shortly. Thank you for choosing Perga!',
        'La factura será enviada pronto. ¡Gracias por elegir Perga!'
      )
    );
    return twiml.toString();
  }

  /* ================= FALLBACK ================= */
  twiml.message(t('Send "Order" to start.', 'Envíe "Order" para comenzar.'));
  return twiml.toString();
}

module.exports = { handleMessage };
