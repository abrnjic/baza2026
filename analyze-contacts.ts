import fs from 'fs';
import csv from 'csv-parser';

interface CSVContact {
  'First Name': string;
  'Last Name': string;
  'E-mail 1 - Value': string;
  'Phone 1 - Value': string;
  'Phone 2 - Value': string;
}

async function analyze() {
  const contacts: CSVContact[] = [];
  
  await new Promise((resolve) => {
    fs.createReadStream('../contacts.csv')
      .pipe(csv())
      .on('data', (data) => contacts.push(data))
      .on('end', () => resolve(true));
  });

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
        email: fields.email?.stringValue || '',
      });
    });
  }
  
  const issues: string[] = [];
  const multiplePhones: string[] = [];
  const validImports: any[] = [];
  const updates: any[] = [];

  for (const contact of contacts) {
    const firstName = contact['First Name']?.trim() || '';
    const lastName = contact['Last Name']?.trim() || '';
    const email = contact['E-mail 1 - Value']?.trim() || '';
    let phone1 = contact['Phone 1 - Value']?.trim() || '';
    let phone2 = contact['Phone 2 - Value']?.trim() || '';
    
    if (!firstName && !lastName) {
      continue;
    }
    
    const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
    const reversedFullName = `${lastName} ${firstName}`.trim().toLowerCase();
    
    const matchedUsers = dbUsers.filter(u => {
      const dbName = (u.name || '').trim().toLowerCase();
      return dbName === fullName || 
             dbName === reversedFullName || 
             dbName.startsWith(fullName + ' ') || 
             dbName.startsWith(reversedFullName + ' ') ||
             dbName.startsWith(fullName + '-') ||
             dbName.startsWith(reversedFullName + '-');
    });
    
    if (matchedUsers.length === 0) {
      issues.push(`U CSV-u postoji "${firstName} ${lastName}", ali se NE NALAZI u bazi podataka.`);
      continue;
    }
    
    if (phone1 && phone2) {
      multiplePhones.push(`Korisnik "${firstName} ${lastName}" ima DVA broja telefona u CSV-u: ${phone1} i ${phone2}`);
    }
    
    // Choose the first available phone number
    const finalPhone = phone1 || phone2;
    
    for (const dbUser of matchedUsers) {
      // Only prepare the update if it changes something, or maybe overwrite?
      // Since some might already have phone numbers from the first round, let's just always update if we have a phone
      const updatePayload: any = {};
      if (finalPhone) {
          updatePayload.contact = finalPhone;
      }
      if (email) {
          updatePayload.email = email;
      }
      
      if (Object.keys(updatePayload).length > 0) {
          updates.push({
              id: dbUser.id,
              name: dbUser.name,
              update: updatePayload
          });
      }

      validImports.push({
        userId: dbUser.id,
        name: dbUser.name,
        email: email,
        phone: finalPhone,
      });
    }
  }

  // Filter out updates that were already done in the first round?
  // Wait, if it was done, the contact field will already be the finalPhone!
  const newUpdates = updates.filter(upd => {
    const dbU = dbUsers.find(u => u.id === upd.id);
    if (!dbU) return true;
    if (upd.update.contact && dbU.contact === upd.update.contact) {
      // It's already updated
      // Only keep if email is different?
      if (upd.update.email && dbU.email !== upd.update.email) return true;
      return false;
    }
    return true;
  });

  fs.writeFileSync('import-report.json', JSON.stringify({
    issues,
    multiplePhones,
    updates: newUpdates,
    totalValid: validImports.length
  }, null, 2));

  console.log('--- ANALIZA ZAVRŠENA ---');
  console.log(`Nepodudaranja imena i prezimena: ${issues.length}`);
  console.log(`Korisnici sa dva broja u CSV-u: ${multiplePhones.length}`);
  console.log(`Nove pretplate spremne za ažuriranje (pametno podudaranje): ${newUpdates.length}`);
}

analyze().catch(console.error);
