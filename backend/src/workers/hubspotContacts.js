// Worker: /worker/hubspot-contacts
// Called by Cloud Tasks after key contacts are bulk-approved.
// Pushes real person contacts (with name, title, LinkedIn) to HubSpot.

const { supabase }               = require('../db/supabase');
const { createEnrichedContact, associateContactWithCompany } = require('../services/hubspot');

async function handleHubspotContacts(req, res) {
  const { contactIds, jobId } = req.body;

  if (!contactIds?.length) {
    return res.status(400).json({ error: 'No contactIds provided' });
  }

  let pushed = 0;
  let failed = 0;

  try {
    // Fetch key contacts with their parent lead data
    const { data: contacts, error } = await supabase
      .from('key_contacts')
      .select('*, leads!inner(website, address, industry, lead_score, lead_status, rating, reviews_count, google_maps_url, hubspot_company_id, dbd_url)')
      .in('id', contactIds)
      .eq('status', 'approved');

    if (error) throw error;

    console.log(`[hubspot-contacts] Pushing ${contacts.length} enriched contact(s) — job ${jobId}`);

    for (const contact of contacts) {
      try {
        const lead = contact.leads;

        const hubspotId = await createEnrichedContact({
          // Real person fields
          first_name:   contact.first_name,
          last_name:    contact.last_name,
          job_title:    contact.job_title,
          linkedin_url: contact.linkedin_url,
          public_email: contact.public_email,
          public_phone: contact.public_phone,

          // Company context from parent lead
          company_name: contact.company_name,
          website:      lead?.website      || '',
          address:      lead?.address      || '',
          industry:     lead?.industry     || '',
          lead_score:   lead?.lead_score   || 0,
          lead_status:  lead?.lead_status  || 'Warm',
          rating:       lead?.rating,
          reviews_count: lead?.reviews_count,
          google_maps_url: lead?.google_maps_url,
          dbd_url:         lead?.dbd_url   || '',
        });

        await supabase.from('key_contacts').update({
          hubspot_contact_id: hubspotId,
          pushed_to_hubspot:  true,
          status:             'pushed',
          updated_at:         new Date().toISOString(),
        }).eq('id', contact.id);

        // ── Associate contact with HubSpot Company if one exists for this lead ──
        const hubspotCompanyId = lead?.hubspot_company_id || null;
        if (hubspotCompanyId) {
          try {
            await associateContactWithCompany(hubspotId, hubspotCompanyId);
          } catch (assocErr) {
            console.warn(`[hubspot-contacts] Association non-fatal (contact ${hubspotId} ↔ company ${hubspotCompanyId}):`, assocErr.message);
          }
        }

        console.log(`[hubspot-contacts] Pushed contact ${contact.id} (${contact.person_name}) → HubSpot ${hubspotId}${hubspotCompanyId ? ` (assoc. company ${hubspotCompanyId})` : ''}`);
        pushed++;

        // Respect HubSpot rate limits
        await new Promise(r => setTimeout(r, 150));

      } catch (err) {
        console.error(`[hubspot-contacts] Failed for contact ${contact.id}:`, err.response?.data || err.message);
        failed++;
      }
    }

    console.log(`[hubspot-contacts] Done — pushed: ${pushed}, failed: ${failed}`);
    res.status(200).json({ status: 'ok', pushed, failed });

  } catch (err) {
    console.error(`[hubspot-contacts] Worker crashed:`, err.message);
    res.status(200).json({ status: 'error', message: err.message });
  }
}

module.exports = { handleHubspotContacts };
