const supabase = require('./supabaseClient');

async function uploadFile(bucket, path, buffer, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) throw error;

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

module.exports = { uploadFile };
