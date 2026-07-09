/*
  App Controller
  Purpose: Coordinate view-level actions and call services/models as needed.
  Add route handling, event listeners, and page-specific logic in this file.
*/

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeAuthController, handleLogout } from "./authController.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";
import { readRecords } from "../services/databaseService.js";

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

// ============================================================
// Authentication and Authorization Functions
// ============================================================

function isAuthenticated() {
  return appState.currentUser !== null;
}

function getCurrentUserRole() {
  return appState.userRole;
}

function canCreateParkRecord() {
  const role = getCurrentUserRole();
  return role === "Park Admin" || role === "Site Admin";
}

function canEditParkRecord() {
  const role = getCurrentUserRole();
  return role === "Park Admin" || role === "Site Admin";
}

function canDeleteParkRecord() {
  const role = getCurrentUserRole();
  return role === "Site Admin";
}

function enforceRoleOrThrow(requiredRoles) {
  const currentRole = getCurrentUserRole();
  if (!requiredRoles.includes(currentRole)) {
    throw new Error(`You don't have permission to perform this action. Required role(s): ${requiredRoles.join(", ")}`);
  }
}

async function loadUserRole(uid) {
  try {
    const users = await readRecords("users", { uid: uid });
    if (users && users.length > 0) {
      appState.userRole = users[0].role;
    } else {
      appState.userRole = null;
    }
  } catch (error) {
    console.error("Failed to load user role:", error);
    appState.userRole = null;
  }
}

function redirectIfNotAuthenticated(currentView) {
  // Views that require authentication
  const protectedViews = ["dashboard", "profile"];

  if (protectedViews.includes(currentView) && !isAuthenticated()) {
    window.location.href = "./login.html";
  }
}

// ============================================================
// Auth State Handler
// ============================================================

async function handleAuthStateChanged(firebaseUser) {
  appState.currentUser = firebaseUser;
  appState.authReady = true;

  // Phase 2: Load user role from Firestore when user logs in
  if (firebaseUser) {
    await loadUserRole(firebaseUser.uid);
  } else {
    appState.userRole = null;
  }

  // Check route protection after auth state is ready
  redirectIfNotAuthenticated(appState.currentView);
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

    // Route protection now happens in handleAuthStateChanged after auth state is ready
    initializeViewController();
    appState.isInitialized = true;
    return appState;
  } catch (error) {
    appState.isInitialized = false;
    throw new Error(`App initialization failed: ${error.message}`);
  }
}

export {
  appState,
  initializeApp,
  isAuthenticated,
  getCurrentUserRole,
  canCreateParkRecord,
  canEditParkRecord,
  canDeleteParkRecord,
  enforceRoleOrThrow
};
