import fs from 'fs';
import csv from 'csv-parser';

interface CSVContact {
  'First Name': string;
  'Last Name': string;
  'E-mail 1 - Value': string;
  'Phone 1 - Value': string;
  'Phone 2 - Value': string;
}

async function run() {
  console.log('Reading baza.json...');
  const bazaRaw = fs.readFileSync('public/baza.json', 'utf8');
  const baza = JSON.parse(bazaRaw);
  const bazaUsers = baza.PROSERVERS || [];

  console.log('Reading contacts.csv...');
  const contacts: CSVContact[] = [];
  await new Promise((resolve) => {
    fs.createReadStream('../contacts.csv')
      .pipe(csv())
      .on('data', (data) => contacts.push(data))
      .on('end', () => resolve(true));
  });

  console.log('Fetching Firestore documents...');
  const res = await fetch('https://firestore.googleapis.com/v1/projects/baza-pretplatnika/databases/(default)/documents/subscriptions?pageSize=1000');
  const json = await res.json();
  const dbUsers: any[] = [];
  
  if (json.documents) {
    json.documents.forEach((doc: any) => {
      const id = doc.name.split('/').pop();
      const fields = doc.fields;
      dbUsers.push({
        id,
        name: fields.name?.stringValue || '',
        contact: fields.contact?.stringValue || '',
        phone: fields.phone?.stringValue || '',
        email: fields.email?.stringValue || '',
      });
    });
  }
  
  const updates: any[] = [];

  for (const dbUser of dbUsers) {
    let newContactValue = dbUser.contact;
    let newPhoneValue = dbUser.phone;
    let newEmailValue = dbUser.email;
    let shouldUpdate = false;

    // 1. RECOVERY: If the 'contact' field looks like a phone number, it means I overwrote it.
    // We should restore the original 'contact' from baza.json and move the current 'contact' to 'phone'.
    // If it starts with + or is just numbers.
    if (newContactValue.match(/^[+\d\s]+$/) && newContactValue.length > 5) {
      newPhoneValue = newContactValue; // Move it to phone
      
      // Find original contact in baza.json
      // First try to match exactly
      const bazaOriginal = bazaUsers.find((bu: any) => bu['IME I PREZIME'] === dbUser.name);
      if (bazaOriginal && bazaOriginal['KONTAKT']) {
        newContactValue = bazaOriginal['KONTAKT'];
      } else {
        // Just empty it so it can be re-selected, or default to WHATSAPP if not found
        newContactValue = 'WHATS APP';
      }
      shouldUpdate = true;
    }
    
    // Also, some might not have been overwritten but we still want to apply smart matching from CSV.
    // Let's do the smart match against CSV to see if we have a phone number for this user.
    const dbName = dbUser.name.trim().toLowerCase();
    
    for (const c of contacts) {
      const fName = c['First Name']?.trim() || '';
      const lName = c['Last Name']?.trim() || '';
      if (!fName && !lName) continue;
      
      const full = `${fName} ${lName}`.trim().toLowerCase();
      const rev = `${lName} ${fName}`.trim().toLowerCase();
      
      if (dbName === full || dbName === rev || dbName.startsWith(full + ' ') || dbName.startsWith(rev + ' ') || dbName.startsWith(full + '-') || dbName.startsWith(rev + '-')) {
        // Matched!
        const p1 = c['Phone 1 - Value']?.trim() || '';
        const p2 = c['Phone 2 - Value']?.trim() || '';
        const em = c['E-mail 1 - Value']?.trim() || '';
        
        const finalPhone = p1 || p2;
        if (finalPhone && newPhoneValue !== finalPhone) {
          newPhoneValue = finalPhone;
          shouldUpdate = true;
        }
        if (em && newEmailValue !== em) {
          newEmailValue = em;
          shouldUpdate = true;
        }
      }
    }

    if (shouldUpdate) {
      updates.push({
        id: dbUser.id,
        name: dbUser.name,
        contact: newContactValue,
        phone: newPhoneValue,
        email: newEmailValue
      });
    }
  }

  console.log(`Prepared ${updates.length} updates. Executing...`);

  let successCount = 0;
  let failCount = 0;

  for (const item of updates) {
    const fields: any = {};
    const updateMask: string[] = [];

    fields.contact = { stringValue: item.contact || '' };
    updateMask.push('updateMask.fieldPaths=contact');
    
    fields.phone = { stringValue: item.phone || '' };
    updateMask.push('updateMask.fieldPaths=phone');
    
    fields.email = { stringValue: item.email || '' };
    updateMask.push('updateMask.fieldPaths=email');

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
        // console.log(`Updated ${item.name} (${successCount}/${updates.length})`);
      }
    } catch (e) {
      console.error(`Error updating ${item.name} (${item.id})`, e);
      failCount++;
    }
    
    await new Promise(res => setTimeout(res, 50));
  }

  console.log(`\n--- RECOVERY AND IMPORT COMPLETE ---`);
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed to update: ${failCount}`);
}

run().catch(console.error);
