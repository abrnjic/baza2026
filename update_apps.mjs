import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCCq2sKeAVqK9VqTuL38D1V33kvnFVTU7w",
  authDomain: "baza-pretplatnika.firebaseapp.com",
  projectId: "baza-pretplatnika",
  storageBucket: "baza-pretplatnika.firebasestorage.app",
  messagingSenderId: "550118286342",
  appId: "1:550118286342:web:35636774a50fdac3614f87",
  measurementId: "G-WWMB28SZ4C"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const allApps = [
  "IBO PLAYER", "IB PLAYER PRO", "HOT IPTV", "SMART STB", "MAG BOX", 
  "IM PLAYER", "IPTV EXTREME", "SMARTONE IPTV", "FLIX IPTV", "XC IPTV", 
  "WEB PLAYER", "DOT PLAYER", "SET IPTV", "SMART IPTV", "DUPLECAST", 
  "IPTV SMARTERS PRO", "IPHONE", "ANDROID MOB", "TELEVIZO", "LAPTOP-SMARTERS", 
  "1-STREAM PLAYER", "NANOMID", "SFVIP PLAYER", "IBO STB", "TIVIMATE", 
  "SSIPTV", "TABLET", "IPTV STREAM PLAYER", "NET IPTV", "BLINK PLAYER", 
  "SMARTERS PLAYER", "MyTVOnline", "CAP PLAYER", "XTREAM PLAYER", "I BOSS", 
  "IBO XPLAYER", "IBO BOB PLAYER", "PLAY TV", "9X Xtream 4K Player", "BOB PREMIUM"
];

async function update() {
  const docRef = doc(db, "settings", "general");
  const docSnap = await getDoc(docRef);
  let currentApps = [];
  if (docSnap.exists()) {
    currentApps = docSnap.data().apps || [];
  }
  const mergedApps = Array.from(new Set([...allApps, ...currentApps]));
  await setDoc(docRef, { apps: mergedApps }, { merge: true });
  console.log("Apps updated! Total apps:", mergedApps.length);
  process.exit(0);
}

update().catch(console.error);
