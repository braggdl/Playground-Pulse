import {
  getPasswordValidationErrors,
  canPerformAction,
  extractAuthErrorCode,
  getFriendlyAuthMessage
} from "./constants/authConstants.js";

import {
  normalizeCrowdLevel,
  getBusyLevelScoreFromCrowdLevel,
  getBusyLevelLabel,
  canTransition
} from "./constants/reportConstants.js";

import { normalizeParkSearchPageSize } from "./constants/searchConstants.js";

let sortParksByName = null;

try {
  ({ sortParksByName } = await import("./services/databaseService.js"));
} catch (error) {
  console.log(`SKIP: sortParksByName could not be imported because the database service depends on runtime Firebase support (${error.message})`);
}

function compare(actual, expected) {
  if (Number.isNaN(actual) && Number.isNaN(expected)) {
    return true;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((value, index) => compare(value, expected[index]));
  }

  if (typeof actual === "object" && actual !== null && typeof expected === "object" && expected !== null) {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();

    if (actualKeys.length !== expectedKeys.length) {
      return false;
    }

    return actualKeys.every((key) => compare(actual[key], expected[key]));
  }

  return actual === expected;
}

function test(name, actual, expected) {
  const passed = compare(actual, expected);

  if (passed) {
    console.log(`PASS: ${name}`);
    return true;
  }

  console.log(`FAIL: ${name}`);
  console.log(`  Expected: ${JSON.stringify(expected)}`);
  console.log(`  Actual:   ${JSON.stringify(actual)}`);
  return false;
}

let passedCount = 0;
let failedCount = 0;

// Test 1: A strong password should satisfy all policy rules and return no errors.
if (test("getPasswordValidationErrors accepts a strong password", getPasswordValidationErrors("StrongPass1"), [])) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 2: A weak password should report the missing requirements.
if (test("getPasswordValidationErrors reports weak password issues", getPasswordValidationErrors("weakpass"), [
  "Password must include at least one uppercase letter.",
  "Password must include at least one number."
])) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 3: An empty password should fail all applicable checks.
if (test("getPasswordValidationErrors reports all missing requirements for an empty password", getPasswordValidationErrors(""), [
  "Password must be at least 8 characters.",
  "Password must include at least one uppercase letter.",
  "Password must include at least one lowercase letter.",
  "Password must include at least one number."
])) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 4: A password at the exact minimum length should still pass.
if (test("getPasswordValidationErrors allows a password at the exact minimum length", getPasswordValidationErrors("Abcdefg1"), [])) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 5: An authorized role/action pair should pass permission checks.
if (test("canPerformAction allows Park Admin for safety report transitions", canPerformAction("Park Admin", "safetyReportTransition"), true)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 6: An unauthorized role should fail permission checks.
if (test("canPerformAction rejects unauthorized role", canPerformAction("Viewer", "assignParkAdmin"), false)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 7: Unknown actions should fail safely.
if (test("canPerformAction returns false for unknown actions", canPerformAction("Park Admin", "unknownAction"), false)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 8: A missing role should not be allowed to act.
if (test("canPerformAction returns false when role is missing", canPerformAction(null, "safetyReportTransition"), false)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 9: A valid crowd level should map to the expected busy score.
if (test("getBusyLevelScoreFromCrowdLevel converts valid level to score", getBusyLevelScoreFromCrowdLevel(3), 75)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 10: Numeric string input should be accepted and converted.
if (test("getBusyLevelScoreFromCrowdLevel converts numeric string input", getBusyLevelScoreFromCrowdLevel("3"), 75)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 11: Invalid crowd levels should be rejected.
if (test("getBusyLevelScoreFromCrowdLevel rejects invalid input", getBusyLevelScoreFromCrowdLevel(9), null)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 12: A moderate score should be labeled as Moderate.
if (test("getBusyLevelLabel maps moderate range to Moderate", getBusyLevelLabel(40), "Moderate")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 13: A high score should be labeled as Very Busy.
if (test("getBusyLevelLabel uses Very Busy for high scores", getBusyLevelLabel(75), "Very Busy")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 14: Non-numeric values should fall back to Unknown.
if (test("getBusyLevelLabel returns Unknown for non-numeric input", getBusyLevelLabel("abc"), "Unknown")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 15: Page sizes above the maximum should be clamped.
if (test("normalizeParkSearchPageSize clamps values above the maximum", normalizeParkSearchPageSize(100), 50)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 16: Non-positive page sizes should fall back to the default.
if (test("normalizeParkSearchPageSize uses the default for invalid values", normalizeParkSearchPageSize(0), 20)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 17: Park names should be sorted alphabetically.
if (sortParksByName) {
  if (test("sortParksByName orders parks alphabetically", sortParksByName([
    { name: "Zebra Park" },
    { name: "Apple Park" },
    { name: "Maple Park" }
  ]), [
    { name: "Apple Park" },
    { name: "Maple Park" },
    { name: "Zebra Park" }
  ])) {
    passedCount += 1;
  } else {
    failedCount += 1;
  }
} else {
  console.log("SKIP: sortParksByName test was not run because the import was unavailable.");
}

// Test 18: Valid crowd levels should normalize to numbers.
if (test("normalizeCrowdLevel converts valid crowd levels", normalizeCrowdLevel("3"), 3)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 19: Invalid crowd levels should be rejected.
if (test("normalizeCrowdLevel rejects invalid crowd levels", normalizeCrowdLevel(9), null)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 20: Authorized roles should be allowed to complete a valid transition.
if (test("canTransition allows an authorized role for a valid status transition", canTransition("open", "in_review", "Park Admin"), true)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 21: An invalid transition should be rejected even for an authorized role.
if (test("canTransition rejects an invalid status transition", canTransition("resolved", "in_review", "Park Admin"), false)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 22: An error object with a .code property should return that code directly.
if (test("extractAuthErrorCode reads code from error.code", extractAuthErrorCode({ code: "auth/user-not-found" }), "auth/user-not-found")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 23: When there is no .code property, the code should be extracted from the message string.
if (test("extractAuthErrorCode parses code from error.message when .code is absent", extractAuthErrorCode({ message: "Firebase: Error (auth/wrong-password)." }), "auth/wrong-password")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 24: A null error should return null without throwing.
if (test("extractAuthErrorCode returns null for a null error", extractAuthErrorCode(null), null)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 25: An error whose message contains no recognizable auth code should return null.
if (test("extractAuthErrorCode returns null when no auth code is present", extractAuthErrorCode({ message: "Something went wrong." }), null)) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 26: A known error code should resolve to the correct user-facing message.
if (test("getFriendlyAuthMessage returns the correct message for a known error code", getFriendlyAuthMessage({ code: "auth/email-already-in-use" }), "Email already registered. Please log in or use a different email.")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 27: A known code embedded in the error message should still map to the right string.
if (test("getFriendlyAuthMessage resolves a code embedded in the error message", getFriendlyAuthMessage({ message: "Firebase: Error (auth/too-many-requests)." }), "Too many attempts. Please wait and try again later.")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 28: An unrecognized error code should fall back to the default fallback message.
if (test("getFriendlyAuthMessage falls back to the default message for an unknown error code", getFriendlyAuthMessage({ code: "auth/unknown-code" }), "Authentication request failed.")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

// Test 29: A custom fallback message should be returned when the error cannot be mapped.
if (test("getFriendlyAuthMessage uses a custom fallback message when provided", getFriendlyAuthMessage(null, "Please try again."), "Please try again.")) {
  passedCount += 1;
} else {
  failedCount += 1;
}

console.log(`\nSummary: ${passedCount} passed, ${failedCount} failed`);

if (failedCount > 0) {
  process.exit(1);
}
