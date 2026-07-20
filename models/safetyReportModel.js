/*
  Safety Report Model
  Purpose: Define the structure for safety and maintenance report records.

  API Contract:
  - createSafetyReportModel(partialReport) → safetyReport object
    Input:  partial object with any subset of report fields
    Output: fully-shaped report object with all fields populated to defaults
    Errors: none thrown; invalid type values fall back to "safety"

  Collection: safetyReports
  Fields:
    id          (string, required) — Firestore document ID; empty string on creation
    parkId      (string, required) — ID of the park this report is for
    userId      (string, required) — ID of the user who submitted the report
    type        (string, required) — "safety" or "maintenance"
    description (string, required) — free-text description of the issue
    status      (string, required) — one of SAFETY_REPORT_STATUSES values; defaults to "open"
    createdAt   (string, required) — ISO 8601 timestamp
    updatedAt   (string, required) — ISO 8601 timestamp; updated on each status transition
*/

import { SAFETY_REPORT_STATUSES } from "../constants/reportConstants.js";

const SAFETY_REPORT_TYPES = {
  SAFETY: "safety",
  MAINTENANCE: "maintenance"
};

const ALLOWED_SAFETY_REPORT_TYPES = Object.values(SAFETY_REPORT_TYPES);

function isValidReportType(type) {
  return ALLOWED_SAFETY_REPORT_TYPES.includes(type);
}

function createSafetyReportModel(partialReport = {}) {
  const now = new Date().toISOString();
  const type = partialReport.type || SAFETY_REPORT_TYPES.SAFETY;

  return {
    id: partialReport.id || "",
    parkId: partialReport.parkId || "",
    userId: partialReport.userId || "",
    type: isValidReportType(type) ? type : SAFETY_REPORT_TYPES.SAFETY,
    description: partialReport.description || "",
    status: partialReport.status || SAFETY_REPORT_STATUSES.OPEN,
    createdAt: partialReport.createdAt || now,
    updatedAt: partialReport.updatedAt || now
  };
}

export { SAFETY_REPORT_TYPES, ALLOWED_SAFETY_REPORT_TYPES, isValidReportType, createSafetyReportModel };
