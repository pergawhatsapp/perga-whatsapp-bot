const twilio = require('twilio');
const MessagingResponse = twilio.twiml.MessagingResponse;
const supabase = require('../services/supabaseClient');

// 🔍 DEBUG: Log Supabase connection info
console.log('🔍 SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('🔍 Supabase Project ID:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.split('.')[0].replace('https://', '') : 'NOT SET');

// =====================
// PRODUCTS
// =====================
const PRODUCTS = [
  { key: 'BEER', en: '🍺 Perga Beer 5.2%', es: 'Perga Cerveza 5.2%', price: 25.4, alcoholic: true },
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

const isYes = msg =>
  ['1', 'y', 'yes', 'ok', 'si', 'sí', 's'].includes(msg);

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
  await supabase
    .from('conversation_state')
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

  if (!msg && !mediaUrl) return twiml.toString();

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

      twiml.message('1️⃣ English\n2️⃣ Español');
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
    const language = msg === '2' ? 'es' : 'en';

    await saveState(phone, {
      ...state,
      language,
      step: 'ACCOUNT_TYPE'
    });

    twiml.message(
      t(language,
        '1️⃣ New account\n2️⃣ Existing account',
        '1️⃣ Cuenta nueva\n2️⃣ Cuenta existente'
      )
    );
    return twiml.toString();
  }

  // =====================
  // ACCOUNT TYPE
  // =====================
  if (state.step === 'ACCOUNT_TYPE') {
    const existing = msg === '2';

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
    twiml.message(t(lang, 'Account loaded. Type OK to continue.', 'Cuenta cargada. Escriba OK.'));
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

    twiml.message(
      t(lang,
        '1️⃣ Yes\n2️⃣ No\nDo you have a Resale tax ID?',
        '1️⃣ Sí\n2️⃣ No\n¿Tiene Resale tax ID de reventa?'
      )
    );
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
        ? t(lang, 'Enter resale tax ID', 'Ingrese tax ID de reventa (Resale) Ej: 12-3456789123-4')
        : t(lang, 'Enter federal tax ID number', 'Ingrese federal tax ID (sunbiz) Ej: 12-3456789')
    );
    return twiml.toString();
  }

  if (state.step === 'TAX_RESALE' || state.step === 'TAX_FEDERAL') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, tax_id: body.trim() },
      step: 'BUSINESS_ADDRESS'
    });

    twiml.message(
      t(lang,
        'Business address? Ex: 1234 NW 56th St, Miami FL,33123',
        'Dirección del negocio? Ej: 1234 NW 56th St, Miami FL,33123'
      )
    );
    return twiml.toString();
  }

  if (state.step === 'BUSINESS_ADDRESS') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, address: body.trim() },
      step: 'CONTACT_NAME'
    });

    twiml.message(t(lang, 'Contact name?(Ex: John Doe)', 'Nombre del contacto? (Ej: John Doe)'));
    return twiml.toString();
  }

  if (state.step === 'CONTACT_NAME') {
    await saveState(phone, {
      ...state,
      account: { ...state.account, contact_name: body.trim() },
      step: 'ALCOHOL_QUESTION'
    });

    twiml.message(
      t(lang,
        '1️⃣ Yes\n2️⃣ No\nDo you have an alcohol license?',
        '1️⃣ Sí\n2️⃣ No\n¿Tiene licencia de alcohol?'
      )
    );
    return twiml.toString();
  }

  if (state.step === 'ALCOHOL_QUESTION') {
    const yes = isYes(msg);

    await saveState(phone, {
      ...state,
      account: { ...state.account, alcohol_license: yes },
      step: yes ? 'ALCOHOL_PHOTO' : 'SAVE_ACCOUNT'
    });

    twiml.message(
      yes
        ? t(lang, 'Upload license photo', 'Suba la foto de la licencia de alcohol')
        : t(lang, 'Saving account… Type OK', 'Guardando cuenta… Escriba OK')
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

    twiml.message(t(lang, 'Saving account… Type OK', 'Guardando cuenta… Escriba OK'));
    return twiml.toString();
  }

  if (state.step === 'SAVE_ACCOUNT') {
  console.log('💾 Attempting to save business. Account data:', JSON.stringify(state.account, null, 2));
  
  const { data: savedBusiness, error: saveError } = await supabase
    .from('businesses')
    .upsert(state.account)  // ✅ Removed onConflict, will use the unique constraint
    .select()
    .single();
  
  if (saveError) {
    console.error('❌ CRITICAL ERROR saving business:', saveError);
    console.error('❌ Account data that failed:', state.account);
    twiml.message(t(lang, 
      'Error saving account. Please try again.',
      'Error guardando cuenta. Intente nuevamente.'
    ));
    return twiml.toString();
  }
  
  console.log('✅ Business saved successfully:', savedBusiness);
  
  await saveState(phone, { ...state, step: 'PRODUCTS' });
  twiml.message(t(lang, 'Starting order… Type OK', 'Iniciando pedido… Escriba OK'));
  return twiml.toString();
  }

  // =====================
  // PRODUCTS
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
        ? `${p.es}\n$${p.price} por caja (24 unidades)\n\n¿Cuántas cajas desea? (min 10 cajas)`
        : `${p.en}\n$${p.price} per case (24-pack)\n\nHow many cases would you like (min 10 cases)?`
    );
    return twiml.toString();
  }

  if (state.step === 'QTY') {
    const qty = parseInt(msg, 10);
    if (isNaN(qty) || qty < 0 || qty > 1000) {
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
          ? `${p.es}\n$${p.price} por caja (24 unidades)\n\n¿Cuántas cajas desea? (min 10 cajas)`
          : `${p.en}\n$${p.price} per case (24-pack)\n\nHow many cases would you like (min 10 cases)?`
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
        summary.push(
          `${lang === 'es' ? i.es : i.en} — ${i.qty} x $${i.price.toFixed(2)} = $${line.toFixed(2)}`
        );
      }
    }

    if (totalCases < 10) {
      await resetState(phone);
      twiml.message(t(lang, 'Minimum order is 10 cases.', 'Pedido mínimo: 10 cajas.'));
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
      t(lang,
        'Reply YES to confirm or NO to cancel',
        'Responda SÍ para confirmar o NO para cancelar'
      )
    );
    return twiml.toString();
  }

  if (state.step === 'CONFIRM') {
    if (!isYes(msg)) {
      await resetState(phone);
      twiml.message(t(lang, 'Order cancelled.', 'Pedido cancelado.'));
      return twiml.toString();
    }

    console.log('🔍 CONFIRM step - Looking up business for phone:', phone);
    console.log('🔍 Using Supabase URL:', process.env.SUPABASE_URL);

    // ✅ Look up business by phone only
    let { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, business_name, email, contact_name, address, tax_id, tax_type, alcohol_license, alcohol_license_number')
      .eq('phone', phone)
      .maybeSingle();

    if (!business) {
      console.error('❌ Business not found for phone:', phone);
      console.error('Business error:', businessError);
      
      // ✅ Try to re-save the business
      if (state.account && state.account.business_name) {
        console.log('🔄 Attempting to re-save business...');
        const { data: newBusiness, error: insertError } = await supabase
          .from('businesses')
          .upsert(state.account)
          .select()
          .single();
        
        if (insertError) {
          console.error('❌ Failed to save business:', insertError);
          twiml.message(t(lang,
            'Business account error. Please start over by typing "order".',
            'Error en cuenta. Por favor escriba "orden" para empezar de nuevo.'
          ));
          await resetState(phone);
          return twiml.toString();
        }
        
        business = newBusiness;
        console.log('✅ Business re-saved successfully:', business.id);
      } else {
        twiml.message(t(lang,
          'Business account error. Please start over by typing "order".',
          'Error en cuenta. Por favor escriba "orden" para empezar de nuevo.'
        ));
        await resetState(phone);
        return twiml.toString();
      }
    }

    console.log('✅ Business found:', business.id, business.business_name);

    // ✅ Create order with business_id
    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        business_id: business.id,
        phone,
        business_name: business.business_name,
        items: state.order.items,
        tax: state.order.tax,
        total: state.order.total,
        total_cases: state.order.totalCases,
        status: 'pending',
        created_at: new Date()
      })
      .select()
      .single();

    if (error || !order) {
      console.error('❌ ORDER INSERT ERROR:', error);
      twiml.message(t(lang,
        'There was an error saving your order. Please try again.',
        'Hubo un error guardando su pedido. Intente nuevamente.'
      ));
      return twiml.toString();
    }

    console.log('✅ Order created:', order.id);

    // ✅ Insert order items
    const orderItems = state.order.items
      .filter(i => i.qty > 0)
      .map(i => ({
        order_id: order.id,
        product_key: i.key,
        product_name: i.en,
        qty: i.qty,
        units: i.qty * 24,
        price: i.price
      }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('❌ ORDER ITEMS INSERT ERROR:', itemsError);
    } else {
      console.log('✅ Order items inserted:', orderItems.length);
    }

    // ✅ Sync to Google Sheets
    try {
      console.log('📊 Attempting to sync order', order.id, 'to Google Sheets...');
      console.log('🔍 Calling RPC on Supabase URL:', process.env.SUPABASE_URL);
      
      const { data: syncResult, error: syncError } = await supabase
        .rpc('sync_order_to_sheets', { order_id_param: order.id });
      
      if (syncError) {
        console.error('❌ GOOGLE SHEETS SYNC ERROR:', syncError);
        console.error('❌ Full error details:', JSON.stringify(syncError, null, 2));
      } else {
        console.log('✅ Google Sheets sync successful:', syncResult);
      }
    } catch (syncErr) {
      console.error('❌ GOOGLE SHEETS SYNC EXCEPTION:', syncErr);
    }

    await resetState(phone);

    twiml.message(
      t(lang,
        `✅ Order #${order.id} confirmed!\n\nInvoice will be sent to ${business.email}.\nA sales representative will contact you.\n\nThank you for choosing Perga!`,
        `✅ Orden #${order.id} confirmada!\n\nLa factura será enviada a ${business.email}.\nUn representante se comunicará con usted.\n\n¡Gracias por elegir Perga!`
      )
    );
    return twiml.toString();
  }

  twiml.message('Send "order" to start again., Escribe "orden" para iniciar un nuevo pedido.');
  return twiml.toString();
}

module.exports = { handleMessage };


