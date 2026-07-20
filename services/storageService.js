/*
  Storage Service
  Purpose: Handle photo validation and upload to Firebase Storage.

  API Contracts:

  validatePhoto(file) → void (throws on invalid input)
    Input:  File object from a browser file input
    Output: undefined on success; throws a typed StorageError on failure
    Errors:
      StorageError { type: STORAGE_ERROR_TYPES.INVALID_FORMAT } — file MIME type is not JPEG, PNG, or WebP
      StorageError { type: STORAGE_ERROR_TYPES.SIZE_EXCEEDED }  — file size exceeds 5 MB

  uploadParkPhoto(parkId, file) → Promise<string>
    Input:  parkId (string), file (File object)
    Output: download URL string from Firebase Storage on success
    Errors:
      Propagates StorageError from validatePhoto() if file is invalid
      Throws Error with message "Park ID is required." if parkId is falsy
      Throws Error with Firebase Storage error message on upload failure

  Note: Sprint 3 scope allows one photo upload per action. Multi-photo upload is out of scope.
  Note: Caller is responsible for storing the returned download URL in the park's photos array in Firestore.
*/

import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { getFirebaseServices, initializeFirebaseServices } from "./firebase-config.js";

const PHOTO_VALIDATION_POLICY = {
  allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxSizeBytes: 5 * 1024 * 1024 // 5 MB
};

const STORAGE_ERROR_TYPES = {
  INVALID_FORMAT: "INVALID_FORMAT",
  SIZE_EXCEEDED: "SIZE_EXCEEDED"
};

class StorageError extends Error {
  constructor(type, message) {
    super(message);
    this.name = "StorageError";
    this.type = type;
  }
}

function validatePhoto(file) {
  if (!file || typeof file !== "object") {
    throw new StorageError(STORAGE_ERROR_TYPES.INVALID_FORMAT, "A valid file must be provided.");
  }

  if (!PHOTO_VALIDATION_POLICY.allowedTypes.includes(file.type)) {
    throw new StorageError(
      STORAGE_ERROR_TYPES.INVALID_FORMAT,
      "Unsupported file type. Please upload a JPEG, PNG, or WebP image."
    );
  }

  if (file.size > PHOTO_VALIDATION_POLICY.maxSizeBytes) {
    throw new StorageError(
      STORAGE_ERROR_TYPES.SIZE_EXCEEDED,
      "File exceeds the 5 MB size limit. Please upload a smaller image."
    );
  }
}

function generatePhotoFileName(file) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 9);
  const extension = file.name ? file.name.split(".").pop() : "jpg";
  return `${timestamp}-${randomSuffix}.${extension}`;
}

async function uploadParkPhoto(parkId, file) {
  if (!parkId) {
    throw new Error("Park ID is required.");
  }

  validatePhoto(file);

  initializeFirebaseServices();
  const { app } = getFirebaseServices();
  const storage = getStorage(app);
  const fileName = generatePhotoFileName(file);
  const storagePath = `parks/${parkId}/photos/${fileName}`;
  const storageRef = ref(storage, storagePath);

  try {
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    throw new Error(error?.message || "Photo upload failed. Please try again.");
  }
}

export { PHOTO_VALIDATION_POLICY, STORAGE_ERROR_TYPES, StorageError, validatePhoto, uploadParkPhoto };
