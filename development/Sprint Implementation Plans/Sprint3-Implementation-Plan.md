# Sprint 3 Implementation Plan

## Purpose
This document contains the complete Sprint 3 implementation plan for Playground Pulse, organized by foundational work and parallel workstreams so software engineers can work independently while preserving logical dependencies.

## Sprint 3 Backlog Scope
- Submit Safety or Maintenance Report
- Manage Safety Reports
- Manage Equipment Status
- Track Safety Report Status and Notifications
- Assign Park Admins to Parks
- Record Administrative Actions
- Moderate Content and Users
- Submit Park Reviews and Ratings
- Upload Park Photos
- Save Favorite Parks
- Show Crowd History and Map View
- Support Mobile-Friendly Use

## Team Decisions Captured
- Safety report statuses for Sprint 3:
  - `open`, `in_review`, `resolved`, `closed`
  - Transitions: open → in_review → resolved → closed (Park Admin or Site Admin only for transitions)
- Equipment status values for Sprint 3:
  - `operational`, `needs_repair`, `out_of_service`
- Park Admin assignment: Site Admin can assign/remove Park Admins to/from parks
- Audit log events to capture: admin assignments, moderation actions, safety report status transitions, equipment status changes
- Notification delivery for Sprint 3: in-app notification surface (email delivery deferred to a future sprint)
- Photo storage: Firebase Storage; maximum one photo per upload action per Sprint 3 scope; file type and size validation required before upload
- Review data model: integer rating (1–5 stars), optional text body, one review per user per park enforced at service layer
- Favorites storage: user subcollection under the `users` collection
- Crowd history scope for Sprint 3: last 7 days of crowd-level reports per park; map view uses existing park location coordinates
- Mobile breakpoints: primary responsive target is 375px–768px; desktop behavior unchanged

## Architecture Mapping (MVC + Services)
### New Files Required
- `models/safetyReportModel.js` — Sprint 3 safety/maintenance report shape
- `models/equipmentModel.js` — Equipment record and status shape
- `models/reviewModel.js` — Park review and rating shape
- `models/auditLogModel.js` — Audit log event shape
- `services/notificationService.js` — Notification interface and in-app delivery
- `services/storageService.js` — Photo upload, validation, and Firebase Storage wiring
- `views/admin.html` — Park Admin and Site Admin administration view

### Existing Files Extended
- [models/userModel.js](../models/userModel.js) — Add favorites subcollection references and admin assignment metadata
- [models/parkModel.js](../models/parkModel.js) — Add equipment list references, review aggregates, crowd history reference
- [services/databaseService.js](../services/databaseService.js) — Add service methods for safety reports, equipment, reviews, favorites, crowd history, admin assignment, audit log writes, and moderation
- [controllers/appController.js](../controllers/appController.js) — Extend app orchestration for Sprint 3 workstream actions and notification routing
- [views/dashboard.html](../views/dashboard.html) — Add safety report form, equipment status panel, reviews section, crowd history panel, photo upload affordance, favorites toggle
- [views/profile.html](../views/profile.html) — Add saved favorites list
- [views/admin.html](../views/admin.html) — Park Admin assignment UI, moderation panel, administrative action log
- [styles/main.css](../styles/main.css) — Add responsive layout breakpoints and mobile-friendly overrides
- [constants/reportConstants.js](../constants/reportConstants.js) — Extend with safety report status values, equipment status values, and notification event types
- [constants/authConstants.js](../constants/authConstants.js) — Extend with park-level admin authorization rules

## Phase 1: Foundational Work — Complete First
### Goal
Establish all shared data contracts, authorization rules, service interfaces, and shared components before any workstream feature implementation begins. No workstream should start until all Phase 1 deliverables are accepted.

### Tasks
1. **Database schemas, relationships, and migrations** — Define and document Firestore collection shapes for `safetyReports`, `equipment`, `reviews`, `auditLog`, and `notifications`. Extend `users` with a `favorites` subcollection. Extend `parks` with `equipment`, `reviewAggregate`, and `crowdHistory` references. Document field names, types, and required vs. optional status in the new model files.
2. **Roles and park-level authorization rules** — Extend [constants/authConstants.js](../constants/authConstants.js) with park-level role rules: which roles can transition safety report statuses, manage equipment, assign admins, moderate content, and write audit log entries. Document the rules as constants referenced by controllers and services rather than hardcoded in feature code.
3. **Safety report statuses and workflow transitions** — Add status enum and valid transition map to [constants/reportConstants.js](../constants/reportConstants.js). Implement a shared `canTransition(currentStatus, targetStatus, role)` helper that workstream feature code calls for all state change operations.
4. **Equipment status values** — Add equipment status enum to [constants/reportConstants.js](../constants/reportConstants.js). Define the display labels and allowed transitions for each status value.
5. **Photo storage and upload validation** — Scaffold [services/storageService.js](../services/storageService.js) with a `validatePhoto(file)` method (file type whitelist: JPEG, PNG, WebP; max 5 MB) and an `uploadParkPhoto(parkId, file)` method that writes to Firebase Storage and returns a download URL. Define error types for invalid format and size exceeded.
6. **Audit log events and shared logging service** — Scaffold `models/auditLogModel.js` with the Sprint 3 event types (admin_assigned, admin_removed, content_moderated, user_moderated, safety_status_changed, equipment_status_changed). Add a `logAuditEvent(event)` method to [services/databaseService.js](../services/databaseService.js) used by all workstreams.
7. **Notification interface and delivery method** — Scaffold [services/notificationService.js](../services/notificationService.js) with a `notifyUser(userId, event, payload)` method and an in-app `notifications` Firestore collection writer. Define notification event types for safety report status changes. Email delivery is out of scope for Sprint 3.
8. **Shared responsive UI components** — Add mobile-first responsive layout rules to [styles/main.css](../styles/main.css) for the primary breakpoints (375px, 768px). Define shared card, form, modal, and badge component styles that all workstreams consume rather than each defining their own.
9. **API contracts and acceptance criteria** — Document the expected inputs, outputs, and error behaviors for each new service method in comments at the top of each new model and service file. Acceptance criteria for each workstream are stated in the Definition of Done section below.
10. **Test data and feature branches** — Prepare a Firestore seed script or documented seed steps for `safetyReports`, `equipment`, `reviews`, and `auditLog` collections with at least two parks' worth of Sprint 3 test data. Each workstream should branch from a stable Phase 1 baseline branch.

### Deliverables
- All new model files created with documented field shapes
- Authorization constants and transition helpers in shared constants files
- Storage, notification, and audit log service scaffolds with defined method signatures
- Responsive CSS baseline and shared component styles in place
- API contracts documented in service/model files
- Seed data steps documented and available
- Feature branches ready for parallel workstream work

### Suggested Owners
- Engineer A: Database schemas — safetyReportModel, equipmentModel, reviewModel, auditLogModel; extend userModel and parkModel
- Engineer B: Auth constants and role rules; safety/equipment status enums and transition helpers; storageService scaffold
- Engineer C: notificationService scaffold; logAuditEvent service method; shared responsive CSS baseline; seed data preparation

---

## Phase 2: Parallel Workstreams — Core Development
### Goal
Deliver all Sprint 3 backlog features in parallel workstreams. All workstreams depend on Phase 1 completion and should not begin implementation until Phase 1 deliverables are accepted.

### Dependencies
- Requires completion of all Phase 1 deliverables

---

### Workstream 1 — Safety and Maintenance

#### 2.1 Submit Safety or Maintenance Report
1. Add `createSafetyReport(parkId, userId, reportData)` method to [services/databaseService.js](../services/databaseService.js) using the `safetyReportModel` shape.
2. Add report submission form and handler in [views/dashboard.html](../views/dashboard.html) and [controllers/appController.js](../controllers/appController.js).
3. Gate submission to authenticated users; require park selection and report type (safety or maintenance).
4. Return confirmation feedback on success; display error feedback on failure.

#### 2.2 Manage Safety Reports
1. Add `getSafetyReports(parkId, filters)` and `updateSafetyReportStatus(reportId, newStatus, userId, role)` methods to [services/databaseService.js](../services/databaseService.js).
2. Call `canTransition()` before any status update; reject unauthorized transitions.
3. Call `logAuditEvent()` after each successful status transition.
4. Render a safety report management panel in [views/admin.html](../views/admin.html) visible to Park Admin and Site Admin only.
5. Support filtering the report list by status.

#### 2.3 Manage Equipment Status
1. Add `getEquipment(parkId)`, `createEquipment(parkId, equipmentData)`, and `updateEquipmentStatus(equipmentId, newStatus, userId, role)` methods to [services/databaseService.js](../services/databaseService.js).
2. Call `logAuditEvent()` after each equipment status change.
3. Render an equipment status panel on the park detail area in [views/dashboard.html](../views/dashboard.html) visible to Park Admin and Site Admin.
4. Display equipment status badges using the shared badge component styles.

#### 2.4 Track Safety Report Status and Notifications
1. Wire `notificationService.notifyUser()` calls into `updateSafetyReportStatus()` to send in-app notifications to the original report submitter on each status transition.
2. Add notification read/unread state to the `notifications` collection in Firestore.
3. Render a notification indicator in the shared header area of [views/dashboard.html](../views/dashboard.html) for authenticated users with unread notifications.
4. Render a notification list panel accessible from the indicator.

### Workstream 1 Suggested Owner
- Engineer A

---

### Workstream 2 — Administration

#### 2.5 Assign Park Admins to Parks
1. Add `assignParkAdmin(parkId, targetUserId, assignedByUserId)` and `removeParkAdmin(parkId, targetUserId, removedByUserId)` methods to [services/databaseService.js](../services/databaseService.js).
2. Gate both methods to Site Admin role only.
3. Call `logAuditEvent()` for both assignment and removal.
4. Render a park admin assignment panel in [views/admin.html](../views/admin.html) visible to Site Admin only.
5. Display current Park Admin assignments per park.

#### 2.6 Record Administrative Actions
1. Ensure all administrative actions in Workstreams 1 and 2 call `logAuditEvent()` with the correct event type, actor, target, and timestamp.
2. Add `getAuditLog(filters)` method to [services/databaseService.js](../services/databaseService.js) supporting filter by park, actor, and event type.
3. Render an audit log panel in [views/admin.html](../views/admin.html) visible to Site Admin only.

#### 2.7 Moderate Content and Users
1. Add `moderateReview(reviewId, action, moderatorId)` and `moderateUser(targetUserId, action, moderatorId)` methods to [services/databaseService.js](../services/databaseService.js) supporting `hide` and `reinstate` actions.
2. Gate content moderation to Park Admin (park-scoped reviews) and Site Admin (all reviews and users).
3. Gate user moderation to Site Admin only.
4. Call `logAuditEvent()` for each moderation action.
5. Add a moderation panel to [views/admin.html](../views/admin.html) listing flagged or recent reviews and user actions.

### Workstream 2 Suggested Owner
- Engineer B

---

### Workstream 3 — Community Features

#### 2.8 Submit Park Reviews and Ratings
1. Add `createReview(parkId, userId, reviewData)` and `getReviews(parkId)` methods to [services/databaseService.js](../services/databaseService.js) using the `reviewModel` shape.
2. Enforce one review per user per park at the service layer; return a clear message when a duplicate is attempted.
3. Add `updateReviewAggregate(parkId)` helper that recalculates and writes the average rating to the park record after each new review.
4. Render a review submission form and review list in [views/dashboard.html](../views/dashboard.html) for authenticated users on park detail.
5. Gate review submission to authenticated users; read-only review display is available to all.

#### 2.9 Upload Park Photos
1. Wire `storageService.validatePhoto()` and `storageService.uploadParkPhoto()` into a `submitParkPhoto(parkId, userId, file)` service method in [services/databaseService.js](../services/databaseService.js).
2. Store the returned download URL as an entry in the park's `photos` array in Firestore.
3. Render a photo upload control in [views/dashboard.html](../views/dashboard.html) for authenticated users on park detail.
4. Display validation error feedback for unsupported file types or files exceeding size limits.
5. Render the park photo gallery from the stored URLs.

#### 2.10 Save Favorite Parks
1. Add `addFavorite(userId, parkId)`, `removeFavorite(userId, parkId)`, and `getFavorites(userId)` methods to [services/databaseService.js](../services/databaseService.js) using the user favorites subcollection.
2. Render a favorites toggle (add/remove) on each park detail and search result card in [views/dashboard.html](../views/dashboard.html) for authenticated users.
3. Render the saved favorites list in [views/profile.html](../views/profile.html).

### Workstream 3 Suggested Owner
- Engineer C

---

### Workstream 4 — Crowd Information

#### 2.11 Show Crowd History and Map View
1. Add `getCrowdHistory(parkId, days)` method to [services/databaseService.js](../services/databaseService.js) returning crowd-level reports for the last 7 days.
2. Render a crowd history timeline or bar chart on park detail using the existing busy-level label constants.
3. Add a map view mode to [views/dashboard.html](../views/dashboard.html) that renders park location markers using existing park coordinate data.
4. Display the current busy level badge on each map marker.
5. Map view is read-only; selecting a marker navigates to the park detail.

### Workstream 4 Suggested Owner
- Engineer A (after Workstream 1 features are unblocked or in parallel if capacity allows)

---

### Workstream 5 — Responsive Experience

#### 2.12 Support Mobile-Friendly Use
1. Apply mobile breakpoint overrides in [styles/main.css](../styles/main.css) targeting 375px–768px viewports for all existing and Sprint 3 views.
2. Ensure navigation, search/filter controls, park detail, crowd report form, review form, photo upload, and favorites toggle are usable at mobile widths.
3. Validate that [views/admin.html](../views/admin.html) panels are scrollable and operable on mobile for Park Admin and Site Admin use cases.
4. Test across [views/home.html](../views/home.html), [views/dashboard.html](../views/dashboard.html), [views/profile.html](../views/profile.html), [views/login.html](../views/login.html), and [views/admin.html](../views/admin.html).
5. Responsive work can be done in parallel with other workstreams and merged last to avoid CSS conflicts.

### Workstream 5 Suggested Owner
- Engineer C (after Workstream 3 UI surfaces are stable, or in a coordinated pass with the team)

---

### Phase 2 Deliverables
- Safety and maintenance report submission, management, and status tracking with notifications
- Equipment status management with audit logging
- Park Admin assignment, audit log viewer, and moderation controls in admin view
- Park reviews and ratings with aggregation
- Park photo upload with validation
- Saved favorites in user profile
- Crowd history and map view on park detail
- Mobile-responsive layout across all views

---

## Phase 3: Integration Across Workstreams
### Goal
Merge parallel workstream outputs into a unified, coherent end-to-end user experience and verify cross-workstream data consistency.

### Dependencies
- Requires all Phase 2 workstreams to be complete or code-complete

### Tasks
1. Integrate notification surface (Workstream 1) with auth state so notifications only load for authenticated users; verify notification dismissal and read state updates in [controllers/appController.js](../controllers/appController.js).
2. Integrate moderation state (Workstream 2) with review rendering (Workstream 3) so that hidden reviews are suppressed in the review list without requiring a page reload.
3. Integrate review aggregate updates (Workstream 3) with park detail rendering to confirm ratings display correctly after a new review is submitted.
4. Validate favorites toggle (Workstream 3) state is consistent between park detail view and profile favorites list without double-fetch.
5. Integrate crowd history data (Workstream 4) with the map view marker rendering to confirm busy-level badges reflect the same data as the detail panel.
6. Validate responsive layout (Workstream 5) across all integrated views and confirm no layout regressions from Sprint 2 or Sprint 3 feature additions.
7. Validate audit log entries (Workstream 2) are created correctly for actions from Workstreams 1, 2, and 3.
8. Validate consistent error handling and user feedback across all new service methods and controller actions.

### Deliverables
- Unified Sprint 3 behavior across all five workstreams
- Consistent role and auth gating across all new views and panels
- Cross-workstream data consistency confirmed
- No Sprint 2 regressions introduced

### Suggested Owners
- Engineer A: Notification and crowd-history integration checks
- Engineer B: Moderation-to-review integration; audit log verification
- Engineer C: Review aggregate, favorites, and responsive regression checks

---

## Phase 4: Stabilization and Sprint Acceptance
### Goal
Validate all backlog items against acceptance criteria, harden behavior, and confirm no cross-sprint regressions.

### Tasks
1. Add Sprint 3 acceptance and setup notes to [README.md](../README.md).
2. Execute role-path validation for Parent, Park Admin, and Site Admin across all Sprint 3 surfaces.
3. Run regression checks covering Sprint 1 and Sprint 2 capabilities.
4. Validate Firestore security rules support all new collections: `safetyReports`, `equipment`, `reviews`, `auditLog`, `notifications`, favorites subcollection, and Storage upload paths.
5. Standardize failure messages for:
   - Unauthorized status transitions (safety reports, equipment)
   - Unauthorized admin or moderation actions
   - Duplicate review submissions
   - Invalid or oversized photo uploads
   - Notification delivery failures

### Deliverables
- Sprint acceptance checklist complete
- Documented setup and behavior expectations in README
- Stable cross-sprint behavior and role-gated feature paths
- Firestore rules verified for all Sprint 3 collections

### Suggested Owners
- Engineer A: Safety report and equipment acceptance; notification delivery checks
- Engineer B: Admin, moderation, and audit log acceptance; Firestore rules review
- Engineer C: Community features acceptance (reviews, photos, favorites); responsive and regression checks

---

## Parallelization Guidance
- Phase 1 is the shared blocker. No workstream work should begin until Phase 1 is complete and a stable baseline branch exists.
- After Phase 1, run these workstreams in parallel:
  - Workstream 1 (Safety and Maintenance): Workstreams 1.1 → 1.2 → 1.3 → 1.4 in sequence within the workstream
  - Workstream 2 (Administration): Workstreams 2.5, 2.6, and 2.7 can be sequenced within the workstream; 2.6 requires 2.5 audit events to be wired first
  - Workstream 3 (Community Features): Workstreams 2.8, 2.9, and 2.10 are independent within the workstream and can be parallelized further if capacity allows
  - Workstream 4 (Crowd Information): Independent of Workstreams 1–3; can proceed as soon as Phase 1 data contracts are ready
  - Workstream 5 (Responsive Experience): Can begin CSS baseline work during Phase 1 and integrate UI-level responsive passes after each workstream stabilizes its views
- Phase 3 integration should not begin until all workstreams have code-complete implementations.
- Phase 4 acceptance should not begin until Phase 3 integration is validated.

---

## Definition of Done by Backlog Item
1. **Submit Safety or Maintenance Report**: authenticated user can submit a report for a selected park with type, description, and timestamp; submission is confirmed or returns an error message.
2. **Manage Safety Reports**: Park Admin and Site Admin can view, filter, and transition safety report statuses; unauthorized transitions are blocked; transitions are logged in the audit log.
3. **Manage Equipment Status**: Park Admin and Site Admin can view and update equipment status for a park; changes are logged in the audit log.
4. **Track Safety Report Status and Notifications**: report submitter receives an in-app notification when their report status changes; notification shows read/unread state.
5. **Assign Park Admins to Parks**: Site Admin can assign and remove Park Admins; assignment and removal are logged in the audit log.
6. **Record Administrative Actions**: all administrative actions produce a timestamped audit log entry visible to Site Admin.
7. **Moderate Content and Users**: Park Admin can hide/reinstate park-scoped reviews; Site Admin can hide/reinstate any review and moderate users; all actions are logged.
8. **Submit Park Reviews and Ratings**: authenticated user can submit a 1–5 star rating with optional text for a park; duplicate reviews are blocked; park average rating updates after submission.
9. **Upload Park Photos**: authenticated user can upload one JPEG/PNG/WebP photo (≤ 5 MB) to a park; invalid files are rejected with clear feedback; uploaded photo appears in the park gallery.
10. **Save Favorite Parks**: authenticated user can add/remove a park from favorites; favorites list is accessible from the user profile.
11. **Show Crowd History and Map View**: park detail shows 7-day crowd history; map view renders park markers with current busy-level badges; selecting a marker navigates to park detail.
12. **Support Mobile-Friendly Use**: all primary user flows are usable at 375px–768px viewport widths; no content is truncated or inaccessible on mobile.

---

## Verification Checklist

### Safety and Maintenance
- Authenticated user can submit a safety report and receives confirmation.
- Authenticated user can submit a maintenance report and receives confirmation.
- Park Admin can transition a report from `open` → `in_review` → `resolved` → `closed`.
- Parent cannot transition report status.
- Report status transitions are recorded in the audit log.
- Report submitter receives an in-app notification on status transition.
- Notification shows unread indicator; marks as read on view.

### Equipment
- Park Admin can view equipment list for a park.
- Park Admin can update equipment status to `operational`, `needs_repair`, or `out_of_service`.
- Equipment status changes are recorded in the audit log.
- Parent cannot update equipment status.

### Administration
- Site Admin can assign a user as Park Admin for a specific park.
- Site Admin can remove a Park Admin assignment.
- Assignment and removal are recorded in the audit log.
- Audit log is visible to Site Admin and inaccessible to Parent and Park Admin.
- Site Admin can hide and reinstate any review.
- Park Admin can hide and reinstate reviews scoped to their park.
- Site Admin can moderate (disable/reinstate) a user account.
- Moderation actions are recorded in the audit log.

### Community Features
- Authenticated user can submit a 1–5 star review for a park.
- Duplicate review by the same user for the same park is blocked with a clear message.
- Park average rating updates after a new review is submitted.
- Authenticated user can upload a JPEG, PNG, or WebP photo under 5 MB.
- Files exceeding 5 MB are rejected with an error message.
- Unsupported file types are rejected with an error message.
- Uploaded photo appears in the park's photo gallery.
- Authenticated user can add a park to favorites from detail view or search result card.
- Authenticated user can remove a park from favorites.
- Favorites list is visible in the user profile view.

### Crowd Information
- Park detail shows a 7-day crowd history panel.
- Map view renders park markers with busy-level badges.
- Selecting a map marker navigates to park detail.

### Responsive Experience
- All primary flows (search, filter, detail, report submission, reviews, photo upload, favorites) are usable at 375px.
- Navigation and forms are accessible at 768px.
- Admin panels are scrollable and operable on mobile for authorized roles.

### Regression
- Sprint 1 flows remain functional: login/logout, role access, search/filter, park detail, create/edit records.
- Sprint 2 flows remain functional: forgot password, account security, crowd reporting, busy-level display, efficient search, profile management.
- Navigation from [index.html](../index.html) continues to work across all views.

---

## Risks and Mitigations
- Risk: Phase 1 contracts are incomplete when workstreams branch, causing mid-sprint model drift.
  - Mitigation: Treat Phase 1 as a hard gate; do not merge workstream branches until Phase 1 baseline is accepted by the team.
- Risk: Five parallel workstreams introduce style conflicts in [styles/main.css](../styles/main.css).
  - Mitigation: Workstream 5 owns the CSS baseline; other workstreams use defined component classes and avoid introducing conflicting rules.
- Risk: Firestore security rules are not updated to cover new collections before sprint acceptance.
  - Mitigation: Assign Firestore rule review as a Phase 4 gate item with a dedicated owner.
- Risk: Notification delivery creates performance concerns if unread count is fetched on every page load.
  - Mitigation: Use a real-time Firestore listener scoped to the authenticated user rather than polling.
- Risk: Photo uploads fail silently if Firebase Storage rules are not configured.
  - Mitigation: Validate Storage upload path rules in Phase 1 alongside the storageService scaffold.
- Risk: Audit log growth is unbounded and may affect query performance over time.
  - Mitigation: Scope audit log reads to filtered queries in all service methods; do not support full-collection reads.

## Out of Scope for Sprint 3
- Email notification delivery
- Multi-photo upload per park action
- Review editing or deletion by the submitter
- Crowd report data older than 7 days in history view
- Advanced search filtering by review rating or equipment status
- Non-English locale support
