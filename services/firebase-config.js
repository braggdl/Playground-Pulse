/*
  Firebase Configuration Placeholder
  Add your Firebase project configuration values in the object below.
  Do NOT commit real secrets to public repositories.
*/

import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBXPP4lfYO_OSYiv4DdnsoiYEZTl7d0t4I",
  authDomain: "playground-pulse-8e2c4.firebaseapp.com",
  projectId: "playground-pulse-8e2c4",
  storageBucket: "playground-pulse-8e2c4.firebasestorage.app",
  messagingSenderId: "1077539477518",
  appId: "1:1077539477518:web:0500c43a256019e685845f",
  measurementId: "G-TWZZQYR7W3"
};

let firebaseServices = null;

function initializeFirebaseServices() {
  if (firebaseServices) {
    return firebaseServices;
  }

  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    firebaseServices = { app, auth, db };
    return firebaseServices;
  } catch (error) {
    throw new Error("Firebase services could not be initialized.");
  }
}

function getFirebaseServices() {
  if (!firebaseServices) {
    throw new Error("Firebase services are not initialized. Call initializeFirebaseServices() first.");
  }

  return firebaseServices;
}

export { firebaseConfig, initializeFirebaseServices, getFirebaseServices };
