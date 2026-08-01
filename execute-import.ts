import fs from 'fs';

async function executeImport() {
  const reportPath = 'import-report.json';
  if (!fs.existsSync(reportPath)) {
    console.error('Import report not found. Run analysis first.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const updates = report.updates;

  if (!updates || updates.length === 0) {
    console.log('No updates to process.');
    return;
  }

  console.log(`Starting import for ${updates.length} records...`);

  let successCount = 0;
  let failCount = 0;

  for (const item of updates) {
    const id = item.id;
    const updatePayload = item.update; // { contact: "...", email: "..." }

    const fields: any = {};
    const updateMask: string[] = [];

    if (updatePayload.contact) {
      fields.contact = { stringValue: updatePayload.contact };
      updateMask.push('updateMask.fieldPaths=contact');
    }
    
    if (updatePayload.email) {
      fields.email = { stringValue: updatePayload.email };
      updateMask.push('updateMask.fieldPaths=email');
    }

    if (updateMask.length === 0) {
      continue;
    }

    const maskQuery = updateMask.join('&');
    const url = `https://firestore.googleapis.com/v1/projects/baza-pretplatnika/databases/(default)/documents/subscriptions/${id}?${maskQuery}`;

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`Failed to update ${item.name} (${id}): ${response.status} ${err}`);
        failCount++;
      } else {
        successCount++;
        console.log(`Updated ${item.name} (${successCount}/${updates.length})`);
      }
    } catch (e) {
      console.error(`Error updating ${item.name} (${id})`, e);
      failCount++;
    }
    
    // Small delay to avoid rate limits
    await new Promise(res => setTimeout(res, 50));
  }

  console.log(`\n--- IMPORT COMPLETE ---`);
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed to update: ${failCount}`);
}

executeImport().catch(console.error);
