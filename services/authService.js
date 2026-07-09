/*
  Authentication Service
  Purpose: Handle login, logout, and user registration with Firebase Authentication.
  Add real Firebase Auth SDK logic inside these placeholder functions.
*/

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";

function getAuthService() {
  initializeFirebaseServices();
  const { auth } = getFirebaseServices();

  if (!auth) {
    throw new Error("Authentication service failed to initialize.");
  }

  return auth;
}

async function login(email, password) {
  try {
    const auth = getAuthService();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    throw new Error(`Login failed: ${error.message}`);
  }
}

async function logout() {
  try {
    const auth = getAuthService();
    await signOut(auth);
    return true;
  } catch (error) {
    throw new Error(`Logout failed: ${error.message}`);
  }
}

async function registerUser(email, password) {
  try {
    const auth = getAuthService();
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    throw new Error(`Registration failed: ${error.message}`);
  }
}

export { login, logout, registerUser };
