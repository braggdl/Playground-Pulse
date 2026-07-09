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
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "./firebase-config.js";

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

export { createRecord, readRecords, updateRecord, deleteRecord };
