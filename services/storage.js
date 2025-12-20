const supabase = require('./supabase');
const { v4: uuidv4 } = require('uuid');

async function uploadInvoice(buffer) {
  const filename = `invoice-${uuidv4()}.pdf`;

  const { error } = await supabase.storage
    .from('invoices')
    .upload(filename, buffer, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from('invoices')
    .getPublicUrl(filename);

  return data.publicUrl;
}

module.exports = { uploadInvoice };
