/*
  App Controller
  Purpose: Coordinate view-level actions and call services/models as needed.
  Add route handling, event listeners, and page-specific logic in this file.
*/

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeAuthController } from "./authController.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";

const appState = {
  isInitialized: false,
  authReady: false,
  currentUser: null,
  userRole: null,
  currentView: ""
};

function getCurrentView() {
  const pathName = window.location.pathname.toLowerCase();

  if (pathName.endsWith("login.html")) {
    return "login";
  }

  if (pathName.endsWith("dashboard.html")) {
    return "dashboard";
  }

  if (pathName.endsWith("profile.html")) {
    return "profile";
  }

  if (pathName.endsWith("home.html")) {
    return "home";
  }

  return "index";
}

function handleAuthStateChanged(firebaseUser) {
  appState.currentUser = firebaseUser;
  appState.authReady = true;
}

function initializeViewController() {
  if (appState.currentView === "login") {
    initializeAuthController();
  }
}

function initializeApp() {
  try {
    initializeFirebaseServices();
    const { auth } = getFirebaseServices();

    appState.currentView = getCurrentView();
    onAuthStateChanged(auth, handleAuthStateChanged);

    initializeViewController();
    appState.isInitialized = true;
    return appState;
  } catch (error) {
    appState.isInitialized = false;
    throw new Error(`App initialization failed: ${error.message}`);
  }
}

export { appState, initializeApp };
