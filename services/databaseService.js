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
import {
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
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const pageSize = normalizeParkSearchPageSize(options.pageSize);
    const queryConstraints = [orderBy("name"), limit(pageSize)];

    if (options.startAfter) {
      queryConstraints.push(startAfter(options.startAfter));
    }

    const snapshot = await getDocs(query(collectionRef, ...queryConstraints));
    const parks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const predicate = buildParkSearchFilterPredicate(searchTerm);
    const results = parks.filter(predicate);

    return {
      results: applyParkSearchPageLimit(results, options),
      lastDocument: snapshot.docs[snapshot.docs.length - 1] || null,
      pageSize,
      hasMore: snapshot.docs.length === pageSize
    };
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
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const pageSize = normalizeParkSearchPageSize(options.pageSize);
    const queryConstraints = [orderBy("name"), limit(pageSize)];

    if (options.startAfter) {
      queryConstraints.push(startAfter(options.startAfter));
    }

    if (filterCriteria.maintenanceStatus) {
      queryConstraints.push(where("maintenanceStatus", "==", filterCriteria.maintenanceStatus));
    }

    ["fencedArea", "restrooms", "shadeAvailable"].forEach((field) => {
      const value = filterCriteria[field];
      if (value !== undefined && value !== null) {
        queryConstraints.push(where(field, "==", value));
      }
    });

    const snapshot = await getDocs(query(collectionRef, ...queryConstraints));
    const parks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const predicate = buildParkSearchFilterPredicate(undefined, filterCriteria);
    const results = parks.filter(predicate);

    return {
      results: applyParkSearchPageLimit(results, options),
      lastDocument: snapshot.docs[snapshot.docs.length - 1] || null,
      pageSize,
      hasMore: snapshot.docs.length === pageSize
    };
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
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const pageSize = normalizeParkSearchPageSize(options.pageSize);
    const queryConstraints = [orderBy("name"), limit(pageSize)];

    if (options.startAfter) {
      queryConstraints.push(startAfter(options.startAfter));
    }

    if (filterCriteria.maintenanceStatus) {
      queryConstraints.push(where("maintenanceStatus", "==", filterCriteria.maintenanceStatus));
    }

    ["fencedArea", "restrooms", "shadeAvailable"].forEach((field) => {
      const value = filterCriteria[field];
      if (value !== undefined && value !== null) {
        queryConstraints.push(where(field, "==", value));
      }
    });

    const snapshot = await getDocs(query(collectionRef, ...queryConstraints));
    const parks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const predicate = buildParkSearchFilterPredicate(searchTerm, filterCriteria);
    const results = parks.filter(predicate);

    return {
      results: applyParkSearchPageLimit(results, options),
      lastDocument: snapshot.docs[snapshot.docs.length - 1] || null,
      pageSize,
      hasMore: snapshot.docs.length === pageSize
    };
  } catch (error) {
    throw createServiceError(error, "Search and filter parks failed.");
  }
}

/**
 * Phase 3: Get a single park by ID
 */
async function getParkById(parkId) {
  try {
    const parks = await readRecords("parks", {});
    const park = parks.find((p) => p.id === parkId);
    if (!park) {
      throw new Error(`Park with ID ${parkId} not found`);
    }
    return park;
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
      where("parkId", "==", parkId),
      where("reportedAt", ">=", windowStart),
      orderBy("reportedAt", "desc")
    );
    const snapshot = await getDocs(reportsQuery);

    return snapshot.docs.map((reportDocument) => ({ id: reportDocument.id, ...reportDocument.data() }));
  } catch (error) {
    throw createServiceError(error, "Get recent crowd reports failed.");
  }
}

function calculateBusyLevelFromReports(reports = []) {
  if (!reports.length) {
    return {
      score: null,
      label: getBusyLevelLabel(null),
      reportCount: 0
    };
  }

  const scores = reports
    .map((report) => getBusyLevelScoreFromCrowdLevel(report.crowdLevel))
    .filter((score) => Number.isFinite(score));

  if (!scores.length) {
    return {
      score: null,
      label: getBusyLevelLabel(null),
      reportCount: 0
    };
  }

  const averageScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);

  return {
    score: averageScore,
    label: getBusyLevelLabel(averageScore),
    reportCount: scores.length
  };
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
  submitCrowdReport
};