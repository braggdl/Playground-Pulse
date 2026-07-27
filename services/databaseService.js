/*
  Database Service
  Purpose: Handle create, read, update, and delete operations with Firestore.
  Add real Firestore SDK logic inside these placeholder functions.
*/

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";
import { canPerformAction } from "../constants/authConstants.js";
import { createParkModel } from "../models/parkModel.js";
import { createEquipmentModel, isValidEquipmentStatus } from "../models/equipmentModel.js";
import { createSafetyReportModel, isValidReportType } from "../models/safetyReportModel.js";
import { createAuditLogModel, isValidAuditEventType } from "../models/auditLogModel.js";
import { NOTIFICATION_EVENT_TYPES, notifyUser } from "./notificationService.js";
import {
  BUSY_LEVEL_WEIGHTING_POLICY,
  CROWD_REPORT_POLICY,
  EQUIPMENT_STATUSES,
  SAFETY_REPORT_STATUSES,
  canTransition,
  getBusyLevelLabel,
  getBusyLevelScoreFromCrowdLevel,
  getReportWindowKey,
  getReportWindowStart,
  normalizeCrowdLevel
} from "../constants/reportConstants.js";
import {
  PARK_SEARCH_DEFAULTS,
  normalizeParkSearchPageSize
} from "../constants/searchConstants.js";

function getDatabaseService() {
  initializeFirebaseServices();
  const { db } = getFirebaseServices();

  if (!db) {
    throw new Error("Database service failed to initialize.");
  }

  return db;
}

function createServiceError(error, fallbackMessage) {
  const errorCode = String(error?.code || "").toLowerCase();
  const errorMessage = String(error?.message || "").toLowerCase();

  if (errorCode.includes("permission-denied")) {
    return new Error("You do not have permission to complete this request.");
  }

  if (errorCode.includes("unavailable") || errorCode.includes("deadline-exceeded") || errorCode.includes("network") || errorMessage.includes("network")) {
    return new Error("Unable to reach the database right now. Please check your connection and try again.");
  }

  if (errorCode.includes("failed-precondition") || errorMessage.includes("requires an index")) {
    return new Error("This query requires additional database indexes. Please contact an administrator to complete index setup.");
  }

  return new Error(error?.message || fallbackMessage);
}

function buildTrailingDateKeys(days) {
  const totalDays = Math.max(1, Math.floor(Number(days) || 1));
  const dateKeys = [];
  const now = new Date();

  for (let index = totalDays - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    dateKeys.push(date.toISOString().slice(0, 10));
  }

  return dateKeys;
}

function getCrowdReportsCollection(db) {
  return collection(db, CROWD_REPORT_POLICY.collectionName);
}

function mapParkSnapshot(snapshot) {
  return snapshot.docs.map((parkDocument) => ({ id: parkDocument.id, ...parkDocument.data() }));
}

function applyParkSearchPageLimit(parks, options = {}) {
  const pageSize = normalizeParkSearchPageSize(options.pageSize);
  return parks.slice(0, pageSize);
}

function normalizeSearchPrefix(searchTerm = "") {
  return String(searchTerm || "").trim();
}

function getSearchCursorByField(startAfterCursor, field) {
  if (!startAfterCursor || typeof startAfterCursor !== "object") {
    return null;
  }

  return startAfterCursor[field] || null;
}

function dedupeParks(parks = []) {
  const byId = new Map();
  parks.forEach((park) => {
    if (park?.id && !byId.has(park.id)) {
      byId.set(park.id, park);
    }
  });

  return Array.from(byId.values());
}

function sortParksByName(parks = []) {
  return parks.slice().sort((left, right) => {
    const leftName = (left.name || "").toLowerCase();
    const rightName = (right.name || "").toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

async function queryParksByPrefixField(field, searchPrefix, options = {}) {
  const db = getDatabaseService();
  const collectionRef = collection(db, "parks");
  const pageSize = normalizeParkSearchPageSize(options.pageSize);
  const queryConstraints = [
    where(field, ">=", searchPrefix),
    where(field, "<=", `${searchPrefix}\uf8ff`),
    orderBy(field),
    limit(pageSize)
  ];

  const startAfterDoc = getSearchCursorByField(options.startAfter, field);
  if (startAfterDoc) {
    queryConstraints.push(startAfter(startAfterDoc));
  }

  const snapshot = await getDocs(query(collectionRef, ...queryConstraints));

  return {
    parks: snapshot.docs.map((parkDocument) => ({ id: parkDocument.id, ...parkDocument.data() })),
    lastDocument: snapshot.docs[snapshot.docs.length - 1] || startAfterDoc || null,
    hasMore: snapshot.docs.length === pageSize
  };
}

async function queryParksBySearchTerm(searchTerm, options = {}) {
  const normalizedPrefix = normalizeSearchPrefix(searchTerm);
  if (!normalizedPrefix) {
    return {
      results: [],
      lastDocument: null,
      pageSize: normalizeParkSearchPageSize(options.pageSize),
      hasMore: false
    };
  }

  const [nameQuery, locationQuery] = await Promise.all([
    queryParksByPrefixField("name", normalizedPrefix, options),
    queryParksByPrefixField("location", normalizedPrefix, options)
  ]);

  const mergedResults = sortParksByName(dedupeParks([...nameQuery.parks, ...locationQuery.parks]));
  const pagedResults = applyParkSearchPageLimit(mergedResults, options);
  const enrichedResults = await enrichParksWithRecentCrowdState(pagedResults);

  return {
    results: enrichedResults,
    lastDocument: {
      name: nameQuery.lastDocument,
      location: locationQuery.lastDocument
    },
    pageSize: normalizeParkSearchPageSize(options.pageSize),
    hasMore: nameQuery.hasMore || locationQuery.hasMore
  };
}

async function queryParksWithClientFiltering(searchTerm, filterCriteria = {}, options = {}) {
  const db = getDatabaseService();
  const collectionRef = collection(db, "parks");
  const pageSize = normalizeParkSearchPageSize(options.pageSize);
  const batchSize = Math.max(pageSize, PARK_SEARCH_DEFAULTS.pageSize);
  const predicate = buildParkSearchFilterPredicate(searchTerm, filterCriteria);

  let cursor = options.startAfter || null;
  let results = [];
  let reachedRequestedPage = false;
  let hasMore = false;

  while (!reachedRequestedPage) {
    const queryConstraints = [orderBy("name"), limit(batchSize)];

    if (cursor) {
      queryConstraints.push(startAfter(cursor));
    }

    const snapshot = await getDocs(query(collectionRef, ...queryConstraints));
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    for (const parkDocument of snapshot.docs) {
      cursor = parkDocument;
      const park = { id: parkDocument.id, ...parkDocument.data() };

      if (predicate(park)) {
        results.push(park);
      }

      if (results.length === pageSize) {
        reachedRequestedPage = true;
        hasMore = true;
        break;
      }
    }

    if (reachedRequestedPage) {
      break;
    }

    if (snapshot.docs.length < batchSize) {
      hasMore = false;
      break;
    }
  }

  const pagedResults = applyParkSearchPageLimit(results, options);
  const enrichedResults = await enrichParksWithRecentCrowdState(pagedResults);

  return {
    results: enrichedResults,
    lastDocument: cursor,
    pageSize,
    hasMore
  };
}

function buildParkSearchFilterPredicate(searchTerm, filterCriteria = {}) {
  const normalizedSearch = (searchTerm || "").trim().toLowerCase();

  return (park) => {
    if (normalizedSearch) {
      const name = (park.name || "").toLowerCase();
      const location = (park.location || "").toLowerCase();
      if (!name.includes(normalizedSearch) && !location.includes(normalizedSearch)) {
        return false;
      }
    }

    if (filterCriteria.ageGroups && filterCriteria.ageGroups.length > 0) {
      const matchesAge = filterCriteria.ageGroups.some(
        (group) => park.ageGroups?.[group] === true
      );
      if (!matchesAge) {
        return false;
      }
    }

    if (filterCriteria.fencedArea !== undefined && filterCriteria.fencedArea !== null) {
      if (park.fencedArea !== filterCriteria.fencedArea) return false;
    }

    if (filterCriteria.restrooms !== undefined && filterCriteria.restrooms !== null) {
      if (park.restrooms !== filterCriteria.restrooms) return false;
    }

    if (filterCriteria.shadeAvailable !== undefined && filterCriteria.shadeAvailable !== null) {
      if (park.shadeAvailable !== filterCriteria.shadeAvailable) return false;
    }

    if (filterCriteria.maintenanceStatus) {
      if (park.maintenanceStatus !== filterCriteria.maintenanceStatus) return false;
    }

    return true;
  };
}

async function createRecord(collectionName, recordData) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, collectionName);
    const recordRef = await addDoc(collectionRef, recordData);

    return { id: recordRef.id, ...recordData };
  } catch (error) {
    throw createServiceError(error, "Create record failed.");
  }
}

/**
 * Create or overwrite a user profile with a deterministic document ID.
 * This aligns with common Firestore rules that scope writes to request.auth.uid.
 */
async function createUserRecord(userId, userData) {
  try {
    const db = getDatabaseService();
    const userRef = doc(db, "users", userId);
    await setDoc(userRef, userData);

    return { id: userId, ...userData };
  } catch (error) {
    throw createServiceError(error, "Create user record failed.");
  }
}

async function readRecords(collectionName, filters = {}) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, collectionName);
    const filterEntries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null);

    let recordsQuery = collectionRef;

    if (filterEntries.length > 0) {
      const queryConstraints = filterEntries.map(([field, value]) => where(field, "==", value));
      recordsQuery = query(collectionRef, ...queryConstraints);
    }

    const snapshot = await getDocs(recordsQuery);
    return snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
  } catch (error) {
    throw createServiceError(error, "Read records failed.");
  }
}

async function updateRecord(collectionName, recordId, updatedData) {
  try {
    const db = getDatabaseService();
    const recordRef = doc(db, collectionName, recordId);
    await updateDoc(recordRef, updatedData);

    return { id: recordId, ...updatedData };
  } catch (error) {
    throw createServiceError(error, "Update record failed.");
  }
}

async function deleteRecord(collectionName, recordId) {
  try {
    const db = getDatabaseService();
    const recordRef = doc(db, collectionName, recordId);
    await deleteDoc(recordRef);

    return true;
  } catch (error) {
    throw createServiceError(error, "Delete record failed.");
  }
}

/**
 * Phase 3: Search for parks by text query
 * Performs a partial match search on name and location fields
 */
async function searchParks(searchTerm, options = {}) {
  try {
    return queryParksWithClientFiltering(searchTerm, {}, options);
  } catch (error) {
    throw createServiceError(error, "Search parks failed.");
  }
}

/**
 * Phase 3: Filter parks by multiple criteria
 * Supports age groups, amenities, and maintenance status filters
 */
async function filterParks(filterCriteria, options = {}) {
  try {
    return queryParksWithClientFiltering(undefined, filterCriteria, options);
  } catch (error) {
    throw createServiceError(error, "Filter parks failed.");
  }
}

/**
 * Phase 3: Combined search and filter
 * Performs text search AND applies additional filters
 */
async function searchAndFilterParks(searchTerm, filterCriteria, options = {}) {
  try {
    return queryParksWithClientFiltering(searchTerm, filterCriteria, options);
  } catch (error) {
    throw createServiceError(error, "Search and filter parks failed.");
  }
}

/**
 * Phase 3: Get a single park by ID
 */
async function getParkById(parkId) {
  try {
    const db = getDatabaseService();
    const parkRef = doc(db, "parks", parkId);
    const parkSnapshot = await getDoc(parkRef);

    if (!parkSnapshot.exists()) {
      throw new Error(`Park with ID ${parkId} not found`);
    }

    return { id: parkSnapshot.id, ...parkSnapshot.data() };
  } catch (error) {
    throw createServiceError(error, "Get park by ID failed.");
  }
}

async function queryParksPage(options = {}) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const pageSize = normalizeParkSearchPageSize(options.pageSize);
    const queryConstraints = [orderBy("name"), limit(pageSize)];

    if (options.startAfter) {
      queryConstraints.push(startAfter(options.startAfter));
    }

    const parksQuery = query(collectionRef, ...queryConstraints);
    const snapshot = await getDocs(parksQuery);

    return {
      results: mapParkSnapshot(snapshot),
      lastDocument: snapshot.docs[snapshot.docs.length - 1] || null,
      pageSize,
      hasMore: snapshot.docs.length === pageSize
    };
  } catch (error) {
    throw createServiceError(error, "Query parks page failed.");
  }
}

async function getRecentCrowdReportsForPark(parkId, minutes = CROWD_REPORT_POLICY.windowMinutes) {
  try {
    const db = getDatabaseService();
    const collectionRef = getCrowdReportsCollection(db);
    const windowStart = new Date(Date.now() - (minutes * 60 * 1000)).toISOString();
    const reportsQuery = query(
      collectionRef,
      where("parkId", "==", parkId)
    );
    const snapshot = await getDocs(reportsQuery);

    return snapshot.docs
      .map((reportDocument) => ({ id: reportDocument.id, ...reportDocument.data() }))
      .filter((report) => (report.reportedAt || "") >= windowStart)
      .sort((a, b) => (b.reportedAt || "").localeCompare(a.reportedAt || ""));
  } catch (error) {
    throw createServiceError(error, "Get recent crowd reports failed.");
  }
}

function getMinutesSinceReport(reportedAt, nowMs = Date.now()) {
  const reportedMs = Date.parse(reportedAt || "");

  if (!Number.isFinite(reportedMs)) {
    return 0;
  }

  const diffMinutes = (nowMs - reportedMs) / (60 * 1000);
  if (!Number.isFinite(diffMinutes)) {
    return 0;
  }

  return Math.max(0, diffMinutes);
}

function getRecencyWeight(minutesSinceReport) {
  const clampedMinutes = Math.min(minutesSinceReport, CROWD_REPORT_POLICY.windowMinutes);
  const recencyRatio = 1 - (clampedMinutes / CROWD_REPORT_POLICY.windowMinutes);
  return Math.max(BUSY_LEVEL_WEIGHTING_POLICY.minRecencyWeight, recencyRatio);
}

function calculateBusyLevelFromReports(reports = []) {
  if (!reports.length) {
    return {
      score: null,
      label: getBusyLevelLabel(null),
      reportCount: 0
    };
  }

  const nowMs = Date.now();
  const weightedScores = reports
    .map((report) => {
      const score = getBusyLevelScoreFromCrowdLevel(report.crowdLevel);
      if (!Number.isFinite(score)) {
        return null;
      }

      const minutesSinceReport = getMinutesSinceReport(report.reportedAt, nowMs);
      const weight = getRecencyWeight(minutesSinceReport);
      return { score, weight };
    })
    .filter((entry) => entry !== null);

  if (!weightedScores.length) {
    return {
      score: null,
      label: getBusyLevelLabel(null),
      reportCount: 0
    };
  }

  const weightedScoreTotal = weightedScores.reduce((sum, entry) => sum + (entry.score * entry.weight), 0);
  const totalWeight = weightedScores.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedAverageScore = totalWeight > 0
    ? Math.round(weightedScoreTotal / totalWeight)
    : null;

  return {
    score: weightedAverageScore,
    label: getBusyLevelLabel(weightedAverageScore),
    reportCount: weightedScores.length
  };
}

async function enrichParksWithRecentCrowdState(parks = []) {
  if (!Array.isArray(parks) || parks.length === 0) {
    return [];
  }

  const parksWithCrowdState = await Promise.all(parks.map(async (park) => {
    const reports = await getRecentCrowdReportsForPark(park.id);
    const busyLevel = calculateBusyLevelFromReports(reports);
    const latestReport = reports[0] || null;
    const fallbackBusyLevel = park.busyLevel || {};
    const fallbackCrowdReporting = park.crowdReporting || {};

    return {
      ...park,
      busyLevel: {
        score: busyLevel.score ?? fallbackBusyLevel.score ?? null,
        label: busyLevel.score !== null ? busyLevel.label : (fallbackBusyLevel.label || "Unknown"),
        updatedAt: latestReport?.reportedAt || fallbackBusyLevel.updatedAt || null
      },
      crowdReporting: {
        enabled: true,
        reportCountLastHour: reports.length ? busyLevel.reportCount : Number(fallbackCrowdReporting.reportCountLastHour || 0),
        lastReportedAt: latestReport?.reportedAt || fallbackCrowdReporting.lastReportedAt || null,
        latestWindowKey: latestReport?.windowKey || fallbackCrowdReporting.latestWindowKey || null
      }
    };
  }));

  return parksWithCrowdState;
}

async function submitCrowdReport(parkId, userId, crowdLevel, reportedAt = new Date().toISOString()) {
  try {
    const normalizedCrowdLevel = normalizeCrowdLevel(crowdLevel);

    if (!parkId || !userId) {
      throw new Error("Park ID and user ID are required.");
    }

    if (normalizedCrowdLevel === null) {
      throw new Error("Crowd level must be between 1 and 4.");
    }

    const db = getDatabaseService();
    const collectionRef = getCrowdReportsCollection(db);
    const windowKey = getReportWindowKey(reportedAt);
    const duplicateQuery = query(
      collectionRef,
      where("parkId", "==", parkId),
      where("userId", "==", userId),
      where("windowKey", "==", windowKey),
      limit(CROWD_REPORT_POLICY.reportsPerWindow)
    );
    const duplicateSnapshot = await getDocs(duplicateQuery);

    if (!duplicateSnapshot.empty) {
      return {
        success: false,
        isDuplicate: true,
        message: "You have already submitted a crowd report for this park during the current one-hour window."
      };
    }

    const reportRecord = {
      parkId,
      userId,
      crowdLevel: normalizedCrowdLevel,
      busyLevelScore: getBusyLevelScoreFromCrowdLevel(normalizedCrowdLevel),
      reportedAt,
      reportWindowStartedAt: getReportWindowStart(reportedAt).toISOString(),
      windowKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const recordRef = await addDoc(collectionRef, reportRecord);

    return {
      success: true,
      isDuplicate: false,
      message: "Crowd report submitted successfully.",
      report: { id: recordRef.id, ...reportRecord }
    };
  } catch (error) {
    throw createServiceError(error, "Submit crowd report failed.");
  }
}

async function createSafetyReport(parkId, userId, reportData = {}) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  const description = String(reportData.description || "").trim();
  if (!description) {
    throw new Error("Report description is required.");
  }

  const type = reportData.type || "hazard";
  if (!isValidReportType(type)) {
    throw new Error("Report type must be hazard, injury, concern, safety, or maintenance.");
  }

  const model = createSafetyReportModel({
    parkId,
    userId,
    type,
    description,
    status: SAFETY_REPORT_STATUSES.OPEN,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const { id, ...payload } = model;
  return createRecord("safetyReports", payload);
}

async function getSafetyReports(parkId, filters = {}) {
  try {
    const db = getDatabaseService();
    const safetyReportsRef = collection(db, "safetyReports");
    const queryConstraints = [];

    if (parkId) {
      queryConstraints.push(where("parkId", "==", parkId));
    }

    if (filters.status) {
      queryConstraints.push(where("status", "==", filters.status));
    }

    if (filters.type) {
      queryConstraints.push(where("type", "==", filters.type));
    }

    const snapshot = queryConstraints.length > 0
      ? await getDocs(query(safetyReportsRef, ...queryConstraints))
      : await getDocs(safetyReportsRef);

    const reports = snapshot.docs
      .map((reportDoc) => ({ id: reportDoc.id, ...reportDoc.data() }))
      .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));

    return reports;
  } catch (error) {
    throw createServiceError(error, "Get safety reports failed.");
  }
}

async function updateSafetyReportStatus(reportId, newStatus, userId, role) {
  if (!reportId) {
    throw new Error("Report ID is required.");
  }

  if (!newStatus) {
    throw new Error("New status is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  try {
    const db = getDatabaseService();
    const reportRef = doc(db, "safetyReports", reportId);
    const reportSnapshot = await getDoc(reportRef);

    if (!reportSnapshot.exists()) {
      throw new Error("Safety report not found.");
    }

    const report = { id: reportSnapshot.id, ...reportSnapshot.data() };
    let parkName = "Unknown park";

    if (report.parkId) {
      try {
        const parkSnapshot = await getDoc(doc(db, "parks", report.parkId));
        if (parkSnapshot.exists()) {
          parkName = parkSnapshot.data().name || parkName;
        }
      } catch (error) {
        // Keep status transitions non-blocking if park lookups fail.
      }
    }

    if (!canTransition(report.status, newStatus, role)) {
      throw new Error("You are not allowed to perform this status transition.");
    }

    const updatedAt = new Date().toISOString();
    const payload = {
      status: newStatus,
      updatedAt,
      lastUpdatedBy: userId
    };

    await updateDoc(reportRef, payload);

    await logAuditEvent({
      eventType: "safety_status_changed",
      actorId: userId,
      targetId: reportId,
      parkId: report.parkId,
      metadata: {
        fromStatus: report.status,
        toStatus: newStatus,
        type: report.type
      }
    });

    let notificationWarning = null;
    try {
      await notifyUser(report.userId, NOTIFICATION_EVENT_TYPES.SAFETY_REPORT_STATUS_CHANGED, {
        reportId,
        parkId: report.parkId,
        parkName,
        fromStatus: report.status,
        toStatus: newStatus,
        type: report.type,
        description: report.description || ""
      });
    } catch (error) {
      notificationWarning = error?.message || "Notification delivery failed.";
    }

    return {
      ...report,
      ...payload,
      notificationWarning
    };
  } catch (error) {
    throw createServiceError(error, "Update safety report status failed.");
  }
}

async function deleteSafetyReport(reportId, userId, role) {
  if (!reportId) {
    throw new Error("Report ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!canPerformAction(role, "safetyReportDelete")) {
    throw new Error("You are not authorized to delete safety reports.");
  }

  try {
    const db = getDatabaseService();
    const reportRef = doc(db, "safetyReports", reportId);
    const reportSnapshot = await getDoc(reportRef);

    if (!reportSnapshot.exists()) {
      throw new Error("Safety report not found.");
    }

    const report = { id: reportSnapshot.id, ...reportSnapshot.data() };
    await deleteDoc(reportRef);

    await logAuditEvent({
      eventType: "safety_report_deleted",
      actorId: userId,
      targetId: reportId,
      parkId: report.parkId,
      metadata: {
        type: report.type || "unknown",
        previousStatus: report.status || "unknown"
      }
    });

    return true;
  } catch (error) {
    throw createServiceError(error, "Delete safety report failed.");
  }
}

async function getEquipment(parkId) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  try {
    const db = getDatabaseService();
    const equipmentRef = collection(db, "equipment");
    const equipmentQuery = query(equipmentRef, where("parkId", "==", parkId));
    const snapshot = await getDocs(equipmentQuery);

    return snapshot.docs
      .map((equipmentDoc) => ({ id: equipmentDoc.id, ...equipmentDoc.data() }))
      .sort((left, right) => (left.name || "").localeCompare(right.name || ""));
  } catch (error) {
    throw createServiceError(error, "Get equipment failed.");
  }
}

async function createEquipment(parkId, equipmentData = {}) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  const name = String(equipmentData.name || "").trim();
  if (!name) {
    throw new Error("Equipment name is required.");
  }

  const model = createEquipmentModel({
    ...equipmentData,
    parkId,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const { id, ...payload } = model;
  return createRecord("equipment", payload);
}

async function updateEquipmentStatus(equipmentId, newStatus, userId, role) {
  if (!equipmentId) {
    throw new Error("Equipment ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!canPerformAction(role, "equipmentStatusChange")) {
    throw new Error("You are not authorized to update equipment status.");
  }

  if (!isValidEquipmentStatus(newStatus)) {
    throw new Error("Invalid equipment status.");
  }

  try {
    const db = getDatabaseService();
    const equipmentRef = doc(db, "equipment", equipmentId);
    const equipmentSnapshot = await getDoc(equipmentRef);

    if (!equipmentSnapshot.exists()) {
      throw new Error("Equipment item not found.");
    }

    const equipment = { id: equipmentSnapshot.id, ...equipmentSnapshot.data() };
    const payload = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
      lastUpdatedBy: userId
    };

    await updateDoc(equipmentRef, payload);

    await logAuditEvent({
      eventType: "equipment_status_changed",
      actorId: userId,
      targetId: equipmentId,
      parkId: equipment.parkId,
      metadata: {
        fromStatus: equipment.status,
        toStatus: newStatus,
        name: equipment.name
      }
    });

    return {
      ...equipment,
      ...payload
    };
  } catch (error) {
    throw createServiceError(error, "Update equipment status failed.");
  }
}

async function deleteEquipment(equipmentId, userId, role) {
  if (!equipmentId) {
    throw new Error("Equipment ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!canPerformAction(role, "equipmentDelete")) {
    throw new Error("You are not authorized to delete equipment.");
  }

  try {
    const db = getDatabaseService();
    const equipmentRef = doc(db, "equipment", equipmentId);
    const equipmentSnapshot = await getDoc(equipmentRef);

    if (!equipmentSnapshot.exists()) {
      throw new Error("Equipment item not found.");
    }

    const equipment = { id: equipmentSnapshot.id, ...equipmentSnapshot.data() };
    await deleteDoc(equipmentRef);

    await logAuditEvent({
      eventType: "equipment_deleted",
      actorId: userId,
      targetId: equipmentId,
      parkId: equipment.parkId,
      metadata: {
        name: equipment.name || "",
        previousStatus: equipment.status || "unknown",
        type: equipment.type || "unknown"
      }
    });

    return true;
  } catch (error) {
    throw createServiceError(error, "Delete equipment failed.");
  }
}

async function getUserNotifications(userId, options = {}) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  try {
    const db = getDatabaseService();
    const notificationsRef = collection(db, "notifications");
    const snapshot = await getDocs(query(notificationsRef, where("userId", "==", userId)));

    const includeRead = options.includeRead !== false;
    const limitCount = Math.max(1, Number(options.limitCount || 50));

    const notifications = snapshot.docs
      .map((notificationDoc) => ({ id: notificationDoc.id, ...notificationDoc.data() }))
      .filter((notification) => (includeRead ? true : !notification.read))
      .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""))
      .slice(0, limitCount);

    return notifications;
  } catch (error) {
    throw createServiceError(error, "Get notifications failed.");
  }
}

async function markNotificationRead(notificationId) {
  if (!notificationId) {
    throw new Error("Notification ID is required.");
  }

  try {
    const db = getDatabaseService();
    const notificationRef = doc(db, "notifications", notificationId);
    await updateDoc(notificationRef, {
      read: true,
      readAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return true;
  } catch (error) {
    throw createServiceError(error, "Mark notification as read failed.");
  }
}

async function getCrowdHistory(parkId, days = 7) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  const totalDays = Math.max(1, Math.floor(Number(days) || 7));
  const trailingDateKeys = buildTrailingDateKeys(totalDays);
  const earliestDateKey = trailingDateKeys[0];

  try {
    const db = getDatabaseService();
    const crowdReportsRef = getCrowdReportsCollection(db);
    const snapshot = await getDocs(query(crowdReportsRef, where("parkId", "==", parkId)));

    const reports = snapshot.docs
      .map((reportDoc) => ({ id: reportDoc.id, ...reportDoc.data() }))
      .filter((report) => String(report.reportedAt || "").slice(0, 10) >= earliestDateKey);

    const grouped = new Map();
    reports.forEach((report) => {
      const dateKey = String(report.reportedAt || "").slice(0, 10);
      if (!dateKey) {
        return;
      }

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }

      grouped.get(dateKey).push(report);
    });

    return trailingDateKeys.map((dateKey) => {
      const dayReports = grouped.get(dateKey) || [];
      const dayScores = dayReports
        .map((report) => {
          if (Number.isFinite(report.busyLevelScore)) {
            return report.busyLevelScore;
          }

          return getBusyLevelScoreFromCrowdLevel(report.crowdLevel);
        })
        .filter((score) => Number.isFinite(score));

      const averageScore = dayScores.length > 0
        ? Math.round(dayScores.reduce((sum, score) => sum + score, 0) / dayScores.length)
        : null;

      return {
        date: dateKey,
        reportCount: dayReports.length,
        averageScore,
        label: getBusyLevelLabel(averageScore)
      };
    });
  } catch (error) {
    throw createServiceError(error, "Get crowd history failed.");
  }
}

/**
 * Phase 4: Create a park record with Sprint 1 field defaults.
 */
async function createParkRecord(parkData) {
  const now = new Date().toISOString();
  const normalizedPark = createParkModel({
    ...parkData,
    createdAt: parkData.createdAt || now,
    updatedAt: now
  });

  const { id, ...recordData } = normalizedPark;
  return createRecord("parks", recordData);
}

/**
 * Phase 4: Edit a park record and stamp updatedAt.
 */
async function editParkRecord(parkId, updatedData) {
  const { id, ...safeUpdatedData } = updatedData;
  const payload = {
    ...safeUpdatedData,
    updatedAt: new Date().toISOString()
  };

  await updateRecord("parks", parkId, payload);
  return getParkById(parkId);
}

/**
 * Sprint 3 Phase 1: Write an audit log entry to the auditLog collection.
 * All administrative actions (safety report transitions, equipment status changes,
 * admin assignments, moderation actions) must call this method.
 *
 * logAuditEvent(event) → Promise<{ id: string }>
 *   Input:  event object with { eventType, actorId, targetId, parkId?, metadata?, timestamp? }
 *   Output: object with the Firestore document ID of the created audit log entry
 *   Errors:
 *     Throws Error("eventType is required.")  if eventType is falsy
 *     Throws Error("actorId is required.")    if actorId is falsy
 *     Throws Error("targetId is required.")   if targetId is falsy
 *     Throws Error with Firestore error message on write failure
 *
 * NOTE: Reads of the auditLog collection must always use filtered queries
 * (by park, actor, or eventType). Full-collection reads are not supported.
 */
async function logAuditEvent(event = {}) {
  if (!event.eventType) {
    throw new Error("eventType is required.");
  }

  if (!event.actorId) {
    throw new Error("actorId is required.");
  }

  if (!event.targetId) {
    throw new Error("targetId is required.");
  }

  if (!isValidAuditEventType(event.eventType)) {
    throw new Error("eventType is invalid.");
  }

  try {
    const db = getDatabaseService();
    const auditLogRef = collection(db, "auditLog");
    const auditEntry = createAuditLogModel({
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    });

    const { id, ...entryData } = auditEntry;
    const docRef = await addDoc(auditLogRef, entryData);
    return { id: docRef.id };
  } catch (error) {
    throw createServiceError(error, "Log audit event failed.");
  }
}

export {
  createRecord,
  createUserRecord,
  readRecords,
  updateRecord,
  deleteRecord,
  searchParks,
  filterParks,
  searchAndFilterParks,
  getParkById,
  createParkRecord,
  editParkRecord,
  queryParksPage,
  getRecentCrowdReportsForPark,
  calculateBusyLevelFromReports,
  submitCrowdReport,
  logAuditEvent,
  createSafetyReport,
  getSafetyReports,
  updateSafetyReportStatus,
  deleteSafetyReport,
  getEquipment,
  createEquipment,
  updateEquipmentStatus,
  deleteEquipment,
  getUserNotifications,
  markNotificationRead,
  getCrowdHistory
};