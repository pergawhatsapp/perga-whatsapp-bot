const twilio = require('twilio');
const supabase = require('../services/supabase');
const MessagingResponse = twilio.twiml.MessagingResponse;

/* =========================
   PRODUCTS
========================= */
const PRODUCTS = [
  {
    id: 1,
    key: 'PERGA_BEER',
    name_en: 'Perga Beer 5.2% (24pk)',
    name_es: 'Perga Cerveza 5.2% (24pk)',
    price: 25.4,
    alcoholic: true
  },
  {
    id: 2,
    key: 'PERGA_COLA',
    name_en: 'Perga Cola (24pk)',
    name_es: 'Perga Cola (24pk)',
    price: 21.6,
    alcoholic: false
  },
  {
    id: 3,
    key: 'PERGA_ORANGE',
    name_en: 'Perga Orange (24pk)',
    name_es: 'Perga Naranja (24pk)',
    price: 21.6,
    alcoholic: false
  },
  {
    id: 4,
    key: 'PERGA_LIME',
    name_en: 'Perga Limon-Lime (24pk)',
    name_es: 'Perga Limón-Lima (24pk)',
    price: 21.6,
    alcoholic: false
  },
  {
    id: 5,
    key: 'MALTA',
    name_en: 'Malta (24pk)',
    name_es: 'Malta (24pk)',
    price: 21.6,
    alcoholic: false
  }
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
  await supabase.from('conversation_state').delete().eq('whatsapp_number', whatsapp);
}

/* =========================
   MAIN HANDLER
========================= */
async function handleMessage(from, body = '', mediaUrl = null) {
  const twiml = new MessagingResponse();
  const msg = body.trim().toLowerCase();

  /* ===== TRIGGER ===== */
  if (msg === 'order' || msg === 'orden') {
    await resetState(from);

    await saveState(from, {
      current_step: 'LANGUAGE',
      language: null,
      account: {},
      order: {},
      temp: {}
    });

    twiml.message('English or Español?');
    return twiml.toString();
  }

  const state = await getState(from);
  if (!state) {
    twiml.message('Send "order" or "orden" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* ===== LANGUAGE ===== */
  if (state.current_step === 'LANGUAGE') {
    state.language = msg.includes('es') ? 'es' : 'en';
    state.current_step = 'ACCOUNT_TYPE';

    await saveState(from, state);
    twiml.message(t(
      'New account or existing account?',
      '¿Cuenta nueva o cuenta existente?'
    ));
    return twiml.toString();
  }

  /* ===== ACCOUNT TYPE ===== */
  if (state.current_step === 'ACCOUNT_TYPE') {
    if (msg.includes('exist')) {
      state.current_step = 'EXISTING_BUSINESS_NAME';
      await saveState(from, state);
      twiml.message(t('Business name?', '¿Nombre del negocio?'));
      return twiml.toString();
    }

    state.current_step = 'NEW_BUSINESS_NAME';
    await saveState(from, state);
    twiml.message(t('Business name?', '¿Nombre del negocio?'));
    return twiml.toString();
  }

  /* ===== EXISTING ACCOUNT LOOKUP ===== */
  if (state.current_step === 'EXISTING_BUSINESS_NAME') {
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .eq('business_name', body)
      .eq('whatsapp_number', from)
      .maybeSingle();

    if (!data) {
      state.current_step = 'NEW_BUSINESS_NAME';
      await saveState(from, state);
      twiml.message(t(
        'Account not found. Let’s create a new one.\nBusiness name?',
        'Cuenta no encontrada. Vamos a crear una nueva.\n¿Nombre del negocio?'
      ));
      return twiml.toString();
    }

    state.account = data;
    state.current_step = 'PRODUCT_SELECT';
    await saveState(from, state);
  }

  /* ===== NEW ACCOUNT FLOW ===== */
  const fields = [
    'business_name',
    'business_email',
    'tax_type',
    'tax_id',
    'business_address',
    'business_phone',
    'contact_name',
    'alcohol_license'
  ];

  if (state.current_step.startsWith('NEW_')) {
    const field = state.current_step.replace('NEW_', '').toLowerCase();
    state.account[field] = body;

    const nextIndex = fields.indexOf(field) + 1;
    if (nextIndex < fields.length) {
      state.current_step = 'NEW_' + fields[nextIndex].toUpperCase();
      await saveState(from, state);

      const prompts = {
        business_email: t('Business email?', 'Correo electrónico del negocio?'),
        tax_type: t('Do you have a resale tax ID? (yes/no)', '¿Tiene ID de reventa? (sí/no)'),
        tax_id: t('Enter tax ID number', 'Ingrese número de ID fiscal'),
        business_address: t('Business address?', 'Dirección del negocio?'),
        business_phone: t('Business phone number?', 'Teléfono del negocio?'),
        contact_name: t('Contact name?', 'Nombre de contacto?'),
        alcohol_license: t(
          'Does your business have an alcohol license? (yes/no)',
          '¿Tiene licencia de alcohol? (sí/no)'
        )
      };

      twiml.message(prompts[field]);
      return twiml.toString();
    }

    state.current_step = 'PRODUCT_SELECT';
    await saveState(from, state);
  }

  /* ===== PRODUCT SELECTION ===== */
  if (state.current_step === 'PRODUCT_SELECT') {
    const allowed = PRODUCTS.filter(p =>
      state.account.alcohol_license === 'yes' ? true : !p.alcoholic
    );

    const list = allowed
      .map(p => `${p.id}. ${t(p.name_en, p.name_es)} - $${p.price}`)
      .join('\n');

    state.order.allowed = allowed;
    state.order.items = {};
    state.order.index = 0;
    state.current_step = 'ASK_QTY';

    await saveState(from, state);
    twiml.message(t(
      `Enter quantity (cases) for:\n${list}`,
      `Ingrese cantidad (cajas) para:\n${list}`
    ));
    return twiml.toString();
  }

  /* ===== ORDER COMPLETE ===== */
  if (state.current_step === 'CONFIRM') {
    state.current_step = 'DONE';
    await saveState(from, state);

    twiml.message(t(
      'Invoice sent to your email ✓\nA sales representative will contact you.\nThank you for choosing Perga!',
      'Factura enviada a su correo electrónico ✓\nUn representante se comunicará.\n¡Gracias por elegir Perga!'
    ));

    await resetState(from);
    return twiml.toString();
  }

  twiml.message(t('Send "order" to start.', 'Envíe "orden" para comenzar.'));
  return twiml.toString();
}

module.exports = { handleMessage };
