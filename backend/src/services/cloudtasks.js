// Task queue
//  • Production (GCP_PROJECT_ID set): pushes an HTTP task to Google Cloud Tasks,
//    which calls a /worker/* endpoint on this backend.
//  • Local / no GCP: calls the same /worker/* endpoint on this server in the
//    background, so the whole pipeline works on a laptop with `npm run dev`.

const axios = require('axios');

let _client = null;
function getClient() {
  if (!_client) {
    const { CloudTasksClient } = require('@google-cloud/tasks');
    _client = new CloudTasksClient();
  }
  return _client;
}

function internalToken() {
  return process.env.INTERNAL_TOKEN || 'leadgen-internal';
}

function localBase() {
  return process.env.LOCAL_WORKER_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
}

async function enqueueLocal(endpoint, payload) {
  const url = `${localBase()}${endpoint}`;
  console.log(`[queue:local] → ${url}`);
  // Fire-and-forget; worker long-running calls must not block the API response.
  setImmediate(() => {
    axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken() },
      timeout: 0,
      maxBodyLength: Infinity,
    }).catch(err => {
      console.error(`[queue:local] ${endpoint} failed:`, err.response?.data || err.message);
    });
  });
  return `local:${endpoint}:${Date.now()}`;
}

// On Vercel (no long-running server): run the worker inside this function and
// keep it alive with waitUntil until the job finishes (bounded by maxDuration).
const WORKERS = {
  '/worker/scrape':           () => require('../workers/scrape').handleScrape,
  '/worker/clean':            () => require('../workers/clean').handleClean,
  '/worker/hubspot':          () => require('../workers/hubspot').handleHubspot,
  '/worker/enrich':           () => require('../workers/enrich').handleEnrich,
  '/worker/hubspot-contacts': () => require('../workers/hubspotContacts').handleHubspotContacts,
  '/worker/apollo-batch':     () => require('../workers/apolloBatch').handleApolloBatch,
};

function enqueueInProcess(endpoint, payload) {
  const handler = WORKERS[endpoint]?.();
  if (!handler) throw new Error(`Unknown worker ${endpoint}`);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; }, send() { return this; } };
  const req = { body: payload, headers: { 'x-internal-token': internalToken() } };
  console.log(`[queue:vercel] → ${endpoint}`);
  const job = Promise.resolve()
    .then(() => handler(req, res))
    .catch(err => console.error(`[queue:vercel] ${endpoint} failed:`, err.message));
  try {
    const { waitUntil } = require('@vercel/functions');
    waitUntil(job);
  } catch { /* not on Vercel: the promise simply runs */ }
  return `vercel:${endpoint}:${Date.now()}`;
}

async function enqueue(queueName, endpoint, payload) {
  const PROJECT  = process.env.GCP_PROJECT_ID;
  const LOCATION = process.env.GCP_REGION || 'asia-southeast1';
  const BACKEND  = process.env.BACKEND_URL;

  if (!PROJECT || process.env.QUEUE_MODE === 'local') {
    return process.env.VERCEL ? enqueueInProcess(endpoint, payload) : enqueueLocal(endpoint, payload);
  }
  if (!BACKEND) throw new Error('BACKEND_URL env var is not set');

  const parent = getClient().queuePath(PROJECT, LOCATION, queueName);
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${BACKEND}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': internalToken(),
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
  };

  console.log(`[cloudtasks] Enqueueing → ${queueName} : ${BACKEND}${endpoint}`);
  const [response] = await getClient().createTask({ parent, task });
  return response.name;
}

module.exports = { enqueue, internalToken };
