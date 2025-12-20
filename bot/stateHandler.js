const twilio = require('twilio');
const supabase = require('../services/supabase');
const messages = require('./messages');
const { handleOrderFlow } = require('./orderFlow');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function getState(whatsapp) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .single();

  return data;
}

async function saveState(whatsapp, state) {
  await supabase
    .from('conversation_state')
    .upsert({
      whatsapp_number: whatsapp,
      ...state,
      updated_at: new Date()
    });
}

async function handleMessage(from, body, req) {
  const twiml = new twilio.twiml.MessagingResponse();
  let state = await getState(from);

  // START CONVERSATION
  if (!state && body === 'order') {
    await saveState(from, { current_step: 'language' });
    twiml.message(messages.selectLanguage.en);
    return twiml.toString();
  }

  if (!state) {
    twiml.message('Send "order" to start.');
    return twiml.toString();
  }

  const lang = state.language || 'en';

  switch (state.current_step) {
    case 'language':
      if (body.includes('es')) {
        await saveState(from, { current_step: 'account', language: 'es' });
        twiml.message(messages.selectAccount.es);
      } else {
        await saveState(from, { current_step: 'account', language: 'en' });
        twiml.message(messages.selectAccount.en);
      }
      break;

    case 'account':
      if (body.includes('existing')) {
        await saveState(from, { current_step: 'existing_name', language: lang });
        twiml.message(messages.businessName[lang]);
      } else {
        await saveState(from, { current_step: 'new_business_name', language: lang });
        twiml.message(messages.businessName[lang]);
      }
      break;

    default:
      return handleOrderFlow(state, from, body, twiml, req);
  }

  return twiml.toString();
}

module.exports = { handleMessage };
