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
import {
  AUDIT_EVENT_TYPES,
  createAuditLogModel,
  isValidAuditEventType
} from "../models/auditLogModel.js";
import { USER_ROLES } from "../models/userModel.js";
import { createEquipmentModel, isValidEquipmentStatus } from "../models/equipmentModel.js";
import { createSafetyReportModel, isValidReportType } from "../models/safetyReportModel.js";
import { createReviewModel } from "../models/reviewModel.js";
import { NOTIFICATION_EVENT_TYPES, notifyUser } from "./notificationService.js";
import { uploadParkPhoto, validatePhoto } from "./storageService.js";
import { moderateUserAccount, setUserRoleAndParks } from "./adminInvitationService.js";
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

  if (errorCode.includes("permission-denied") || errorCode.includes("storage/unauthorized")) {
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

function buildCenteredDateKeys(days) {
  const totalDays = Math.max(1, Math.floor(Number(days) || 1));
  const dateKeys = [];
  const now = new Date();
  // Use UTC components so the generated date keys match reportedAt UTC date extraction.
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDay = now.getUTCDate();

  const backwardDays = Math.floor(totalDays / 2);
  const forwardDays = totalDays - backwardDays - 1;

  for (let offset = -backwardDays; offset <= forwardDays; offset += 1) {
    const d = new Date(Date.UTC(utcYear, utcMonth, utcDay + offset));
    dateKeys.push(d.toISOString().slice(0, 10));
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

async function getUserRecordByUid(db, uid) {
  if (!uid) {
    return null;
  }

  const directRef = doc(db, "users", uid);
  const directSnapshot = await getDoc(directRef);

  if (directSnapshot.exists()) {
    return {
      id: directSnapshot.id,
      ref: directRef,
      data: directSnapshot.data()
    };
  }

  const usersQuery = query(collection(db, "users"), where("uid", "==", uid), limit(1));
  const usersSnapshot = await getDocs(usersQuery);

  if (usersSnapshot.empty) {
    return null;
  }

  const foundDoc = usersSnapshot.docs[0];
  return {
    id: foundDoc.id,
    ref: doc(db, "users", foundDoc.id),
    data: foundDoc.data()
  };
}

/**
 * Resolve the caller's role from the Auth token custom claim, falling back to the
 * Firestore profile field only when no claim is present.
 *
 * Security rules authorize against `request.auth.token.role`. Checking the same
 * source here keeps the client-side gate and the server-side gate in agreement;
 * reading only the (client-writable) profile field would let a user with a stale
 * or unsynced claim pass this check and then be denied by the rules.
 */
async function resolveActorRole(actor) {
  try {
    const { auth } = getFirebaseServices();
    const currentUser = auth?.currentUser;

    if (currentUser) {
      const tokenResult = await currentUser.getIdTokenResult();
      if (tokenResult?.claims?.role) {
        return tokenResult.claims.role;
      }
    }
  } catch (error) {
    console.warn("Unable to read role claim; falling back to profile role:", error);
  }

  return actor.data?.role;
}

async function assertAuthorizedUserForAction(db, userId, action) {
  const actor = await getUserRecordByUid(db, userId);

  if (!actor) {
    throw new Error("Actor user record not found.");
  }

  const role = await resolveActorRole(actor);
  if (!canPerformAction(role, action)) {
    throw new Error("You do not have permission to complete this request.");
  }

  return actor;
}

function normalizeModerationAction(action) {
  if (action === "hide" || action === "disable") {
    return "hide";
  }

  if (action === "reinstate") {
    return "reinstate";
  }

  return null;
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

    // Filter, sort, and cap server-side. `reportedAt` is an ISO-8601 string, so
    // lexicographic ordering matches chronological ordering and the range filter
    // is safe. Without the range filter this query returned every report a park
    // had ever received and discarded most of them client-side.
    // Requires the composite index (parkId ASC, reportedAt DESC) in firestore.indexes.json.
    const reportsQuery = query(
      collectionRef,
      where("parkId", "==", parkId),
      where("reportedAt", ">=", windowStart),
      orderBy("reportedAt", "desc"),
      limit(CROWD_REPORT_POLICY.maxReportsPerBusyLevelQuery)
    );
    const snapshot = await getDocs(reportsQuery);

    return snapshot.docs.map((reportDocument) => ({
      id: reportDocument.id,
      ...reportDocument.data()
    }));
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

    // Treat persisted busyLevel data as stale if it is older than the calculation window.
    const staleThresholdMs = CROWD_REPORT_POLICY.windowMinutes * 60 * 1000;
    const fallbackUpdatedMs = fallbackBusyLevel.updatedAt
      ? new Date(fallbackBusyLevel.updatedAt).getTime()
      : 0;
    const fallbackIsStale = (Date.now() - fallbackUpdatedMs) > staleThresholdMs;

    return {
      ...park,
      busyLevel: {
        score: busyLevel.score ?? (fallbackIsStale ? null : (fallbackBusyLevel.score ?? null)),
        label: busyLevel.score !== null
          ? busyLevel.label
          : (fallbackIsStale ? "Unknown" : (fallbackBusyLevel.label || "Unknown")),
        updatedAt: latestReport?.reportedAt || (fallbackIsStale ? null : (fallbackBusyLevel.updatedAt || null))
      },
      crowdReporting: {
        enabled: true,
        reportCountLastHour: reports.length ? busyLevel.reportCount : (fallbackIsStale ? 0 : Number(fallbackCrowdReporting.reportCountLastHour || 0)),
        lastReportedAt: latestReport?.reportedAt || (fallbackIsStale ? null : (fallbackCrowdReporting.lastReportedAt || null)),
        latestWindowKey: latestReport?.windowKey || (fallbackIsStale ? null : (fallbackCrowdReporting.latestWindowKey || null))
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
    const includeRead = options.includeRead !== false;
    const limitCount = Math.max(1, Number(options.limitCount || 50));
    const constraints = [where("userId", "==", userId)];

    if (!includeRead) {
      constraints.push(where("read", "==", false));
    }

    // Avoid composite index requirement; results are sorted client-side in normalizeNotificationList.
    constraints.push(limit(limitCount));

    const snapshot = await getDocs(query(notificationsRef, ...constraints));
    return snapshot.docs.map((notificationDoc) => ({ id: notificationDoc.id, ...notificationDoc.data() }));
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
  const centeredDateKeys = buildCenteredDateKeys(totalDays);
  const earliestDateKey = centeredDateKeys[0];
  const latestDateKey = centeredDateKeys[centeredDateKeys.length - 1];

  try {
    const db = getDatabaseService();
    const crowdReportsRef = getCrowdReportsCollection(db);
    const earliestISO = `${earliestDateKey}T00:00:00.000Z`;
    const latestISO = `${latestDateKey}T23:59:59.999Z`;
    // Bound the date range server-side using the same (parkId ASC, reportedAt DESC)
    // composite index used by getRecentCrowdReportsForPark. `reportedAt` is ISO-8601,
    // so lexicographic range comparison matches chronological order.
    const snapshot = await getDocs(query(
      crowdReportsRef,
      where("parkId", "==", parkId),
      where("reportedAt", ">=", earliestISO),
      where("reportedAt", "<=", latestISO),
      orderBy("reportedAt", "desc")
    ));

    const reports = snapshot.docs
      .map((reportDoc) => ({ id: reportDoc.id, ...reportDoc.data() }));

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

    return centeredDateKeys.map((dateKey) => {
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
async function deleteParkRecord(parkId, userId, role) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!canPerformAction(role, "parkDelete")) {
    throw new Error("You are not authorized to delete parks.");
  }

  try {
    const db = getDatabaseService();
    const parkRef = doc(db, "parks", parkId);
    const parkSnapshot = await getDoc(parkRef);

    if (!parkSnapshot.exists()) {
      throw new Error("Park not found.");
    }

    const park = { id: parkSnapshot.id, ...parkSnapshot.data() };
    await deleteDoc(parkRef);

    // Non-fatal: a token-claim timing issue can reject the audit write even
    // after the park document is already gone. Log and continue.
    try {
      await logAuditEvent({
        eventType: "park_deleted",
        actorId: userId,
        targetId: parkId,
        parkId,
        metadata: {
          name: park.name || "",
          location: park.location || ""
        }
      });
    } catch (auditError) {
      console.error("Audit log write failed after park delete:", auditError);
    }

    return true;
  } catch (error) {
    throw createServiceError(error, "Delete park failed.");
  }
}

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

async function createReview(parkId, userId, reviewData = {}) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  try {
    const db = getDatabaseService();
    const reviewsRef = collection(db, "reviews");
    const existingReviewQuery = query(reviewsRef, where("parkId", "==", parkId), where("userId", "==", userId));
    const existingReviewSnapshot = await getDocs(existingReviewQuery);

    if (!existingReviewSnapshot.empty) {
      throw new Error("You have already reviewed this park.");
    }

    const reviewEntry = createReviewModel({
      ...reviewData,
      parkId,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const recordRef = await addDoc(reviewsRef, reviewEntry);
    await updateReviewAggregate(parkId);

    return { id: recordRef.id, ...reviewEntry };
  } catch (error) {
    throw createServiceError(error, "Create review failed.");
  }
}

async function getReviews(parkId, options = {}) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  try {
    const db = getDatabaseService();
    const reviewsRef = collection(db, "reviews");
    const reviewsQuery = query(reviewsRef, where("parkId", "==", parkId));
    const snapshot = await getDocs(reviewsQuery);
    const reviews = snapshot.docs.map((reviewDocument) => ({ id: reviewDocument.id, ...reviewDocument.data() }));

    if (options.includeHidden) {
      return reviews.sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
    }

    return reviews
      .filter((review) => !review.hidden)
      .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
  } catch (error) {
    throw createServiceError(error, "Get reviews failed.");
  }
}

async function updateReviewAggregate(parkId) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  try {
    const reviews = await getReviews(parkId, { includeHidden: true });
    const ratings = reviews
      .map((review) => Number(review.rating))
      .filter((rating) => Number.isFinite(rating));

    const averageRating = ratings.length > 0
      ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1))
      : null;

    const payload = {
      reviewAggregate: {
        averageRating,
        reviewCount: ratings.length
      },
      updatedAt: new Date().toISOString()
    };

    await updateRecord("parks", parkId, payload);
    return payload.reviewAggregate;
  } catch (error) {
    throw createServiceError(error, "Update review aggregate failed.");
  }
}

async function addFavorite(userId, parkId) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  try {
    const db = getDatabaseService();
    const favoritesRef = collection(db, "users", userId, "favorites");
    const existingFavoritesQuery = query(favoritesRef, where("parkId", "==", parkId));
    const snapshot = await getDocs(existingFavoritesQuery);

    if (!snapshot.empty) {
      return { success: true, added: false, favorite: { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } };
    }

    const favoriteEntry = {
      parkId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const recordRef = await addDoc(favoritesRef, favoriteEntry);
    return { success: true, added: true, favorite: { id: recordRef.id, ...favoriteEntry } };
  } catch (error) {
    throw createServiceError(error, "Add favorite failed.");
  }
}

async function removeFavorite(userId, parkId) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  try {
    const db = getDatabaseService();
    const favoritesRef = collection(db, "users", userId, "favorites");
    const existingFavoritesQuery = query(favoritesRef, where("parkId", "==", parkId));
    const snapshot = await getDocs(existingFavoritesQuery);

    if (snapshot.empty) {
      return { success: true, removed: false };
    }

    await deleteDoc(doc(favoritesRef, snapshot.docs[0].id));
    return { success: true, removed: true };
  } catch (error) {
    throw createServiceError(error, "Remove favorite failed.");
  }
}

async function getFavorites(userId) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  try {
    const db = getDatabaseService();
    const favoritesRef = collection(db, "users", userId, "favorites");
    const snapshot = await getDocs(favoritesRef);
    return snapshot.docs.map((favoriteDocument) => ({ id: favoriteDocument.id, ...favoriteDocument.data() }));
  } catch (error) {
    throw createServiceError(error, "Get favorites failed.");
  }
}

async function submitParkPhoto(parkId, userId, file) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  if (!userId) {
    throw new Error("User ID is required.");
  }

  validatePhoto(file);

  try {
    const photoUrl = await uploadParkPhoto(parkId, file);
    const db = getDatabaseService();
    const parkRef = doc(db, "parks", parkId);
    const parkSnapshot = await getDoc(parkRef);

    if (!parkSnapshot.exists()) {
      throw new Error("Park not found.");
    }

    const currentPark = parkSnapshot.data() || {};
    const photos = Array.isArray(currentPark.photos) ? currentPark.photos : [];

    if (!photos.includes(photoUrl)) {
      photos.push(photoUrl);
    }

    await updateDoc(parkRef, {
      photos,
      updatedAt: new Date().toISOString()
    });

    return { success: true, photoUrl, photos };
  } catch (error) {
    throw createServiceError(error, "Submit park photo failed.");
  }
}

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

    // Stamp actorId from the authenticated session rather than trusting the
    // caller. Security rules require actorId == request.auth.uid, and some call
    // sites pass a Firestore document ID that can differ from the Auth uid on
    // legacy records. Deriving it here makes that mismatch structurally impossible.
    const { auth } = getFirebaseServices();
    const authenticatedActorId = auth?.currentUser?.uid || event.actorId;

    const auditEntry = createAuditLogModel({
      ...event,
      actorId: authenticatedActorId,
      timestamp: event.timestamp || new Date().toISOString()
    });

    const { id, ...entryData } = auditEntry;
    const docRef = await addDoc(auditLogRef, entryData);
    return { id: docRef.id };
  } catch (error) {
    throw createServiceError(error, "Log audit event failed.");
  }
}

/**
 * Sprint 3 Workstream 2 (2.5): Assign a Park Admin to a park.
 * Site Admin only. Writes assignment metadata to users collection and logs audit event.
 */
async function assignParkAdmin(parkId, targetUserId, assignedByUserId) {
  if (!parkId || !targetUserId || !assignedByUserId) {
    throw new Error("parkId, targetUserId, and assignedByUserId are required.");
  }

  try {
    const db = getDatabaseService();
    const assigner = await assertAuthorizedUserForAction(db, assignedByUserId, "assignParkAdmin");

    const parkRef = doc(db, "parks", parkId);
    const parkSnapshot = await getDoc(parkRef);
    if (!parkSnapshot.exists()) {
      throw new Error("Park not found.");
    }

    const targetUser = await getUserRecordByUid(db, targetUserId);
    if (!targetUser) {
      throw new Error("Target user not found.");
    }

    const assignedParks = Array.isArray(targetUser.data.assignedParks)
      ? [...targetUser.data.assignedParks]
      : [];

    if (!assignedParks.includes(parkId)) {
      assignedParks.push(parkId);
    }

    // Role and assignedParks are server-owned: Firestore rules reject client writes
    // to those fields, and the role must also be mirrored onto the Auth custom claim.
    // The Cloud Function performs the write, sets the claim, and logs the audit event.
    await setUserRoleAndParks(
      targetUser.data.uid || targetUser.id,
      targetUser.data.role || USER_ROLES.PARK_ADMIN,
      assignedParks
    );

    return {
      success: true,
      parkId,
      targetUserId: targetUser.data.uid || targetUser.id,
      assignedByUserId: assigner.data.uid || assigner.id,
      assignedParks
    };
  } catch (error) {
    throw createServiceError(error, "Assign park admin failed.");
  }
}

/**
 * Sprint 3 Workstream 2 (2.5): Remove a Park Admin assignment from a park.
 * Site Admin only. Writes assignment metadata to users collection and logs audit event.
 */
async function removeParkAdmin(parkId, targetUserId, removedByUserId) {
  if (!parkId || !targetUserId || !removedByUserId) {
    throw new Error("parkId, targetUserId, and removedByUserId are required.");
  }

  try {
    const db = getDatabaseService();
    const remover = await assertAuthorizedUserForAction(db, removedByUserId, "removeParkAdmin");

    const targetUser = await getUserRecordByUid(db, targetUserId);
    if (!targetUser) {
      throw new Error("Target user not found.");
    }

    const assignedParks = (Array.isArray(targetUser.data.assignedParks)
      ? targetUser.data.assignedParks
      : []).filter((id) => id !== parkId);

    // Demote to Parent once the last park assignment is removed, otherwise the
    // user would keep Park Admin privileges with no parks to administer.
    const nextRole = assignedParks.length === 0
      ? USER_ROLES.PARENT
      : (targetUser.data.role || USER_ROLES.PARK_ADMIN);

    // Server-owned fields; see assignParkAdmin for rationale.
    await setUserRoleAndParks(
      targetUser.data.uid || targetUser.id,
      nextRole,
      assignedParks
    );

    return {
      success: true,
      parkId,
      targetUserId: targetUser.data.uid || targetUser.id,
      removedByUserId: remover.data.uid || remover.id,
      assignedParks
    };
  } catch (error) {
    throw createServiceError(error, "Remove park admin failed.");
  }
}

/**
 * Sprint 3 Workstream 2 (2.6): Read filtered audit log records.
 * Site Admin only. Unfiltered full-collection reads are blocked.
 */
async function getAuditLog(filters = {}) {
  const requestedByUserId = filters.requestedByUserId;

  if (!requestedByUserId) {
    throw new Error("requestedByUserId is required.");
  }

  try {
    const db = getDatabaseService();
    await assertAuthorizedUserForAction(db, requestedByUserId, "viewAuditLog");

    const constraints = [];

    if (filters.parkId) {
      constraints.push(where("parkId", "==", filters.parkId));
    }

    if (filters.actorId) {
      constraints.push(where("actorId", "==", filters.actorId));
    }

    if (filters.targetId) {
      constraints.push(where("targetId", "==", filters.targetId));
    }

    if (filters.eventType) {
      if (!isValidAuditEventType(filters.eventType)) {
        throw new Error("Invalid audit event type filter.");
      }

      constraints.push(where("eventType", "==", filters.eventType));
    }

    if (filters.fromTimestamp) {
      constraints.push(where("timestamp", ">=", filters.fromTimestamp));
    }

    if (filters.toTimestamp) {
      constraints.push(where("timestamp", "<=", filters.toTimestamp));
    }

    if (constraints.length === 0) {
      throw new Error("At least one filter (parkId, actorId, targetId, eventType, fromTimestamp, toTimestamp) is required.");
    }

    const maxResults = Number.isFinite(Number(filters.limit))
      ? Math.max(1, Math.min(Number(filters.limit), 100))
      : 50;

    const auditQuery = query(
      collection(db, "auditLog"),
      ...constraints,
      orderBy("timestamp", "desc"),
      limit(maxResults)
    );
    const snapshot = await getDocs(auditQuery);

    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    throw createServiceError(error, "Get audit log failed.");
  }
}

/**
 * Sprint 3 Workstream 2 (2.7): Moderate a review record.
 * Park Admin may moderate only reviews in assigned parks; Site Admin may moderate all reviews.
 */
async function moderateReview(reviewId, action, moderatorId) {
  if (!reviewId || !action || !moderatorId) {
    throw new Error("reviewId, action, and moderatorId are required.");
  }

  try {
    const db = getDatabaseService();
    const normalizedAction = normalizeModerationAction(action);

    if (!normalizedAction) {
      throw new Error("Action must be one of: hide, disable, reinstate.");
    }

    const moderator = await assertAuthorizedUserForAction(db, moderatorId, "moderateContent");
    const moderatorRole = moderator.data.role;
    const assignedParks = Array.isArray(moderator.data.assignedParks)
      ? moderator.data.assignedParks
      : [];

    const reviewRef = doc(db, "reviews", reviewId);
    const reviewSnapshot = await getDoc(reviewRef);
    if (!reviewSnapshot.exists()) {
      throw new Error("Review not found.");
    }

    const review = reviewSnapshot.data();
    if (moderatorRole === USER_ROLES.PARK_ADMIN && !assignedParks.includes(review.parkId)) {
      throw new Error("Park Admin can moderate reviews only for assigned parks.");
    }

    await updateDoc(reviewRef, {
      hidden: normalizedAction === "hide",
      moderatedBy: moderator.data.uid || moderator.id,
      moderatedAt: new Date().toISOString(),
      moderationAction: normalizedAction
    });

    await logAuditEvent({
      eventType: AUDIT_EVENT_TYPES.CONTENT_MODERATED,
      actorId: moderator.data.uid || moderator.id,
      targetId: reviewId,
      parkId: review.parkId || "",
      metadata: {
        action: normalizedAction
      }
    });

    return {
      success: true,
      reviewId,
      parkId: review.parkId || "",
      action: normalizedAction,
      hidden: normalizedAction === "hide"
    };
  } catch (error) {
    throw createServiceError(error, "Moderate review failed.");
  }
}

/**
 * Sprint 3 Workstream 2 (2.7): Moderate a user account.
 * Site Admin only.
 */
async function moderateUser(targetUserId, action, moderatorId) {
  if (!targetUserId || !action || !moderatorId) {
    throw new Error("targetUserId, action, and moderatorId are required.");
  }

  try {
    const db = getDatabaseService();
    const normalizedAction = normalizeModerationAction(action);

    if (!normalizedAction) {
      throw new Error("Action must be one of: hide, disable, reinstate.");
    }

    const moderator = await assertAuthorizedUserForAction(db, moderatorId, "moderateUser");
    const targetUser = await getUserRecordByUid(db, targetUserId);

    if (!targetUser) {
      throw new Error("Target user not found.");
    }

    // Moderation fields are server-owned: Firestore rules reject client writes to
    // `disabled`/`moderatedBy`/etc., and only the Admin SDK can disable the
    // underlying Auth account. The Cloud Function performs the write, disables the
    // Auth user, and logs the audit event.
    await moderateUserAccount(targetUser.data.uid || targetUser.id, normalizedAction);

    return {
      success: true,
      targetUserId: targetUser.data.uid || targetUser.id,
      action: normalizedAction,
      disabled: normalizedAction === "hide"
    };
  } catch (error) {
    throw createServiceError(error, "Moderate user failed.");
  }
}

async function getRecordById(collectionName, recordId) {
  try {
    const db = getDatabaseService();
    const recordRef = doc(db, collectionName, recordId);
    const snapshot = await getDoc(recordRef);
    if (!snapshot.exists()) {
      throw new Error(`No ${collectionName} record found with ID: ${recordId}`);
    }
    return { id: snapshot.id, ...snapshot.data() };
  } catch (error) {
    throw createServiceError(error, `Get ${collectionName} record by ID failed.`);
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
  deleteParkRecord,
  createParkRecord,
  editParkRecord,
  queryParksPage,
  getRecentCrowdReportsForPark,
  calculateBusyLevelFromReports,
  submitCrowdReport,
  logAuditEvent,
  createReview,
  getReviews,
  updateReviewAggregate,
  addFavorite,
  removeFavorite,
  getFavorites,
  submitParkPhoto,
  assignParkAdmin,
  removeParkAdmin,
  getAuditLog,
  moderateReview,
  moderateUser,
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
  getCrowdHistory,
  getRecordById
};