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
  query,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";
import { createParkModel } from "../models/parkModel.js";

function getDatabaseService() {
  initializeFirebaseServices();
  const { db } = getFirebaseServices();

  if (!db) {
    throw new Error("Database service failed to initialize.");
  }

  return db;
}

async function createRecord(collectionName, recordData) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, collectionName);
    const recordRef = await addDoc(collectionRef, recordData);

    return { id: recordRef.id, ...recordData };
  } catch (error) {
    throw new Error(`Create record failed: ${error.message}`);
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
    throw new Error(`Create user record failed: ${error.message}`);
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
    throw new Error(`Read records failed: ${error.message}`);
  }
}

async function updateRecord(collectionName, recordId, updatedData) {
  try {
    const db = getDatabaseService();
    const recordRef = doc(db, collectionName, recordId);
    await updateDoc(recordRef, updatedData);

    return { id: recordId, ...updatedData };
  } catch (error) {
    throw new Error(`Update record failed: ${error.message}`);
  }
}

async function deleteRecord(collectionName, recordId) {
  try {
    const db = getDatabaseService();
    const recordRef = doc(db, collectionName, recordId);
    await deleteDoc(recordRef);

    return true;
  } catch (error) {
    throw new Error(`Delete record failed: ${error.message}`);
  }
}

/**
 * Phase 3: Search for parks by text query
 * Performs a partial match search on name and location fields
 */
async function searchParks(searchTerm) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const snapshot = await getDocs(collectionRef);
    
    const searchLower = searchTerm.toLowerCase();
    const results = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((park) => {
        const name = (park.name || "").toLowerCase();
        const location = (park.location || "").toLowerCase();
        return name.includes(searchLower) || location.includes(searchLower);
      });
    
    return results;
  } catch (error) {
    throw new Error(`Search parks failed: ${error.message}`);
  }
}

/**
 * Phase 3: Filter parks by multiple criteria
 * Supports age groups, amenities, and maintenance status filters
 */
async function filterParks(filterCriteria) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const snapshot = await getDocs(collectionRef);
    
    const results = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((park) => {
        // Check age groups filter
        if (filterCriteria.ageGroups && filterCriteria.ageGroups.length > 0) {
          const parkHasAgeGroup = filterCriteria.ageGroups.some(
            (group) => park.ageGroups?.[group] === true
          );
          if (!parkHasAgeGroup) return false;
        }
        
        // Check fenced area filter
        if (filterCriteria.fencedArea !== undefined && filterCriteria.fencedArea !== null) {
          if (park.fencedArea !== filterCriteria.fencedArea) return false;
        }
        
        // Check restrooms filter
        if (filterCriteria.restrooms !== undefined && filterCriteria.restrooms !== null) {
          if (park.restrooms !== filterCriteria.restrooms) return false;
        }
        
        // Check shade availability filter
        if (filterCriteria.shadeAvailable !== undefined && filterCriteria.shadeAvailable !== null) {
          if (park.shadeAvailable !== filterCriteria.shadeAvailable) return false;
        }
        
        // Check maintenance status filter
        if (filterCriteria.maintenanceStatus) {
          if (park.maintenanceStatus !== filterCriteria.maintenanceStatus) return false;
        }
        
        return true;
      });
    
    return results;
  } catch (error) {
    throw new Error(`Filter parks failed: ${error.message}`);
  }
}

/**
 * Phase 3: Combined search and filter
 * Performs text search AND applies additional filters
 */
async function searchAndFilterParks(searchTerm, filterCriteria) {
  try {
    const db = getDatabaseService();
    const collectionRef = collection(db, "parks");
    const snapshot = await getDocs(collectionRef);
    
    const searchLower = searchTerm.toLowerCase();
    const results = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((park) => {
        // Apply search filter
        if (searchTerm) {
          const name = (park.name || "").toLowerCase();
          const location = (park.location || "").toLowerCase();
          if (!name.includes(searchLower) && !location.includes(searchLower)) {
            return false;
          }
        }
        
        // Check age groups filter
        if (filterCriteria.ageGroups && filterCriteria.ageGroups.length > 0) {
          const parkHasAgeGroup = filterCriteria.ageGroups.some(
            (group) => park.ageGroups?.[group] === true
          );
          if (!parkHasAgeGroup) return false;
        }
        
        // Check fenced area filter
        if (filterCriteria.fencedArea !== undefined && filterCriteria.fencedArea !== null) {
          if (park.fencedArea !== filterCriteria.fencedArea) return false;
        }
        
        // Check restrooms filter
        if (filterCriteria.restrooms !== undefined && filterCriteria.restrooms !== null) {
          if (park.restrooms !== filterCriteria.restrooms) return false;
        }
        
        // Check shade availability filter
        if (filterCriteria.shadeAvailable !== undefined && filterCriteria.shadeAvailable !== null) {
          if (park.shadeAvailable !== filterCriteria.shadeAvailable) return false;
        }
        
        // Check maintenance status filter
        if (filterCriteria.maintenanceStatus) {
          if (park.maintenanceStatus !== filterCriteria.maintenanceStatus) return false;
        }
        
        return true;
      });
    
    return results;
  } catch (error) {
    throw new Error(`Search and filter parks failed: ${error.message}`);
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
    throw new Error(`Get park by ID failed: ${error.message}`);
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
  editParkRecord
};