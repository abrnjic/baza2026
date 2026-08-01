import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCCq2sKeAVqK9VqTuL38D1V33kvnFVTU7w",
  authDomain: "baza-pretplatnika.firebaseapp.com",
  projectId: "baza-pretplatnika",
  storageBucket: "baza-pretplatnika.firebasestorage.app",
  messagingSenderId: "550118286342",
  appId: "1:550118286342:web:35636774a50fdac3614f87"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Check if we are using mock environment (no real API key provided)
export const isMockEnvironment = false;

export { app, db, auth };
