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

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body) {
  const twiml = new MessagingResponse();
  const message = body.trim().toLowerCase();

  let state = await getState(from);

  /* ========= START ========= */
  if (!state && message === 'order') {
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
    twiml.message('Send "order" to start.');
    return twiml.toString();
  }

  /* ========= LANGUAGE ========= */
  if (state.current_step === 'LANGUAGE') {
    const lang = message.includes('es') ? 'es' : 'en';

    await saveState(from, {
      ...state,
      language: lang,
      current_step: 'SELECT_PRODUCT'
    });

    const productList = PRODUCTS.map(
      p => `${p.id}. ${lang === 'es' ? p.name_es : p.name_en}`
    ).join('\n');

    twiml.message(
      lang === 'es'
        ? `Seleccione productos por número (ej: 1,3) o escriba ALL:\n${productList}`
        : `Select products by number (ex: 1,3) or type ALL:\n${productList}`
    );

    return twiml.toString();
  }

  /* ========= SELECT PRODUCT ========= */
  if (state.current_step === 'SELECT_PRODUCT') {
    let selected = [];

    if (message === 'all') {
      selected = PRODUCTS.map(p => p.key);
    } else {
      const nums = message
        .split(/[\s,]+/)
        .map(n => parseInt(n))
        .filter(Boolean);

      selected = PRODUCTS.filter(p => nums.includes(p.id)).map(p => p.key);
    }

    if (selected.length === 0) {
      twiml.message(
        state.language === 'es' ? 'Selección inválida.' : 'Invalid selection.'
      );
      return twiml.toString();
    }

    const temp_data = {
      selected_products: selected,
      current_product_index: 0
    };

    await saveState(from, {
      ...state,
      current_step: 'ASK_QUANTITY',
      temp_data
    });

    const product = PRODUCTS.find(p => p.key === selected[0]);

    twiml.message(
      state.language === 'es'
        ? `¿Cuántas cajas para ${product.name_es}? (mínimo 10)`
        : `How many cases for ${product.name_en}? (minimum 10)`
    );

    return twiml.toString();
  }

  /* ========= ASK QUANTITY ========= */
  if (state.current_step === 'ASK_QUANTITY') {
    const qty = parseInt(message);

    if (isNaN(qty) || qty < 10) {
      twiml.message(
        state.language === 'es'
          ? 'El mínimo es 10 cajas.'
          : 'Minimum is 10 cases.'
      );
      return twiml.toString();
    }

    const index = state.temp_data.current_product_index;
    const productKey = state.temp_data.selected_products[index];

    const order_items = state.order_items || {};
    order_items[productKey] = qty;

    state.temp_data.current_product_index++;

    if (state.temp_data.current_product_index < state.temp_data.selected_products.length) {
      const nextKey = state.temp_data.selected_products[state.temp_data.current_product_index];
      const nextProduct = PRODUCTS.find(p => p.key === nextKey);

      await saveState(from, {
        ...state,
        order_items,
        temp_data: state.temp_data
      });

      twiml.message(
        state.language === 'es'
          ? `¿Cuántas cajas para ${nextProduct.name_es}? (mínimo 10)`
          : `How many cases for ${nextProduct.name_en}? (minimum 10)`
      );

      return twiml.toString();
    }

    await saveState(from, {
      ...state,
      order_items,
      current_step: 'ORDER_COMPLETE'
    });

    twiml.message(
      state.language === 'es'
        ? 'Pedido completado. Un representante lo contactará.'
        : 'Order completed. A sales rep will contact you.'
    );

    return twiml.toString();
  }

  return twiml.toString();
}

module.exports = { handleMessage };
