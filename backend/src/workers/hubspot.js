// Worker: /worker/hubspot
// Called by Cloud Tasks after human approval.
// Enhanced flow:
//   1. Apollo company enrichment (headcount, revenue, DBD URL) — skipped if already done
//   2. Create / update HubSpot Company (with Google Rating, Reviews, Apollo data, DBD URL)
//   3. Create / update HubSpot Contact (the lead as a company-level contact)
//   4. Associate Contact <-> Company in HubSpot
//   5. Store hubspot_company_id + hubspot_contact_id back to DB

const { supabase }                   = require('../db/supabase');
const { createContact, findExisting,
        createOrUpdateHubSpotCompany,
        associateContactWithCompany } = require('../services/hubspot');
const { enrichCompanyWithApollo }     = require('../services/apolloCompany');
const { sendPushComplete }           = require('../services/notify');

async function handleHubspot(req, res) {
  const { leadIds, jobId } = req.body;
  let pushed = 0;
  let failed = 0;

  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .in('id', leadIds);

    if (error) throw error;

    console.log(`[hubspot] Pushing ${leads.length} leads to HubSpot`);

    for (const lead of leads) {
      try {
        // ── Step 1: Apollo company enrichment ──────────────────────────────────
        // Skip if already enriched (apollo_company_enriched_at is set)
        let apolloData = null;
        if (!lead.apollo_company_enriched_at) {
          try {
            apolloData = await enrichCompanyWithApollo(lead);
            console.log(`[hubspot] Apollo enrich "${lead.company_name}": found=${apolloData.found}`);
          } catch (apolloErr) {
            console.warn(`[hubspot] Apollo enrich non-fatal for ${lead.id}:`, apolloErr.message);
          }
        } else {
          // Reuse already-stored Apollo data
          apolloData = {
            found:        !!lead.apollo_company_id,
            apolloOrgId:  lead.apollo_company_id,
            headcount:    lead.apollo_headcount,
            revenue:      lead.apollo_revenue,
            revenueRange: lead.apollo_revenue_range,
            dbdUrl:       lead.dbd_url,
          };
        }

        // Re-fetch lead to get freshly saved Apollo fields
        const { data: l } = await supabase.from('leads').select('*').eq('id', lead.id).single();

        // ── Step 2: Create / update HubSpot Company ────────────────────────────
        let hubspotCompanyId = l.hubspot_company_id || null;
        try {
          hubspotCompanyId = await createOrUpdateHubSpotCompany(l, apolloData);
          await supabase.from('leads').update({ hubspot_company_id: hubspotCompanyId }).eq('id', l.id);
          console.log(`[hubspot] Company "${l.company_name}" -> HubSpot company ${hubspotCompanyId}`);
        } catch (companyErr) {
          console.warn(`[hubspot] Company create non-fatal for ${l.id}:`, companyErr.message);
        }

        // ── Step 3: Create / update HubSpot Contact ────────────────────────────
        let contactId = null;
        try {
          contactId = await findExisting(l) || await createContact(l);
          await supabase
            .from('leads')
            .update({ hubspot_contact_id: contactId, pushed_to_hubspot: true })
            .eq('id', l.id);
          console.log(`[hubspot] Contact "${l.company_name}" -> HubSpot contact ${contactId}`);
        } catch (contactErr) {
          console.error(`[hubspot] Contact create failed for ${l.id}:`, contactErr.message);
          failed++;
          continue;
        }

        // ── Step 4: Associate Contact <-> Company ──────────────────────────────
        if (contactId && hubspotCompanyId) {
          try {
            await associateContactWithCompany(contactId, hubspotCompanyId);
          } catch (assocErr) {
            console.warn(`[hubspot] Association non-fatal for contact ${contactId}:`, assocErr.message);
          }
        }

        pushed++;
      } catch (leadErr) {
        console.error(`[hubspot] Failed for lead ${lead.id}:`, leadErr.message);
        failed++;
      }
    }

    // Notify
    try {
      await sendPushComplete({ jobId, pushed, failed, total: leads.length });
    } catch { /* notify non-fatal */ }

    res.json({ success: true, pushed, failed, total: leads.length });
  } catch (err) {
    console.error('[hubspot] Worker error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handleHubspot };
