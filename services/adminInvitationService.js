import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { USER_ROLES } from "../models/userModel.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";

const PRIVILEGED_INVITE_ROLES = new Set([
  USER_ROLES.PARK_ADMIN,
  USER_ROLES.SITE_ADMIN
]);

function validateInvitePayload(payload = {}) {
  const email = String(payload.email || "").trim();
  const role = String(payload.role || "").trim();
  const assignedParks = Array.isArray(payload.assignedParks)
    ? payload.assignedParks.map((parkId) => String(parkId || "").trim()).filter(Boolean)
    : [];

  if (!email) {
    throw new Error("Invitee email is required.");
  }

  if (!PRIVILEGED_INVITE_ROLES.has(role)) {
    throw new Error("Only Park Admin and Site Admin invites are supported.");
  }

  if (role === USER_ROLES.SITE_ADMIN && assignedParks.length > 0) {
    throw new Error("Site Admin invites cannot include assigned parks.");
  }

  return {
    email,
    displayName: String(payload.displayName || "").trim(),
    role,
    assignedParks
  };
}

function getCallable(name) {
  initializeFirebaseServices();
  const { functions } = getFirebaseServices();

  if (!functions) {
    throw new Error("Firebase Functions is not available.");
  }

  return httpsCallable(functions, name);
}

async function inviteAdminAccount(payload = {}) {
  const validatedPayload = validateInvitePayload(payload);
  const inviteAdminUser = getCallable("inviteAdminUser");
  const response = await inviteAdminUser(validatedPayload);
  return response.data;
}

/**
 * Set a user's role and park assignments via the Site-Admin-only Cloud Function.
 *
 * Firestore rules forbid the client from writing `role` or `assignedParks` on any
 * user document, so these mutations must go through the server, where the caller
 * is verified against their Auth token claim.
 */
async function setUserRoleAndParks(targetUserId, role, assignedParks = []) {
  if (!targetUserId) {
    throw new Error("targetUserId is required.");
  }

  if (!Object.values(USER_ROLES).includes(role)) {
    throw new Error(`Unsupported role: ${role}`);
  }

  const callable = getCallable("setUserRoleAndParks");
  const response = await callable({
    targetUserId,
    role,
    assignedParks: Array.isArray(assignedParks) ? assignedParks : []
  });
  return response.data;
}

/**
 * Suspend or reinstate a user account via the Site-Admin-only Cloud Function.
 *
 * Firestore rules forbid the client from writing moderation fields on a user
 * document, and only the server can disable the underlying Auth account.
 */
async function moderateUserAccount(targetUserId, action) {
  if (!targetUserId) {
    throw new Error("targetUserId is required.");
  }

  const callable = getCallable("moderateUserAccount");
  const response = await callable({ targetUserId, action });
  return response.data;
}

/**
 * One-time migration helper for accounts created before custom claims existed.
 *
 * Copies the caller's Firestore role onto their Auth token, but only if they do
 * not already have a role claim. Safe to call on every sign-in; it is a no-op
 * once the claim is present.
 */
async function syncOwnRoleClaim() {
  const callable = getCallable("syncOwnRoleClaim");
  const response = await callable({});
  return response.data;
}

export { inviteAdminAccount, setUserRoleAndParks, moderateUserAccount, syncOwnRoleClaim };