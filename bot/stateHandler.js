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
];

// =====================
// HELPERS
// =====================
const normalize = n => n.replace('whatsapp:', '');
const lower = t => (t || '').trim().toLowerCase();
const t = (lang, en, es) => (lang === 'es' ? es : en);
const isYes = msg => msg.startsWith('y') || msg.startsWith('s');

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

  const mediaType = req.body.MediaContentType0;
  const mediaUrl = req.body.MediaUrl0;

  let state = await getState(phone);

  // =====================
  // START
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

    twiml.message('Send "order" to start / Escribe "orden" para comenzar.');
    return twiml.toString();
  }

  const lang = state.language || 'en';

  // =====================
  // LANGUAGE
  // =====================
  if (state.step === 'LANGUAGE') {
    const language = msg.startsWith('es') ? 'es' : 'en';
    await saveState(phone, { ...state, language, step: 'ACCOUNT_TYPE' });
    twiml.message(t(language, 'New or existing account?', '¿Cuenta nueva o existente?'));
    return twiml.toString();
  }

  // =====================
  // ACCOUNT TYPE
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
  // EXISTING ACCOUNT
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
      twiml.message(t(lang, 'Account not found. Creating new one.', 'Cuenta no encontrada.'));
      return twiml.toString();
    }

    await saveState(phone, { ...state, account: data, step: 'PRODUCTS' });
    twiml.message(t(lang, 'Account loaded. Let’s order.', 'Cuenta cargada.'));
    return twiml.toString();
  }

  // =====================
  // NEW ACCOUNT FLOW
  // =====================
  if (state.step === 'NEW_BUSINESS_NAME') {
    await saveState(phone, {
      ...state,
      account: { business_name: body.trim(), phone },
      step: 'BUSINESS_EMAIL'
    });
    twiml.message(t(lang, 'Business email?', 'Correo electrónico del negocio?'));
    return twiml.toString();
  }

  if (state.step === 'BUSINESS_EMAIL') {
    if (!body.includes('@')) {
      twiml.message(t(lang, 'Enter a valid email.', 'Ingrese un correo válido.'));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: { ...state.account, email: body.trim() },
      step: 'TAX_QUESTION'
    });

    twiml.message(t(lang,
      'Do you have a Resale tax ID? (yes/no)',
      '¿Tiene Resale tax ID de reventa? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'TAX_QUESTION') {
  const resale = isYes(msg);

  await saveState(phone, {
    ...state,
    account: { ...state.account, tax_type: resale ? 'resale' : 'federal' },
    step: resale ? 'TAX_RESALE' : 'TAX_FEDERAL'
  });

  twiml.message(
    resale
      ? t(lang, 'Enter resale tax ID', 'Ingrese tax ID de reventa (Resale) Ej: 12-3456789123-4' )
      : t(lang, 'Enter federal tax ID number', 'Ingrese federal tax ID (sunbiz) Ej: 12-3456789')
  );
  return twiml.toString();
  }

  if (state.step === 'TAX_RESALE') {
  await saveState(phone, {
    ...state,
    account: { ...state.account, tax_id: body.trim() },
    step: 'BUSINESS_ADDRESS'
  });

  twiml.message(t(lang,
    'Business address? Ex: 1234 NW 56th St, Miami FL,33123',
    'Dirección del negocio? Ej: 1234 NW 56th St, Miami FL,33123'
  ));
  return twiml.toString();
}

  if (state.step === 'TAX_FEDERAL') {
  await saveState(phone, {
    ...state,
    account: { ...state.account, tax_id: body.trim() },
    step: 'BUSINESS_ADDRESS'
  });

  twiml.message(t(lang,
    'Business address? Ex: 1234 NW 56th St, Miami FL,33123',
    'Dirección del negocio? Ej: 1234 NW 56th St, Miami FL,33123'
  ));
  return twiml.toString();
  }

  if (state.step === 'BUSINESS_ADDRESS') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, address: body.trim() },
      step: 'CONTACT_NAME'
    });
    twiml.message(t(lang, 'Contact name?', 'Nombre del contacto? (Ej: John Doe)'));
    return twiml.toString();
  }

  if (state.step === 'CONTACT_NAME') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, contact_name: body.trim() },
      step: 'ALCOHOL_QUESTION'
    });
    twiml.message(t(lang,
      'Do you have an alcohol license? (yes/no)',
      '¿Tiene licencia de alcohol? (sí/no)'
    ));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_QUESTION') {
    const yes = isYes(msg);
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license: yes },
      step: yes ? 'ALCOHOL_PHOTO' : 'SAVE_ACCOUNT'
    });

    twiml.message(yes
      ? t(lang, 'Upload license photo', 'Suba la foto de la licencia de alcohol')
      : t(lang, 'Saving account… (type ok)', 'Guardando cuenta… (ok)')
    );
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_PHOTO') {
    if (!mediaType || !mediaType.startsWith('image/')) {
      twiml.message(t(lang, 'Upload a photo.', 'Suba una imagen.'));
      return twiml.toString();
    }

    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_url: mediaUrl },
      step: 'ALCOHOL_NUMBER'
    });

    twiml.message(t(lang, 'License number?', 'Número de licencia?'));
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_NUMBER') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license_number: body.trim() },
      step: 'SAVE_ACCOUNT'
    });
    twiml.message(t(lang, 'Saving account…(type ok)', 'Guardando cuenta… (escribe ok)'));
    return twiml.toString();
  }

  if (state.step === 'SAVE_ACCOUNT') {
    await supabase.from('businesses').upsert(state.account);
    await saveState(phone, { ...state, step: 'PRODUCTS' });
    twiml.message(t(lang, 'start order. (type ok)', 'comencemos el pedido.(escribe ok)'));
    return twiml.toString();
  }

  // =====================
  // PRODUCTS & ORDER FLOW
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
    twiml.message(
      lang === 'es'
        ? `${p.es}\n$${p.price.toFixed(2)} por caja (24 unidades)\n\n¿Cuántas cajas desea? (min 10 cajas)`
        : `${p.en}\n$${p.price.toFixed(2)} per case (24-pack)\n\nHow many cases would you like?`
    );
    return twiml.toString();
  }

  if (state.step === 'QTY') {
    const qty = parseInt(msg, 10);
    if (isNaN(qty) || qty < 0) {
      twiml.message(t(lang, 'Enter a valid number.', 'Ingrese un número válido.'));
      return twiml.toString();
    }

    const { allowed, index, items } = state.order;
    items.push({ ...allowed[index], qty });

    if (index + 1 < allowed.length) {
      state.order.index++;
      await saveState(phone, state);

      const p = allowed[state.order.index];
      twiml.message(
        lang === 'es'
          ? `${p.es}\n$${p.price.toFixed(2)} por caja (24 unidades)\n\n¿Cuántas cajas desea? (min 10 cajas)`
          : `${p.en}\n$${p.price.toFixed(2)} per case (24-pack)\n\nHow many cases would you like?`
      );
      return twiml.toString();
    }

    let subtotal = 0;
    let totalCases = 0;
    let summary = [];

    for (const i of items) {
      if (i.qty > 0) {
        const line = i.qty * i.price;
        subtotal += line;
        totalCases += i.qty;
        summary.push(`${lang === 'es' ? i.es : i.en} — ${i.qty} x $${i.price.toFixed(2)} = $${line.toFixed(2)}`);
      }
    }

    if (totalCases < 10) {
      await resetState(phone);
      twiml.message(t(lang, 'Minimum order is 10 cases.', 'El pedido mínimo es 10 cajas.'));
      return twiml.toString();
    }

    const taxRate = state.account.tax_type === 'resale' ? 0 : 0.07;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    await saveState(phone, {
      ...state,
      step: 'CONFIRM',
      order: { items, subtotal, tax, total, totalCases }
    });

    twiml.message(
      `🧾 ${t(lang, 'ORDER SUMMARY', 'RESUMEN DEL PEDIDO')}\n\n` +
      summary.join('\n') +
      `\n\nSubtotal: $${subtotal.toFixed(2)}` +
      `\n${taxRate === 0 ? t(lang, 'Tax: EXEMPT', 'Impuesto: EXENTO') : `Tax (7%): $${tax.toFixed(2)}`}` +
      `\nTotal: $${total.toFixed(2)}\n\n` +
      t(lang, 'Reply YES to confirm or NO to cancel', 'Responda SÍ para confirmar o NO para cancelar')
    );
    return twiml.toString();
  }

  if (state.step === 'CONFIRM') {
    if (!isYes(msg)) {
      await resetState(phone);
      twiml.message(t(lang, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    await supabase.from('orders').insert({
  phone,
  business_name: state.account.business_name,
  items: state.order.items.map(i => ({
    key: i.key,
    name: lang === 'es' ? i.es : i.en,
    qty: i.qty,
    cases: i.qty,
    units_per_case: 24,
    price: i.price,
    line_total: i.qty * i.price
  })),
  subtotal: state.order.subtotal,
  tax: state.order.tax,
  total: state.order.total,
  total_cases: state.order.totalCases,
  created_at: new Date()
    });

    await resetState(phone);

    twiml.message(t(lang,
      '✅ Invoice will be sent to your email.\nA sales representative will contact you.\nThank you for choosing Perga!',
      '✅ La factura será enviada a su correo.\nUn representante se comunicará con usted.\n¡Gracias por elegir Perga!'
    ));
    return twiml.toString();
  }

  twiml.message('Send "order" to start again.');
  return twiml.toString();
}

module.exports = { handleMessage };





