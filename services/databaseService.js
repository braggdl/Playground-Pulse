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
import { createParkModel } from "../models/parkModel.js";
import { createAuditLogModel, isValidAuditEventType } from "../models/auditLogModel.js";
import {
  BUSY_LEVEL_WEIGHTING_POLICY,
  CROWD_REPORT_POLICY,
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
    return queryParksBySearchTerm(searchTerm, options);
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
    const hasSearchTerm = Boolean(normalizeSearchPrefix(searchTerm));

    if (hasSearchTerm) {
      const predicate = buildParkSearchFilterPredicate(undefined, filterCriteria || {});
      const pageSize = normalizeParkSearchPageSize(options.pageSize);
      let cursor = options.startAfter || null;
      let filteredResults = [];
      let hasMore = false;
      let safetyCounter = 0;

      while (filteredResults.length < pageSize && safetyCounter < 10) {
        safetyCounter += 1;
        const searchResponse = await queryParksBySearchTerm(searchTerm, {
          ...options,
          startAfter: cursor,
          pageSize
        });

        filteredResults = filteredResults.concat(searchResponse.results.filter(predicate));
        cursor = searchResponse.lastDocument;
        hasMore = searchResponse.hasMore;

        if (!searchResponse.hasMore) {
          break;
        }
      }

      return {
        results: applyParkSearchPageLimit(filteredResults, options),
        lastDocument: cursor,
        pageSize,
        hasMore
      };
    }

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
  logAuditEvent
};