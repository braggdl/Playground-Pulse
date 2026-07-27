/*
  Audit Log Model
  Purpose: Define the structure for administrative audit log event records.

  API Contract:
  - createAuditLogModel(partialEvent) → auditLog object
    Input:  partial object with any subset of audit log fields
    Output: fully-shaped audit log object with all fields populated to defaults
    Errors: none thrown; invalid eventType values are stored as-is for traceability

  Collection: auditLog
  Fields:
    id         (string, required)  — Firestore document ID; empty string on creation
    eventType  (string, required)  — one of AUDIT_EVENT_TYPES values
    actorId    (string, required)  — userId of the person who performed the action
    targetId   (string, required)  — userId or resourceId that was acted upon
    parkId     (string, optional)  — ID of the park involved; empty string if not applicable
    metadata   (object, optional)  — additional context specific to the event type
    timestamp  (string, required)  — ISO 8601 timestamp of when the event occurred

  Constraints:
  - Audit log records are append-only; never updated or deleted
  - All reads must use filtered queries (by park, actor, or eventType); full-collection reads are not supported
  - logAuditEvent() in databaseService.js is the only writer for this collection
*/

const AUDIT_EVENT_TYPES = {
  ADMIN_ASSIGNED: "admin_assigned",
  ADMIN_REMOVED: "admin_removed",
  CONTENT_MODERATED: "content_moderated",
  USER_MODERATED: "user_moderated",
  SAFETY_STATUS_CHANGED: "safety_status_changed",
  EQUIPMENT_STATUS_CHANGED: "equipment_status_changed",
  SAFETY_REPORT_DELETED: "safety_report_deleted",
  EQUIPMENT_DELETED: "equipment_deleted"
};

const ALLOWED_AUDIT_EVENT_TYPES = Object.values(AUDIT_EVENT_TYPES);

function isValidAuditEventType(eventType) {
  return ALLOWED_AUDIT_EVENT_TYPES.includes(eventType);
}

function createAuditLogModel(partialEvent = {}) {
  const now = new Date().toISOString();

  return {
    id: partialEvent.id || "",
    eventType: partialEvent.eventType || "",
    actorId: partialEvent.actorId || "",
    targetId: partialEvent.targetId || "",
    parkId: partialEvent.parkId || "",
    metadata: partialEvent.metadata || {},
    timestamp: partialEvent.timestamp || now
  };
}

export { AUDIT_EVENT_TYPES, ALLOWED_AUDIT_EVENT_TYPES, isValidAuditEventType, createAuditLogModel };
