/*
  Reporting Constants
  Purpose: Define shared contracts for crowd-report throttling and busy-level display.
*/

import { PARK_ROLE_RULES } from "./authConstants.js";

const CROWD_REPORT_POLICY = {
  collectionName: "crowdReports",
  windowMinutes: 150,        // 2.5-hour rolling window for busy-level calculation and expiry
  reportsPerWindow: 1,       // one submission per user per park per hourly dedup key
  validCrowdLevels: [1, 2, 3, 4]
};

const BUSY_LEVEL_LABELS = {
  UNKNOWN: "Unknown",
  LOW: "Low",
  MODERATE: "Moderate",
  BUSY: "Busy",
  VERY_BUSY: "Very Busy"
};

const BUSY_LEVEL_THRESHOLDS = {
  LOW_MAX: 24,
  MODERATE_MAX: 49,
  BUSY_MAX: 74
};

const BUSY_LEVEL_WEIGHTING_POLICY = {
  // Most recent report has full weight; oldest report in the 60-minute window keeps a floor weight.
  minRecencyWeight: 0.25
};

function normalizeCrowdLevel(level) {
  const parsedLevel = Number(level);

  if (!Number.isFinite(parsedLevel)) {
    return null;
  }

  if (!CROWD_REPORT_POLICY.validCrowdLevels.includes(parsedLevel)) {
    return null;
  }

  return parsedLevel;
}

function getReportWindowStart(dateInput = new Date()) {
  const date = new Date(dateInput);
  date.setMinutes(0, 0, 0);
  return date;
}

function getReportWindowKey(dateInput = new Date()) {
  return getReportWindowStart(dateInput).toISOString();
}

function getBusyLevelScoreFromCrowdLevel(level) {
  const normalizedLevel = normalizeCrowdLevel(level);

  if (normalizedLevel === null) {
    return null;
  }

  return normalizedLevel * 25;
}

function getBusyLevelLabel(score) {
  if (!Number.isFinite(score)) {
    return BUSY_LEVEL_LABELS.UNKNOWN;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.LOW_MAX) {
    return BUSY_LEVEL_LABELS.LOW;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.MODERATE_MAX) {
    return BUSY_LEVEL_LABELS.MODERATE;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.BUSY_MAX) {
    return BUSY_LEVEL_LABELS.BUSY;
  }

  return BUSY_LEVEL_LABELS.VERY_BUSY;
}

// Sprint 3: Safety report status values and valid workflow transition map.
// Transitions: open → in_review → resolved → closed
// Only Park Admin and Site Admin roles may perform transitions (enforced via canTransition).
const SAFETY_REPORT_STATUSES = {
  OPEN: "open",
  IN_REVIEW: "in_review",
  RESOLVED: "resolved",
  CLOSED: "closed"
};

const SAFETY_REPORT_TRANSITIONS = {
  [SAFETY_REPORT_STATUSES.OPEN]: [SAFETY_REPORT_STATUSES.IN_REVIEW],
  [SAFETY_REPORT_STATUSES.IN_REVIEW]: [SAFETY_REPORT_STATUSES.RESOLVED],
  [SAFETY_REPORT_STATUSES.RESOLVED]: [SAFETY_REPORT_STATUSES.CLOSED],
  [SAFETY_REPORT_STATUSES.CLOSED]: [SAFETY_REPORT_STATUSES.OPEN]
};

// Sprint 3: Validate a safety report status transition and role authorization.
// Returns true only when both the transition is in the allowed map AND the role is authorized.
// Workstream feature code must call this before any status update.
function canTransition(currentStatus, targetStatus, role) {
  const allowedNextStatuses = SAFETY_REPORT_TRANSITIONS[currentStatus];

  if (!Array.isArray(allowedNextStatuses) || !allowedNextStatuses.includes(targetStatus)) {
    return false;
  }

  // Reopening a closed report is restricted to Site Admins only.
  if (currentStatus === SAFETY_REPORT_STATUSES.CLOSED && targetStatus === SAFETY_REPORT_STATUSES.OPEN) {
    return role === "Site Admin";
  }

  // Authorized roles are sourced from PARK_ROLE_RULES to keep a single source of truth.
  const authorizedRoles = PARK_ROLE_RULES.safetyReportTransition || [];
  return authorizedRoles.includes(role);
}

// Sprint 3: Equipment status values and display labels.
const EQUIPMENT_STATUSES = {
  OPERATIONAL: "operational",
  NEEDS_REPAIR: "needs_repair",
  OUT_OF_SERVICE: "out_of_service"
};

const EQUIPMENT_STATUS_LABELS = {
  [EQUIPMENT_STATUSES.OPERATIONAL]: "Operational",
  [EQUIPMENT_STATUSES.NEEDS_REPAIR]: "Needs Repair",
  [EQUIPMENT_STATUSES.OUT_OF_SERVICE]: "Out of Service"
};

export {
  CROWD_REPORT_POLICY,
  BUSY_LEVEL_LABELS,
  BUSY_LEVEL_THRESHOLDS,
  BUSY_LEVEL_WEIGHTING_POLICY,
  normalizeCrowdLevel,
  getReportWindowStart,
  getReportWindowKey,
  getBusyLevelScoreFromCrowdLevel,
  getBusyLevelLabel,
  SAFETY_REPORT_STATUSES,
  SAFETY_REPORT_TRANSITIONS,
  canTransition,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS
};