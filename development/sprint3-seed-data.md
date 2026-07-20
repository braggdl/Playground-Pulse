# Sprint 3 Seed Data

## Purpose
This document defines the Firestore seed steps all engineers must use when setting up Sprint 3 local test data. Use the shared identifiers below across all workstreams to ensure cross-workstream data consistency.

## Shared Test Identifiers

| Role | userId | displayName |
|---|---|---|
| Parent | `user-parent-001` | Alex Parent |
| Park Admin | `user-parkadmin-001` | Jordan Admin |
| Site Admin | `user-siteadmin-001` | Sam SiteAdmin |

| Park | parkId | Name |
|---|---|---|
| Park A | `park-test-001` | Riverside Playground |
| Park B | `park-test-002` | Hilltop Play Area |

---

## Collection: `users`

### user-parent-001
```json
{
  "uid": "user-parent-001",
  "email": "alex.parent@test.com",
  "role": "Parent",
  "displayName": "Alex Parent",
  "assignedParks": [],
  "reauthRequired": false,
  "passwordPolicyVersion": 2,
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-01T10:00:00.000Z"
}
```

### user-parkadmin-001
```json
{
  "uid": "user-parkadmin-001",
  "email": "jordan.admin@test.com",
  "role": "Park Admin",
  "displayName": "Jordan Admin",
  "assignedParks": ["park-test-001"],
  "reauthRequired": false,
  "passwordPolicyVersion": 2,
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-01T10:00:00.000Z"
}
```

### user-siteadmin-001
```json
{
  "uid": "user-siteadmin-001",
  "email": "sam.siteadmin@test.com",
  "role": "Site Admin",
  "displayName": "Sam SiteAdmin",
  "assignedParks": [],
  "reauthRequired": false,
  "passwordPolicyVersion": 2,
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-01T10:00:00.000Z"
}
```

---

## Collection: `parks`

Extend these two test parks. If parks already exist from Sprint 1/2 seed data, update them with the Sprint 3 fields below. If creating new records, merge with the Sprint 1/2 baseline fields.

### park-test-001 — Riverside Playground
```json
{
  "name": "Riverside Playground",
  "location": "123 River Rd, Detroit, MI",
  "coordinates": { "lat": 42.3314, "lng": -83.0458 },
  "ageGroups": { "toddler": true, "kid": true, "teen": false },
  "fencedArea": true,
  "restrooms": true,
  "shadeAvailable": true,
  "maintenanceStatus": "good",
  "equipment": [],
  "reviewAggregate": { "averageRating": null, "reviewCount": 0 },
  "crowdHistory": [],
  "photos": [],
  "safetyNotes": "",
  "amenitiesNotes": "Water fountain near the entrance.",
  "createdAt": "2026-06-01T08:00:00.000Z",
  "updatedAt": "2026-07-01T08:00:00.000Z"
}
```

### park-test-002 — Hilltop Play Area
```json
{
  "name": "Hilltop Play Area",
  "location": "456 Hill Ave, Dearborn, MI",
  "coordinates": { "lat": 42.3223, "lng": -83.1763 },
  "ageGroups": { "toddler": false, "kid": true, "teen": true },
  "fencedArea": false,
  "restrooms": false,
  "shadeAvailable": false,
  "maintenanceStatus": "needs_attention",
  "equipment": [],
  "reviewAggregate": { "averageRating": null, "reviewCount": 0 },
  "crowdHistory": [],
  "photos": [],
  "safetyNotes": "Uneven pavement near the east entrance.",
  "amenitiesNotes": "",
  "createdAt": "2026-06-01T08:00:00.000Z",
  "updatedAt": "2026-07-01T08:00:00.000Z"
}
```

---

## Collection: `safetyReports`

Two reports per park — one `open`, one `in_review`.

### report-001 (park-test-001, open)
```json
{
  "parkId": "park-test-001",
  "userId": "user-parent-001",
  "type": "safety",
  "description": "Broken swing chain on the east swing set.",
  "status": "open",
  "createdAt": "2026-07-15T09:00:00.000Z",
  "updatedAt": "2026-07-15T09:00:00.000Z"
}
```

### report-002 (park-test-001, in_review)
```json
{
  "parkId": "park-test-001",
  "userId": "user-parent-001",
  "type": "maintenance",
  "description": "Graffiti on the restroom walls.",
  "status": "in_review",
  "createdAt": "2026-07-10T14:00:00.000Z",
  "updatedAt": "2026-07-12T11:00:00.000Z"
}
```

### report-003 (park-test-002, open)
```json
{
  "parkId": "park-test-002",
  "userId": "user-parent-001",
  "type": "safety",
  "description": "Exposed bolt on the climbing structure.",
  "status": "open",
  "createdAt": "2026-07-14T10:30:00.000Z",
  "updatedAt": "2026-07-14T10:30:00.000Z"
}
```

### report-004 (park-test-002, in_review)
```json
{
  "parkId": "park-test-002",
  "userId": "user-parent-001",
  "type": "maintenance",
  "description": "Trash cans are overflowing.",
  "status": "in_review",
  "createdAt": "2026-07-11T08:00:00.000Z",
  "updatedAt": "2026-07-13T09:00:00.000Z"
}
```

---

## Collection: `equipment`

Three items per park covering all three status values.

### Equipment for park-test-001
```json
{ "parkId": "park-test-001", "name": "Main Swing Set", "status": "operational", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-01T08:00:00.000Z" }
{ "parkId": "park-test-001", "name": "Slide Tower", "status": "needs_repair", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-10T10:00:00.000Z" }
{ "parkId": "park-test-001", "name": "Merry-Go-Round", "status": "out_of_service", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-05T15:00:00.000Z" }
```

### Equipment for park-test-002
```json
{ "parkId": "park-test-002", "name": "Climbing Structure", "status": "operational", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-01T08:00:00.000Z" }
{ "parkId": "park-test-002", "name": "Balance Beam", "status": "needs_repair", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-08T11:00:00.000Z" }
{ "parkId": "park-test-002", "name": "Spring Riders", "status": "out_of_service", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-07-03T09:00:00.000Z" }
```

---

## Collection: `reviews`

Two reviews per park, from two different user IDs.

### Reviews for park-test-001
```json
{ "parkId": "park-test-001", "userId": "user-parent-001", "rating": 4, "body": "Great park! Swings could use some maintenance.", "hidden": false, "createdAt": "2026-07-05T12:00:00.000Z" }
{ "parkId": "park-test-001", "userId": "user-parkadmin-001", "rating": 5, "body": "Beautiful playground with lots of shade.", "hidden": false, "createdAt": "2026-07-06T08:30:00.000Z" }
```

### Reviews for park-test-002
```json
{ "parkId": "park-test-002", "userId": "user-parent-001", "rating": 3, "body": "Good for older kids but no shade.", "hidden": false, "createdAt": "2026-07-07T14:00:00.000Z" }
{ "parkId": "park-test-002", "userId": "user-parkadmin-001", "rating": 2, "body": "Needs maintenance. Uneven path is a tripping hazard.", "hidden": false, "createdAt": "2026-07-08T09:15:00.000Z" }
```

---

## Collection: `auditLog`

One entry per AUDIT_EVENT_TYPES value for baseline test coverage.

```json
{ "eventType": "admin_assigned", "actorId": "user-siteadmin-001", "targetId": "user-parkadmin-001", "parkId": "park-test-001", "metadata": {}, "timestamp": "2026-07-01T10:00:00.000Z" }
{ "eventType": "admin_removed", "actorId": "user-siteadmin-001", "targetId": "user-parkadmin-001", "parkId": "park-test-002", "metadata": {}, "timestamp": "2026-07-02T10:00:00.000Z" }
{ "eventType": "content_moderated", "actorId": "user-parkadmin-001", "targetId": "review-placeholder-id", "parkId": "park-test-001", "metadata": { "action": "hide" }, "timestamp": "2026-07-10T11:00:00.000Z" }
{ "eventType": "user_moderated", "actorId": "user-siteadmin-001", "targetId": "user-parent-001", "parkId": "", "metadata": { "action": "disable" }, "timestamp": "2026-07-11T09:00:00.000Z" }
{ "eventType": "safety_status_changed", "actorId": "user-parkadmin-001", "targetId": "report-002", "parkId": "park-test-001", "metadata": { "from": "open", "to": "in_review" }, "timestamp": "2026-07-12T11:00:00.000Z" }
{ "eventType": "equipment_status_changed", "actorId": "user-parkadmin-001", "targetId": "equipment-slide-id", "parkId": "park-test-001", "metadata": { "from": "operational", "to": "needs_repair" }, "timestamp": "2026-07-10T10:00:00.000Z" }
```

---

## Collection: `notifications`

One test notification for `user-parent-001` (report-002 status transition).

```json
{
  "userId": "user-parent-001",
  "event": "safety_report_status_changed",
  "payload": { "reportId": "report-002", "newStatus": "in_review", "parkId": "park-test-001" },
  "read": false,
  "createdAt": "2026-07-12T11:00:00.000Z"
}
```

---

## Seed Steps (Firebase Emulator UI)

1. Open the Firebase Emulator Suite (run `firebase emulators:start` locally).
2. Navigate to Firestore in the Emulator UI.
3. Create each collection and document listed above using the JSON payloads.
4. For `users/{userId}/favorites` subcollection: create an empty subcollection under `user-parent-001` to verify subcollection path resolution. No documents required for Phase 1.
5. Verify the two test parks appear in your app's park search results before branching.

## Notes
- Use the exact `userId` and `parkId` values above in all workstream test scenarios so audit log, notification, and favorite references are consistent.
- `coordinates` field (`lat`/`lng`) on parks is required for the Workstream 4 map view.
- The `reviewAggregate.averageRating` will be `null` until `updateReviewAggregate()` is called by Workstream 3. Seed reviews directly as shown above to have test data before that method is implemented.
