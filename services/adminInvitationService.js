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

async function inviteAdminAccount(payload = {}) {
  const validatedPayload = validateInvitePayload(payload);

  initializeFirebaseServices();
  const { functions } = getFirebaseServices();

  if (!functions) {
    throw new Error("Firebase Functions is not available.");
  }

  const inviteAdminUser = httpsCallable(functions, "inviteAdminUser");
  const response = await inviteAdminUser(validatedPayload);
  return response.data;
}

export { inviteAdminAccount };