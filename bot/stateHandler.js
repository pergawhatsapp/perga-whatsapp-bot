import { supabase } from './supabaseClient.js';
import { generateInvoicePDF } from './invoice.js';
import { sendWhatsAppPDF } from './whatsapp-pdf.js';
import { sendInvoiceEmail } from './email.js';

const PRODUCTS = {
  beer: { name: 'Perga Beer 5.2%', price: 25.4 },
  cola: { name: 'Perga Cola', price: 21.6 },
  orange: { name: 'Perga Orange', price: 21.6 },
  limon: { name: 'Perga Limon-Lime', price: 21.6 },
  malta: { name: 'Malta Perga', price: 21.6 }
};

/* ---------------- STATE HELPERS ---------------- */

async function getState(phone) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('phone', phone)
    .single();
  return data;
}

async function saveState(phone, state) {
  await supabase
    .from('conversation_state')
    .upsert({ phone, state }, { onConflict: 'phone' });
}

async function resetState(phone) {
  await supabase.from('conversation_state').delete().eq('phone', phone);
}

/* ---------------- MAIN HANDLER ---------------- */

export async function handleMessage(req, res) {
  const msg = (req.body.Body || '').trim().toLowerCase();
  const phone = req.body.From;
  const mediaUrl = req.body.MediaUrl0;

  const twiml = new Twilio.twiml.MessagingResponse();

  /* 🔴 HARD RESET TRIGGER (NO LOCKS EVER) */
  if (msg === 'order' || msg === 'orden') {
    await resetState(phone);

    await saveState(phone, {
      step: 'LANGUAGE',
      language: null,
      account: {},
      order: {}
    });

    twiml.message('English or Español?');
    return res.send(twiml.toString());
  }

  const row = await getState(phone);
  if (!row) return res.send(twiml.toString());

  const state = row.state;
  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  /* ---------------- FLOW ---------------- */

  switch (state.step) {
    case 'LANGUAGE':
      if (msg.startsWith('en')) state.language = 'en';
      else if (msg.startsWith('es')) state.language = 'es';
      else {
        twiml.message('English or Español?');
        break;
      }
      state.step = 'ACCOUNT_TYPE';
      twiml.message(t('New account or existing account?', '¿Cuenta nueva o existente?'));
      break;

    case 'ACCOUNT_TYPE':
      if (msg.includes('exist')) {
        state.step = 'EXISTING_NAME';
        twiml.message(t('Business name?', '¿Nombre del negocio?'));
      } else {
        state.step = 'NEW_BUSINESS_NAME';
        twiml.message(t('Business name?', '¿Nombre del negocio?'));
      }
      break;

    /* ---------- EXISTING ACCOUNT ---------- */

    case 'EXISTING_NAME': {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('business_name', req.body.Body)
        .eq('phone', phone)
        .single();

      if (!data) {
        twiml.message(t(
          'Account not found. Creating a new account.',
          'Cuenta no encontrada. Creando una nueva.'
        ));
        state.step = 'NEW_BUSINESS_NAME';
        break;
      }

      state.account = data;
      state.step = 'CATALOG';
      break;
    }

    /* ---------- NEW ACCOUNT ---------- */

    case 'NEW_BUSINESS_NAME':
      state.account.business_name = req.body.Body;
      state.step = 'NEW_EMAIL';
      twiml.message(t('Business email address?', 'Correo electrónico del negocio?'));
      break;

    case 'NEW_EMAIL':
      state.account.email = req.body.Body;
      state.step = 'TAX_ID_YN';
      twiml.message(t(
        'Do you have a resale tax ID? (yes/no)',
        '¿Tiene ID de impuesto de reventa? (sí/no)'
      ));
      break;

    case 'TAX_ID_YN':
      state.account.tax_type = msg.startsWith('y') ? 'resale' : 'federal';
      state.step = 'TAX_ID_NUMBER';
      twiml.message(t('Tax ID number?', 'Número de ID fiscal?'));
      break;

    case 'TAX_ID_NUMBER':
      state.account.tax_id = req.body.Body;
      state.step = 'ADDRESS';
      twiml.message(t('Business address?', 'Dirección del negocio?'));
      break;

    case 'ADDRESS':
      state.account.address = req.body.Body;
      state.step = 'PHONE';
      twiml.message(t('Business phone number?', 'Teléfono del negocio?'));
      break;

    case 'PHONE':
      state.account.phone = req.body.Body;
      state.step = 'CONTACT';
      twiml.message(t('Contact name?', 'Nombre del contacto?'));
      break;

    case 'CONTACT':
      state.account.contact = req.body.Body;
      state.step = 'ALCOHOL_YN';
      twiml.message(t(
        'Does your business have an alcohol license? (yes/no)',
        '¿Tiene licencia de alcohol? (sí/no)'
      ));
      break;

    case 'ALCOHOL_YN':
      if (msg.startsWith('y')) {
        state.account.alcohol_license = true;
        state.step = 'ALCOHOL_PHOTO';
        twiml.message(t('Please upload a photo of the license.', 'Suba una foto de la licencia.'));
      } else {
        state.account.alcohol_license = false;
        state.step = 'SAVE_ACCOUNT';
      }
      break;

    case 'ALCOHOL_PHOTO':
      if (!mediaUrl) {
        twiml.message(t('Please upload the photo.', 'Por favor suba la foto.'));
        break;
      }
      state.account.license_photo = mediaUrl;
      state.step = 'ALCOHOL_NUMBER';
      twiml.message(t('License number?', 'Número de licencia?'));
      break;

    case 'ALCOHOL_NUMBER':
      state.account.license_number = req.body.Body;
      state.step = 'SAVE_ACCOUNT';
      break;

    case 'SAVE_ACCOUNT':
      await supabase.from('customers').insert(state.account);
      state.step = 'CATALOG';
      break;

    /* ---------- PRODUCT CATALOG ---------- */

    case 'CATALOG': {
      let msgText = t('Available products:\n', 'Productos disponibles:\n');
      if (state.account.alcohol_license) {
        msgText += `• Beer $25.40\n`;
      }
      msgText += `• Cola $21.60\n• Orange $21.60\n• Limon $21.60\n• Malta $21.60\n`;
      msgText += t('Send quantities like: Beer 10, Cola 5', 'Envíe cantidades: Beer 10, Cola 5');
      state.step = 'ORDER';
      twiml.message(msgText);
      break;
    }

    /* ---------- ORDER ---------- */

    case 'ORDER': {
      const items = {};
      let totalCases = 0;
      let total = 0;

      req.body.Body.split(',').forEach(part => {
        const [name, qty] = part.trim().split(' ');
        const q = parseInt(qty);
        if (!q) return;

        const key = name.toLowerCase();
        if (!PRODUCTS[key]) return;

        items[key] = q;
        totalCases += q;
        total += q * PRODUCTS[key].price;
      });

      if (totalCases < 10) {
        twiml.message(t(
          'Minimum order is 10 cases.',
          'El pedido mínimo es 10 cajas.'
        ));
        break;
      }

      state.order = { items, total };
      state.step = 'CONFIRM';

      twiml.message(
        t(`Order total: $${total}. Reply YES to confirm.`,
          `Total del pedido: $${total}. Responda SÍ para confirmar.`)
      );
      break;
    }

    /* ---------- INVOICE ---------- */

    case 'CONFIRM':
      if (!msg.startsWith('y') && !msg.startsWith('s')) break;

      try {
        const pdfPath = await generateInvoicePDF(state);
        await sendWhatsAppPDF(phone, pdfPath);
        await sendInvoiceEmail(state, pdfPath);

        twiml.message(t(
          'Invoice sent ✓ A sales rep will contact you. Thank you!',
          'Factura enviada ✓ Un representante lo contactará. ¡Gracias!'
        ));
      } catch (e) {
        twiml.message(t(
          'There was an error generating your invoice. Please try again.',
          'Hubo un error generando la factura. Intente nuevamente.'
        ));
      }

      await resetState(phone);
      return res.send(twiml.toString());
  }

  await saveState(phone, state);
  res.send(twiml.toString());
}
