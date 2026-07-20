/*
  Authentication Constants
  Purpose: Centralize password policy and public-facing auth error messaging.
*/

const PASSWORD_POLICY = {
  version: 2,
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  minDisplayNameLength: 2
};

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "Email already registered. Please log in or use a different email.",
  "auth/invalid-credential": "Incorrect email or password. Please try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-password": "Password is required.",
  "auth/network-request-failed": "Network error. Please check your connection and try again.",
  "auth/requires-recent-login": "Please re-enter your password to continue.",
  "auth/too-many-requests": "Too many attempts. Please wait and try again later.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/user-not-found": "User not found. Please check your email or register.",
  "auth/weak-password": "Password does not meet the Playground Pulse password policy.",
  "auth/wrong-password": "Incorrect password. Please try again."
};

function getPasswordValidationErrors(password = "") {
  const errors = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters.`);
  }

  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must include at least one uppercase letter.");
  }

  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must include at least one lowercase letter.");
  }

  if (PASSWORD_POLICY.requireNumber && !/[0-9]/.test(password)) {
    errors.push("Password must include at least one number.");
  }

  return errors;
}

function validatePasswordStrength(password = "") {
  const errors = getPasswordValidationErrors(password);

  return {
    isValid: errors.length === 0,
    errors
  };
}

function extractAuthErrorCode(error) {
  if (error?.code) {
    return error.code;
  }

  const message = error?.message || "";
  const matchedCode = message.match(/auth\/[a-z-]+/i);
  return matchedCode ? matchedCode[0].toLowerCase() : null;
}

function getFriendlyAuthMessage(error, fallbackMessage = "Authentication request failed.") {
  const errorCode = extractAuthErrorCode(error);

  if (errorCode && AUTH_ERROR_MESSAGES[errorCode]) {
    return AUTH_ERROR_MESSAGES[errorCode];
  }

  return fallbackMessage;
}

// Sprint 3: Park-level role authorization rules.
// Keys map to action names used by canPerformAction().
// Values are arrays of USER_ROLES values that are authorized for each action.
const PARK_ROLE_RULES = {
  safetyReportTransition: ["Park Admin", "Site Admin"],
  equipmentStatusChange: ["Park Admin", "Site Admin"],
  assignParkAdmin: ["Site Admin"],
  removeParkAdmin: ["Site Admin"],
  moderateContent: ["Park Admin", "Site Admin"],
  moderateUser: ["Site Admin"],
  viewAuditLog: ["Site Admin"],
  logAuditEvent: ["Park Admin", "Site Admin"]
};

// Sprint 3: Check whether a given role is authorized for an action.
// Returns true if the role is in the allowed list for the action; false otherwise.
// Unknown action names return false (fail-safe default).
function canPerformAction(role, action) {
  const allowedRoles = PARK_ROLE_RULES[action];

  if (!Array.isArray(allowedRoles)) {
    return false;
  }

  return allowedRoles.includes(role);
}

export {
  PASSWORD_POLICY,
  AUTH_ERROR_MESSAGES,
  getPasswordValidationErrors,
  validatePasswordStrength,
  extractAuthErrorCode,
  getFriendlyAuthMessage,
  PARK_ROLE_RULES,
  canPerformAction
};