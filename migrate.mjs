import fs from 'fs';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, setDoc, doc } from "firebase/firestore";
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrate() {
  console.log("Reading baza.json...");
  const rawData = fs.readFileSync('public/baza.json', 'utf8');
  const jsonData = JSON.parse(rawData);
  
  const initialData = [];
  if (jsonData['PROSERVERS']) {
    jsonData['PROSERVERS'].forEach((row) => {
      initialData.push({
        id: crypto.randomUUID(),
        name: row['IME I PREZIME'] || '',
        contact: row['KONTAKT'] || '',
        app: row['APLIKACIJE'] || '',
        macAddress: row['MAC ADRESA'] || '',
        deviceKey: row['DEVICE KEY'] || '',
        note: row['NAPOMENA'] || '',
        expirationDate: row['ISTEK'] && row['ISTEK'] !== 'NaT' ? row['ISTEK'] : '',
        isPaid: false,
        createdAt: Date.now()
      });
    });
  }

  console.log(`Found ${initialData.length} records. Uploading to Firestore...`);
  let count = 0;
  for (const sub of initialData) {
    const { id, ...data } = sub;
    await setDoc(doc(db, "subscriptions", id), data);
    count++;
    if (count % 50 === 0) console.log(`Uploaded ${count}...`);
  }
  
  console.log("Migration complete!");
  process.exit(0);
}

migrate().catch(console.error);
