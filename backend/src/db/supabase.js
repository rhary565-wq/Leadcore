const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

let _client = null;

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      {
        realtime: { transport: ws }
      }
    );
  }
  return _client;
}

const supabase = new Proxy({}, {
  get(_, prop) {
    return (...args) => getClient()[prop](...args);
  }
});

module.exports = { supabase };
