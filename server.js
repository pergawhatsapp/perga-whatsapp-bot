require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const path = require('path');

// ✅ IMPORTANT FIX: destructure the export
const { handleMessage } = require('./bot/stateHandler');

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post('/webhook', async (req, res) => {
  try {
    console.log('INCOMING:', req.body);

    const incomingMsg = (req.body.Body || '').trim().toLowerCase();
    const from = req.body.From;

    const response = await handleMessage(from, incomingMsg, req);

    res.type('text/xml');
    res.send(response);
  } catch (err) {
    console.error('Webhook error:', err);

    // ✅ Always respond 200 to stop Twilio retries
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Sorry, something went wrong. Please try again.');

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.use('/tmp', express.static(path.join(__dirname, 'tmp')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
