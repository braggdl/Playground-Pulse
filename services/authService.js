/*
  Authentication Service
  Purpose: Handle login, logout, and user registration with Firebase Authentication.
  Add real Firebase Auth SDK logic inside these placeholder functions.
*/

import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";
import {
  getFriendlyAuthMessage,
  validatePasswordStrength
} from "../constants/authConstants.js";

function getAuthService() {
  initializeFirebaseServices();
  const { auth } = getFirebaseServices();

  if (!auth) {
    throw new Error("Authentication service failed to initialize.");
  }

  return auth;
}

function ensurePasswordStrength(password) {
  const validation = validatePasswordStrength(password);

  if (!validation.isValid) {
    throw new Error(validation.errors[0]);
  }
}

function createPublicAuthError(error, fallbackMessage) {
  if (!error?.code && error?.message) {
    return new Error(error.message);
  }

  return new Error(getFriendlyAuthMessage(error, fallbackMessage));
}

async function login(email, password) {
  try {
    const auth = getAuthService();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (error) {
    throw createPublicAuthError(error, "Login failed. Please try again.");
  }
}

async function logout() {
  try {
    const auth = getAuthService();
    await signOut(auth);
    return true;
  } catch (error) {
    throw createPublicAuthError(error, "Logout failed. Please try again.");
  }
}

async function registerUser(email, password, profile = {}) {
  try {
    ensurePasswordStrength(password);
    const auth = getAuthService();
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    if (profile.displayName) {
      await updateProfile(credential.user, { displayName: profile.displayName.trim() });
    }

    return credential.user;
  } catch (error) {
    throw createPublicAuthError(error, "Registration failed. Please try again.");
  }
}

async function resetPassword(email) {
  try {
    const auth = getAuthService();
    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (error) {
    throw createPublicAuthError(error, "Unable to send password reset email.");
  }
}

async function reauthenticateUser(currentPassword) {
  try {
    const auth = getAuthService();
    const currentUser = auth.currentUser;

    if (!currentUser?.email) {
      throw new Error("You must be signed in to continue.");
    }

    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    return true;
  } catch (error) {
    throw createPublicAuthError(error, "Reauthentication failed. Please try again.");
  }
}

async function updateUserPassword(currentPassword, newPassword) {
  try {
    ensurePasswordStrength(newPassword);
    await reauthenticateUser(currentPassword);

    const auth = getAuthService();
    await updatePassword(auth.currentUser, newPassword);
    return true;
  } catch (error) {
    throw createPublicAuthError(error, "Password update failed. Please try again.");
  }
}

async function updateAuthDisplayName(displayName) {
  try {
    const auth = getAuthService();

    if (!auth.currentUser) {
      throw new Error("You must be signed in to continue.");
    }

    await updateProfile(auth.currentUser, { displayName: displayName.trim() });
    return auth.currentUser;
  } catch (error) {
    throw createPublicAuthError(error, "Profile update failed. Please try again.");
  }
}

export {
  login,
  logout,
  registerUser,
  resetPassword,
  reauthenticateUser,
  updateUserPassword,
  updateAuthDisplayName
};
