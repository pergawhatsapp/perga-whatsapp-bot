require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { handleMessage } = require('./bot/stateHandler');

const PRODUCTS = [
  {
    id: 1,
    key: 'PERGA_COLA',
    name_en: 'Perga Cola',
    name_es: 'Perga Cola',
    price: 21.6
  },
  {
    id: 2,
    key: 'PERGA_ORANGE',
    name_en: 'Perga Orange',
    name_es: 'Perga Naranja',
    price: 21.6
  },
  {
    id: 3,
    key: 'PERGA_LIME',
    name_en: 'Perga Lime',
    name_es: 'Perga Limón-Lima',
    price: 21.6
  },
  {
    id: 4,
    key: 'MALTA',
    name_en: 'Malta Perga',
    name_es: 'Malta Perga',
    price: 21.6
  }
];

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body?.trim().toLowerCase();
  const from = req.body.From;

  const response = await handleMessage(from, incomingMsg, req);
  res.set('Content-Type', 'text/xml');
  res.send(response);

  state.temp_data = state.temp_data || {};
  state.order_items = state.order_items || {};
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

