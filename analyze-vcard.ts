import fs from 'fs';

interface VCard {
  fn: string;
  phones: string[];
  emails: string[];
}

async function run() {
  console.log('Reading iCloud vCards.vcf...');
  const vcfData = fs.readFileSync('../iCloud vCards.vcf', 'utf8');
  
  const vcards: VCard[] = [];
  const lines = vcfData.split('\n');
  
  let currentCard: Partial<VCard> | null = null;
  
  for (const line of lines) {
    const l = line.trim();
    if (l === 'BEGIN:VCARD') {
      currentCard = { phones: [], emails: [] };
    } else if (l === 'END:VCARD') {
      if (currentCard && currentCard.fn) {
        vcards.push(currentCard as VCard);
      }
      currentCard = null;
    } else if (currentCard) {
      if (l.startsWith('FN:')) {
        currentCard.fn = l.substring(3).trim();
      } else if (l.startsWith('TEL')) {
        const parts = l.split(':');
        if (parts.length > 1) {
          currentCard.phones!.push(parts[1].trim());
        }
      } else if (l.startsWith('EMAIL')) {
        const parts = l.split(':');
        if (parts.length > 1) {
          currentCard.emails!.push(parts[1].trim());
        }
      }
    }
  }

  console.log(`Parsed ${vcards.length} contacts from VCF.`);

  console.log('Fetching Firestore documents...');
  const res = await fetch('https://firestore.googleapis.com/v1/projects/baza-pretplatnika/databases/(default)/documents/subscriptions?pageSize=1000');
  console.log('Fetch response received.');
  const json = await res.json();
  console.log('JSON parsed.');
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
  
  console.log(`Loaded ${dbUsers.length} DB users.`);
  
  const updates: any[] = [];
  let alreadyUpdated = 0;

  for (const dbUser of dbUsers) {
    const dbName = dbUser.name.trim().toLowerCase();
    if (!dbName) continue;
    
    // Find matching vcards
    for (const card of vcards) {
      if (!card.fn) continue;
      const fn = card.fn.toLowerCase().trim();
      
      const nameParts = fn.split(' ');
      const rev = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : fn;
      
      let isMatch = false;
      
      // Exact matches are always safe
      if (dbName === fn || dbName === rev) {
        isMatch = true;
      } 
      // If the vcard name is at least two words (or a single very long word like a company name),
      // then we can safely use the startsWith logic.
      else if (nameParts.length >= 2 || fn.length > 8) {
        if (dbName.startsWith(fn + ' ') || dbName.startsWith(rev + ' ') || dbName.startsWith(fn + '-') || dbName.startsWith(rev + '-')) {
          isMatch = true;
        }
      }
      
      if (isMatch) {
        // Matched!
        const finalPhone = card.phones[0] || '';
        const finalEmail = card.emails[0] || '';
        
        const hasNewPhone = finalPhone && dbUser.phone !== finalPhone;
        const hasNewEmail = finalEmail && dbUser.email !== finalEmail;

        if (hasNewPhone || hasNewEmail) {
            updates.push({
                id: dbUser.id,
                name: dbUser.name,
                matchedVCardName: card.fn,
                newPhone: hasNewPhone ? finalPhone : dbUser.phone,
                newEmail: hasNewEmail ? finalEmail : dbUser.email
            });
        } else if (finalPhone || finalEmail) {
            alreadyUpdated++;
        }
      }
    }
  }
  
  // Deduplicate updates in case multiple VCards matched one user
  const uniqueUpdatesMap = new Map();
  for (const u of updates) {
      if (!uniqueUpdatesMap.has(u.id)) {
          uniqueUpdatesMap.set(u.id, u);
      }
  }
  
  const uniqueUpdates = Array.from(uniqueUpdatesMap.values());

  fs.writeFileSync('vcard-analysis.json', JSON.stringify({
    totalVCards: vcards.length,
    updates: uniqueUpdates,
    alreadyUpdated
  }, null, 2));

  console.log(`\n--- VCF ANALIZA ZAVRŠENA ---`);
  console.log(`Pronađeno korisnika u VCF: ${vcards.length}`);
  console.log(`Već imaju iste podatke iz VCF: ${alreadyUpdated}`);
  console.log(`Spremno za novo ažuriranje: ${uniqueUpdates.length}`);
}

run().catch(console.error);
