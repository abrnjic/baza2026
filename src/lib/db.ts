import { db, isMockEnvironment } from './firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';

export interface Payment {
  id: string;
  date: number;
  amount: number;
  packageId: string;
}

export interface ActivityLog {
  id: string;
  date: number;
  text: string;
}

// Model podataka za jednu pretplatu
export interface Subscription {
  id: string; // Unique ID
  name: string;
  contact: string;
  phone?: string;
  email?: string;
  app: string;
  macAddress: string;
  deviceKey: string;
  note: string;
  expirationDate: string; // YYYY-MM-DD
  isPaid: boolean;
  isArchived?: boolean;
  createdAt?: number;
  tags?: string[];
  payments?: Payment[];
  logs?: ActivityLog[];
}

// Local Storage Fallback & Mock Event Emitter for Real-Time feel
type Listener = (data: Subscription[]) => void;
let listeners: Listener[] = [];
let cachedData: Subscription[] | null = null;
const DB_KEY = 'baza_korisnika_v1';

const notifyListeners = () => {
  if (cachedData) {
    listeners.forEach(l => l(cachedData!));
  }
};

const saveToLocal = (data: Subscription[]) => {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
  cachedData = data;
  notifyListeners();
};

const loadInitialData = async (): Promise<Subscription[]> => {
  try {
    const local = localStorage.getItem(DB_KEY);
    if (local) {
      return JSON.parse(local);
    }
    const res = await fetch('/baza.json');
    if (!res.ok) return [];
    const jsonData = await res.json();
    const initialData: Subscription[] = [];
    if (jsonData['PROSERVERS']) {
      jsonData['PROSERVERS'].forEach((row: any) => {
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
    saveToLocal(initialData);
    return initialData;
  } catch (error) {
    console.error("Failed to load initial data", error);
    return [];
  }
};

export const subscribeToSubscriptions = (callback: Listener) => {
  if (isMockEnvironment) {
    listeners.push(callback);
    if (cachedData) {
      callback(cachedData);
    } else {
      loadInitialData().then((data) => {
        cachedData = data;
        callback(data);
      });
    }
    return () => {
      listeners = listeners.filter(l => l !== callback);
    };
  } else {
    // FIREBASE IMPLEMENTATION
    const unsubscribe = onSnapshot(collection(db, "subscriptions"), (snapshot) => {
      const data: Subscription[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Subscription);
      });
      callback(data);
    }, (error) => {
      console.error("Firebase listen error", error);
    });
    
    return unsubscribe;
  }
};

export const addSubscription = async (sub: Omit<Subscription, 'id'>) => {
  if (isMockEnvironment) {
    const newSub = { ...sub, id: crypto.randomUUID() };
    const newData = [...(cachedData || []), newSub];
    saveToLocal(newData);
    return newSub;
  } else {
    await addDoc(collection(db, "subscriptions"), sub);
  }
};

export const updateSubscription = async (id: string, updates: Partial<Subscription>) => {
  if (isMockEnvironment) {
    const newData = (cachedData || []).map(sub => 
      sub.id === id ? { ...sub, ...updates } : sub
    );
    saveToLocal(newData);
  } else {
    await updateDoc(doc(db, "subscriptions", id), updates);
  }
};

export const deleteSubscription = async (id: string) => {
  if (isMockEnvironment) {
    const newData = (cachedData || []).filter(sub => sub.id !== id);
    saveToLocal(newData);
  } else {
    await deleteDoc(doc(db, "subscriptions", id));
  }
};

export const batchSyncSubscriptions = async (updates: {id: string, data: Partial<Subscription>}[], additions: Subscription[]) => {
  if (isMockEnvironment) return;
  const batch = writeBatch(db);
  
  // Updates
  updates.forEach(u => {
    const ref = doc(db, "subscriptions", u.id);
    batch.update(ref, u.data);
  });
  
  // Additions
  additions.forEach(a => {
    const { id, ...data } = a;
    const ref = doc(db, "subscriptions", id || crypto.randomUUID());
    batch.set(ref, data);
  });
  
  await batch.commit();
};

export const batchImportSubscriptions = async (subscriptions: Subscription[]) => {
    // This is a helper function to push all local data to Firebase initially
    if(isMockEnvironment) return;
    
    for (const sub of subscriptions) {
        // We use setDoc to keep the IDs if we want, or just let Firebase generate them
        const { id, ...data } = sub;
        await setDoc(doc(db, "subscriptions", id), data);
    }
}

// ---------------------------------------------
// SETTINGS
// ---------------------------------------------

export interface PricePackage {
  id: string;
  name: string;
  price: number;
  months: number; // 1, 3, 6, 12
  features: string[];
  badge?: string; // e.g. "NAJVEĆA UŠTEDA!"
}

export interface MessageTemplate {
  id: string;
  name: string;
  text: string;
}

export interface AppSettings {
  apps: string[];
  contacts: string[];
  geminiApiKey?: string;
  prices?: PricePackage[];
  messageTemplates?: MessageTemplate[];
  availableTags?: string[];
  cjenikTitle?: string;
  cjenikSubtitle?: string;
  cjenikNotes?: string[];
  quickMessageTemplate?: string;
}

export const subscribeToSettings = (callback: (settings: AppSettings) => void) => {
  if (isMockEnvironment) {
    callback({
      apps: [
        "IBO PLAYER", "IB PLAYER PRO", "HOT IPTV", "SMART STB", "MAG BOX", 
        "IM PLAYER", "IPTV EXTREME", "SMARTONE IPTV", "FLIX IPTV", "XC IPTV", 
        "WEB PLAYER", "DOT PLAYER", "SET IPTV", "SMART IPTV", "DUPLECAST", 
        "IPTV SMARTERS PRO", "IPHONE", "ANDROID MOB", "TELEVIZO", "LAPTOP-SMARTERS", 
        "1-STREAM PLAYER", "NANOMID", "SFVIP PLAYER", "IBO STB", "TIVIMATE", 
        "SSIPTV", "TABLET", "IPTV STREAM PLAYER", "NET IPTV", "BLINK PLAYER", 
        "SMARTERS PLAYER", "MyTVOnline", "CAP PLAYER", "XTREAM PLAYER", "I BOSS", 
        "IBO XPLAYER", "IBO BOB PLAYER", "PLAY TV", "9X Xtream 4K Player", "BOB PREMIUM"
      ],
      contacts: ["WHATS APP", "VIBER", "TELEGRAM", "MESSANGER", "SIGNAL", "E-MAIL"],
      prices: [
        { id: "1m", name: "Mjesečni paket", price: 8, months: 1, features: ["Gledanje uživo (1 uređaj)"] },
        { id: "3m", name: "Tromjesečni paket", price: 23, months: 3, features: ["Gledanje na 2 uređaja istovremeno!"] },
        { id: "6m", name: "Polugodišnji paket", price: 45, months: 6, features: ["Gledanje na 2 uređaja istovremeno", "48h unazad!"] },
        { id: "12m", name: "Godišnji paket", price: 84, months: 12, features: ["Gledanje na 2 uređaja istovremeno", "48h unazad", "Roditeljska zaštita!"] }
      ],
      messageTemplates: [
        { id: "t1", name: "Podsjetnik", text: "Poštovani {ime}, podsjećamo vas na vašu pretplatu." },
        { id: "t2", name: "Isteklo", text: "Poštovani {ime}, vaša pretplata je istekla. Molimo za uplatu." },
        { id: "t3", name: "Zahvala", text: "Poštovani {ime}, hvala na produženju pretplate!" }
      ],
      availableTags: ["VIP", "Obiteljski", "Problematičan"]
    });
    return () => {};
  } else {
    const unsubscribe = onSnapshot(doc(db, "settings", "general"), (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data() as AppSettings);
      } else {
        // Default if it doesn't exist yet
        const defaults = {
          apps: ["IBO PLAYER", "SMART STB", "TIVIMATE", "IPTV SMARTERS PRO", "IPHONE", "ANDROID"],
          contacts: ["WHATS APP", "VIBER", "TELEGRAM", "E-MAIL"],
          prices: [
            { id: "1m", name: "Mjesečni paket", price: 8, months: 1, features: ["Gledanje uživo (1 uređaj)"] },
            { id: "3m", name: "Tromjesečni paket", price: 23, months: 3, features: ["Gledanje na 2 uređaja istovremeno!"] },
            { id: "6m", name: "Polugodišnji paket", price: 45, months: 6, features: ["Gledanje na 2 uređaja istovremeno", "48h unazad!"] },
            { id: "12m", name: "Godišnji paket", price: 84, months: 12, features: ["Gledanje na 2 uređaja istovremeno", "48h unazad", "Roditeljska zaštita!"] }
          ],
          messageTemplates: [
            { id: "t1", name: "Podsjetnik", text: "Poštovani {ime}, podsjećamo vas na vašu pretplatu." },
            { id: "t2", name: "Isteklo", text: "Poštovani {ime}, vaša pretplata je istekla. Molimo za uplatu." },
            { id: "t3", name: "Zahvala", text: "Poštovani {ime}, hvala na produženju pretplate!" }
          ],
          availableTags: ["VIP", "Obiteljski", "Problematičan"]
        };
        setDoc(doc(db, "settings", "general"), defaults);
        callback(defaults);
      }
    });
    return unsubscribe;
  }
};

export const updateSettings = async (updates: Partial<AppSettings>) => {
  if (!isMockEnvironment) {
    await setDoc(doc(db, "settings", "general"), updates, { merge: true });
  }
};
