import fs from 'fs';

async function run() {
  const data = JSON.parse(fs.readFileSync('vcard-analysis.json', 'utf8'));
  const updates = data.updates;

  console.log(`Prepared ${updates.length} updates. Executing...`);

  let successCount = 0;
  let failCount = 0;

  for (const item of updates) {
    const fields: any = {};
    const updateMask: string[] = [];
    
    if (item.newPhone) {
        fields.phone = { stringValue: item.newPhone || '' };
        updateMask.push('updateMask.fieldPaths=phone');
    }
    
    if (item.newEmail) {
        fields.email = { stringValue: item.newEmail || '' };
        updateMask.push('updateMask.fieldPaths=email');
    }

    const maskQuery = updateMask.join('&');
    const url = `https://firestore.googleapis.com/v1/projects/baza-pretplatnika/databases/(default)/documents/subscriptions/${item.id}?${maskQuery}`;

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
        console.error(`Failed to update ${item.name} (${item.id}): ${response.status} ${err}`);
        failCount++;
      } else {
        successCount++;
        console.log(`Updated ${item.name}`);
      }
    } catch (e) {
      console.error(`Error updating ${item.name} (${item.id})`, e);
      failCount++;
    }
    
    await new Promise(res => setTimeout(res, 100)); // Sleep 100ms
  }

  console.log(`\n--- IMPORT COMPLETE ---`);
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed to update: ${failCount}`);
}

run().catch(console.error);
