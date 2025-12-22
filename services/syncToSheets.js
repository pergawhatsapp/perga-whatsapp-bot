require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Google auth
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SPREADSHEET_ID = 'YOUR_SHEET_ID';

// helper
async function appendRow(sheetName, values) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [values]
    }
  });

  supabase
  .channel('business_case_summary_listener')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'business_case_summary'
    },
    payload => {
      console.log('🟢 NEW BUSINESS CASE SUMMARY');
      console.log(payload.new);
    }
  )
  .subscribe();

  supabase
  .channel('orders')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'orders' },
    payload => {
      const o = payload.new;
      appendRow('orders', [
        o.id,
        o.business_name,
        o.total_cases,
        o.tax,
        o.total,
        o.created_at
      ]);
    }
  )
  .subscribe();
supabase
  .channel('businesses')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'businesses' },
    payload => {
      const b = payload.new;
      appendRow('businesses', [
        b.id,
        b.business_name,
        b.email,
        b.phone,
        b.address,
        b.created_at
      ]);
    }
  )
  .subscribe();
  
}
