/*
  Notification Service
  Purpose: Deliver in-app notifications to users via Firestore.

  NOTE: Email notification delivery is out of scope for Sprint 3.
  All notifications are written to the Firestore `notifications` collection
  and surfaced via a real-time listener in the UI (not polling).

  API Contracts:

  notifyUser(userId, event, payload) → Promise<{ id: string }>
    Input:
      userId  (string) — the recipient user's Firebase Auth UID
      event   (string) — one of NOTIFICATION_EVENT_TYPES values
      payload (object) — event-specific context (e.g. { reportId, newStatus, parkId })
    Output: object with the Firestore document ID of the created notification
    Errors:
      Throws Error("User ID is required.")   if userId is falsy
      Throws Error("Event type is required.") if event is falsy
      Throws Error with Firestore error message on write failure

  Notification document shape (notifications collection):
    id        (string)  — Firestore document ID
    userId    (string)  — recipient user's UID
    event     (string)  — NOTIFICATION_EVENT_TYPES value
    payload   (object)  — event-specific context
    read      (boolean) — false on creation; set to true when the user views the notification
    createdAt (string)  — ISO 8601 timestamp

  Usage:
  - Workstream 1 (2.4) wires notifyUser() into updateSafetyReportStatus() for status transitions.
  - UI uses a real-time Firestore listener scoped to the authenticated user to avoid polling.
*/

import {
  addDoc,
  collection
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getFirebaseServices, initializeFirebaseServices } from "./firebase-config.js";

const NOTIFICATION_EVENT_TYPES = {
  SAFETY_REPORT_STATUS_CHANGED: "safety_report_status_changed"
};

async function notifyUser(userId, event, payload = {}) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!event) {
    throw new Error("Event type is required.");
  }

  initializeFirebaseServices();
  const { db } = getFirebaseServices();

  try {
    const notificationsRef = collection(db, "notifications");
    const notificationDoc = {
      userId,
      event,
      payload,
      read: false,
      createdAt: new Date().toISOString()
    };

    const docRef = await addDoc(notificationsRef, notificationDoc);
    return { id: docRef.id };
  } catch (error) {
    throw new Error(error?.message || "Notification delivery failed.");
  }
}

export { NOTIFICATION_EVENT_TYPES, notifyUser };
