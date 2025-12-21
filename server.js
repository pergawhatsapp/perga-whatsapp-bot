require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const handleMessage = require('./bot/stateHandler');
const app = express();
app.use(express.urlencoded({ extended: false }));

app.post('/webhook', async (req, res) => {
  console.log('INCOMING:', req.body);
  const incomingMsg = req.body.Body?.trim().toLowerCase();
  const from = req.body.From;

  const response = await handleMessage(from, incomingMsg, req);
  res.set('Content-Type', 'text/xml');
  res.send(response);
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

const path = require('path');
app.use('/tmp', express.static(path.join(__dirname, 'tmp')));

