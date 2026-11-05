// Worker: /worker/scrape
// Flow:
//   1. running          — Scrape Google Maps via Apify
//   2. apollo_enriching — Apollo contact enrichment (if apolloEnabled)
//      OR cleaning      — Skip straight to clean (if apolloEnabled = false)
//   3. cleaning         — Clean, deduplicate, score leads (incl. Apollo contacts)
//   4. done             — Ready for approval
//
// NOTE: Contacts come from Apollo.io (primary).
// When Apollo finds 0 contacts for a company, the apollo-batch worker automatically
// falls back to LinkedIn / Facebook / Website via contactFinder.js (per-company).
// rawData is saved to scrape_jobs.raw_data before handing off to the next worker.

const { supabase } = require('../db/supabase');
const apify        = require('../services/apify');
const maps         = require('../services/mapsEngine');
const { enqueue }  = require('../services/cloudtasks');

async function handleScrape(req, res) {
  const { jobId, config } = req.body;

  try {
    // ── Step 1: Scrape Google Maps ────────────────────────────────────────────
    await supabase.from('scrape_jobs').update({ status: 'running' }).eq('id', jobId);

    const maxResults = config.maxResults || 50;
    const engine     = config.engine || 'apify';
    let allResults;

    if (engine === 'gosom' || engine === 'demo') {
      // Google Maps engine from "New search git" (self-hosted Docker or demo data)
      console.log(`[scrape] Job ${jobId} using ${engine} engine`);
      const log = line => console.log(`[scrape:${engine}] ${line}`);
      allResults = engine === 'gosom'
        ? await maps.runGosom(config, log)
        : await maps.runDemo(config, log);
    } else {
      console.log(`[scrape] Starting Apify run for job ${jobId}`);
      const runId = await apify.startRun(config);
      await supabase.from('scrape_jobs').update({ apify_run_id: runId }).eq('id', jobId);
      console.log(`[scrape] Waiting for Apify run ${runId} (maxResults=${maxResults})...`);
      const datasetId = await apify.waitForRun(runId, maxResults);
      allResults = await apify.getResults(datasetId, maxResults);
    }

    // Hard-cap to exactly maxResults — Apify actors have a minimum page size
    // (often 20) so a run asked for 5 can return up to 20 without this slice.
    const rawData = allResults.slice(0, maxResults);
    console.log(`[scrape] Got ${rawData.length} raw records (fetched ${allResults.length}, capped at ${maxResults})`);

    await supabase.from('scrape_jobs')
      .update({ total_records: rawData.length })
      .eq('id', jobId);

    // ── Step 2: Save raw data to DB, then route to next worker ────────────────
    // Cloud Tasks has a 1 MB body limit — persist to DB and pass only jobId.
    console.log(`[scrape] Saving ${rawData.length} records to DB for job ${jobId}...`);
    const { error: saveErr } = await supabase
      .from('scrape_jobs')
      .update({ raw_data: rawData })
      .eq('id', jobId);

    if (saveErr) throw new Error(`Failed to save raw_data to DB: ${saveErr.message}`);

    if (config?.apolloEnabled) {
      // Apollo enrichment runs BEFORE cleaning so contacts are available during scoring
      await supabase.from('scrape_jobs').update({ status: 'apollo_enriching' }).eq('id', jobId);
      await enqueue('enrich-queue', '/worker/apollo-batch', { jobId, config, mode: 'pre_clean' });
      console.log(`[scrape] Job ${jobId} handed off to Apollo pre-clean worker`);
    } else {
      // No Apollo — go straight to clean
      await supabase.from('scrape_jobs').update({ status: 'cleaning' }).eq('id', jobId);
      await enqueue('clean-queue', '/worker/clean', { jobId, config });
      console.log(`[scrape] Job ${jobId} handed off to clean worker`);
    }

    res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error(`[scrape] Job ${jobId} failed:`, err.message);
    await supabase.from('scrape_jobs').update({ status: 'error', last_error: err.message }).eq('id', jobId);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handleScrape };
