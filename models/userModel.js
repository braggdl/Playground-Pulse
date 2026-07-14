/*
  User Model
  Purpose: Define the shape of user data used across the app.
  Add validation rules and helper methods for user data here.
*/

import { PASSWORD_POLICY } from "../constants/authConstants.js";

const USER_ROLES = {
  PARENT: "Parent",
  PARK_ADMIN: "Park Admin",
  SITE_ADMIN: "Site Admin"
};

const ALLOWED_USER_ROLES = Object.values(USER_ROLES);

function isValidUserRole(role) {
  return ALLOWED_USER_ROLES.includes(role);
}

function createUserModel(partialUser = {}) {
  const role = partialUser.role || USER_ROLES.PARENT;
  const now = new Date().toISOString();

  return {
    uid: partialUser.uid || "",
    email: partialUser.email || "",
    role: isValidUserRole(role) ? role : USER_ROLES.PARENT,
    displayName: partialUser.displayName || "",
    lastPasswordChangeAt: partialUser.lastPasswordChangeAt || null,
    lastReauthenticatedAt: partialUser.lastReauthenticatedAt || null,
    reauthRequired: Boolean(partialUser.reauthRequired),
    passwordPolicyVersion: partialUser.passwordPolicyVersion || PASSWORD_POLICY.version,
    createdAt: partialUser.createdAt || now,
    updatedAt: partialUser.updatedAt || now
  };
}

export { USER_ROLES, ALLOWED_USER_ROLES, isValidUserRole, createUserModel };
