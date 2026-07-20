/*
  Park Model
  Purpose: Define the structure for playground/park data records.
  Add validation and transformation helpers for park data here.
*/

import {
  BUSY_LEVEL_LABELS,
  getBusyLevelLabel,
  getReportWindowKey
} from "../constants/reportConstants.js";

const MAINTENANCE_STATUS = {
  GOOD: "good",
  NEEDS_ATTENTION: "needs_attention",
  CLOSED: "closed",
  UNKNOWN: "unknown"
};

const ALLOWED_MAINTENANCE_STATUS = Object.values(MAINTENANCE_STATUS);

function isValidMaintenanceStatus(status) {
  return ALLOWED_MAINTENANCE_STATUS.includes(status);
}

function createParkModel(partialPark = {}) {
  const maintenanceStatus = partialPark.maintenanceStatus || MAINTENANCE_STATUS.UNKNOWN;
  const busyLevelScore = Number.isFinite(partialPark.busyLevel?.score)
    ? partialPark.busyLevel.score
    : null;
  const now = new Date().toISOString();

  return {
    id: partialPark.id || "",
    name: partialPark.name || "",
    location: partialPark.location || "",
    ageGroups: {
      toddler: Boolean(partialPark.ageGroups?.toddler),
      kid: Boolean(partialPark.ageGroups?.kid),
      teen: Boolean(partialPark.ageGroups?.teen)
    },
    fencedArea: Boolean(partialPark.fencedArea),
    restrooms: Boolean(partialPark.restrooms),
    shadeAvailable: Boolean(partialPark.shadeAvailable),
    maintenanceStatus: isValidMaintenanceStatus(maintenanceStatus)
      ? maintenanceStatus
      : MAINTENANCE_STATUS.UNKNOWN,
    busyLevel: {
      score: busyLevelScore,
      label: partialPark.busyLevel?.label || getBusyLevelLabel(busyLevelScore),
      updatedAt: partialPark.busyLevel?.updatedAt || null
    },
    crowdReporting: {
      enabled: partialPark.crowdReporting?.enabled ?? true,
      reportCountLastHour: Number(partialPark.crowdReporting?.reportCountLastHour || 0),
      lastReportedAt: partialPark.crowdReporting?.lastReportedAt || null,
      latestWindowKey: partialPark.crowdReporting?.latestWindowKey || getReportWindowKey(now)
    },
    safetyNotes: partialPark.safetyNotes || "",
    amenitiesNotes: partialPark.amenitiesNotes || "",
    // Sprint 3 fields
    // equipment: array of equipment document IDs belonging to this park
    equipment: Array.isArray(partialPark.equipment) ? partialPark.equipment : [],
    // reviewAggregate: maintained by updateReviewAggregate() after each new review submission
    reviewAggregate: {
      averageRating: partialPark.reviewAggregate?.averageRating ?? null,
      reviewCount: Number(partialPark.reviewAggregate?.reviewCount || 0)
    },
    // crowdHistory: array of crowd-level report summaries for the last 7 days (populated by getCrowdHistory)
    crowdHistory: Array.isArray(partialPark.crowdHistory) ? partialPark.crowdHistory : [],
    // photos: array of Firebase Storage download URLs uploaded by authenticated users
    photos: Array.isArray(partialPark.photos) ? partialPark.photos : [],
    // location should include { address, lat, lng } for map view marker rendering
    createdAt: partialPark.createdAt || now,
    updatedAt: partialPark.updatedAt || now
  };
}

export {
  MAINTENANCE_STATUS,
  ALLOWED_MAINTENANCE_STATUS,
  isValidMaintenanceStatus,
  createParkModel
};
