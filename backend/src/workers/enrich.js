// Worker: /worker/enrich
// Called by Cloud Tasks (enrich-queue) after leads are approved.
// Runs Apify scrapers on each lead and saves key_contacts to Supabase.

const { supabase }    = require('../db/supabase');
const { enrichLead }  = require('../services/enrichment');

async function handleEnrich(req, res) {
  const { leadIds, jobId } = req.body;

  if (!leadIds?.length) {
    return res.status(400).json({ error: 'No leadIds provided' });
  }

  let totalContacts = 0;
  let failed        = 0;

  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .in('id', leadIds);

    if (error) throw error;

    console.log(`[enrich] Starting enrichment for ${leads.length} lead(s) — job ${jobId}`);

    for (const lead of leads) {
      // Mark this lead as currently being enriched
      await supabase.from('leads').update({
        enrichment_status: 'enriching',
      }).eq('id', lead.id);

      try {
        const count = await enrichLead(lead);
        totalContacts += count;

        await supabase.from('leads').update({
          enrichment_status: count > 0 ? 'enriched' : 'no_contacts_found',
          enriched_at:       new Date().toISOString(),
        }).eq('id', lead.id);

        console.log(`[enrich] Lead ${lead.id} (${lead.company_name}) → ${count} contact(s)`);

      } catch (err) {
        console.error(`[enrich] Failed for lead ${lead.id}:`, err.message);
        failed++;

        await supabase.from('leads').update({
          enrichment_status: 'failed',
        }).eq('id', lead.id);
      }
    }

    console.log(`[enrich] Done — total contacts found: ${totalContacts}, leads failed: ${failed}`);
    res.status(200).json({ status: 'ok', totalContacts, failed });

  } catch (err) {
    console.error(`[enrich] Worker crashed:`, err.message);
    res.status(200).json({ status: 'error', message: err.message });
  }
}

module.exports = { handleEnrich };
