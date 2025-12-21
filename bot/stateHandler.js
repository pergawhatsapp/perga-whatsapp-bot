const Twilio = require('twilio');
const { supabase } = require('./supabaseClient');
const { generateInvoicePDF } = require('./invoice');
const { sendWhatsAppPDF } = require('./whatsapp-pdf');
const { sendInvoiceEmail } = require('./email');

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

async function handleMessage(req, res) {
  const msg = (req.body.Body || '').trim().toLowerCase();
  const phone = req.body.From;
  const mediaUrl = req.body.MediaUrl0;

  const twiml = new Twilio.twiml.MessagingResponse();

  // 🔴 ALWAYS allow restart
  if (msg === 'order' || msg === 'orden') {
    await resetState(phone);
    await saveState(phone, { step: 'LANGUAGE', language: null, account: {}, order: {} });
    twiml.message('English or Español?');
    return res.send(twiml.toString());
  }

  const row = await getState(phone);
  if (!row) return res.send(twiml.toString());

  const state = row.state;
  const lang = state.language || 'en';
  const t = (en, es) => (lang === 'es' ? es : en);

  try {
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
        state.step = msg.includes('exist') ? 'EXISTING_NAME' : 'NEW_BUSINESS_NAME';
        twiml.message(t('Business name?', '¿Nombre del negocio?'));
        break;

      case 'EXISTING_NAME': {
        const { data } = await supabase
          .from('customers')
          .select('*')
          .eq('business_name', req.body.Body)
          .eq('phone', phone)
          .single();

        if (!data) {
          state.step = 'NEW_BUSINESS_NAME';
          twiml.message(t('Account not found. Creating new.', 'Cuenta no encontrada. Creando nueva.'));
          break;
        }

        state.account = data;
        state.step = 'CATALOG';
        break;
      }

      case 'NEW_BUSINESS_NAME':
        state.account.business_name = req.body.Body;
        state.step = 'NEW_EMAIL';
        twiml.message(t('Business email?', 'Correo del negocio?'));
        break;

      case 'NEW_EMAIL':
        state.account.email = req.body.Body;
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
          twiml.message(t('Upload license photo.', 'Suba foto de licencia.'));
        } else {
          state.account.alcohol_license = false;
          state.step = 'CATALOG';
        }
        break;

      case 'ALCOHOL_PHOTO':
        if (!mediaUrl) {
          twiml.message(t('Please upload photo.', 'Suba la foto.'));
          break;
        }
        state.account.license_photo = mediaUrl;
        state.step = 'CATALOG';
        break;

      case 'CATALOG':
        twiml.message(t(
          'Send quantities like: Cola 10, Orange 10',
          'Envíe cantidades: Cola 10, Orange 10'
        ));
        state.step = 'ORDER';
        break;

      case 'ORDER':
        state.step = 'CONFIRM';
        twiml.message(t('Reply YES to confirm.', 'Responda SÍ para confirmar.'));
        break;

      case 'CONFIRM':
        if (!msg.startsWith('y') && !msg.startsWith('s')) break;

        try {
          const pdfPath = await generateInvoicePDF(state);
          await sendWhatsAppPDF(phone, pdfPath);
          await sendInvoiceEmail(state, pdfPath);

          twiml.message(t('Invoice sent ✓ Thank you!', 'Factura enviada ✓ ¡Gracias!'));
        } catch (err) {
          console.error('INVOICE ERROR:', err);
          twiml.message(t(
            'Invoice error. Sales rep will contact you.',
            'Error de factura. Un representante lo contactará.'
          ));
        }

        await resetState(phone);
        return res.send(twiml.toString());
    }

    await saveState(phone, state);
    return res.send(twiml.toString());

  } catch (err) {
    console.error('BOT CRASH:', err);
    twiml.message('System error. Please send ORDER to restart.');
    await resetState(phone);
    return res.send(twiml.toString());
  }
}

module.exports = { handleMessage };
