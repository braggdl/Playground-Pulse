/*
  Equipment Model
  Purpose: Define the structure for playground equipment records.

  API Contract:
  - createEquipmentModel(partialEquipment) → equipment object
    Input:  partial object with any subset of equipment fields
    Output: fully-shaped equipment object with all fields populated to defaults
    Errors: none thrown; invalid status values fall back to "operational"

  Collection: equipment (subcollection under parks/{parkId}/equipment or top-level with parkId field)
  Fields:
    id          (string, required) — Firestore document ID; empty string on creation
    parkId      (string, required) — ID of the park this equipment belongs to
    name        (string, required) — display name of the equipment item
    status      (string, required) — one of EQUIPMENT_STATUSES values; defaults to "operational"
    createdAt   (string, required) — ISO 8601 timestamp
    updatedAt   (string, required) — ISO 8601 timestamp; updated on each status change
*/

import { EQUIPMENT_STATUSES } from "../constants/reportConstants.js";

function isValidEquipmentStatus(status) {
  return Object.values(EQUIPMENT_STATUSES).includes(status);
}

function createEquipmentModel(partialEquipment = {}) {
  const now = new Date().toISOString();
  const status = partialEquipment.status || EQUIPMENT_STATUSES.OPERATIONAL;

  return {
    id: partialEquipment.id || "",
    parkId: partialEquipment.parkId || "",
    name: partialEquipment.name || "",
    status: isValidEquipmentStatus(status) ? status : EQUIPMENT_STATUSES.OPERATIONAL,
    createdAt: partialEquipment.createdAt || now,
    updatedAt: partialEquipment.updatedAt || now
  };
}

export { isValidEquipmentStatus, createEquipmentModel };
