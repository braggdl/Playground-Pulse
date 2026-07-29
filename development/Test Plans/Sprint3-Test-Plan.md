# Sprint 3 Test Plan

## Objective
Validate all 12 Sprint 3 backlog items across safety/maintenance reporting, equipment management, administration, community features (reviews, photos, favorites), crowd history, map view, and mobile-responsive layout — without regressing Sprint 1 or Sprint 2 capabilities.

## Scope
In scope:
1. Submit safety or maintenance report.
2. Manage safety reports (view, filter, transition statuses).
3. Manage equipment status.
4. Track safety report status with in-app notifications.
5. Assign Park Admins to parks.
6. Record administrative actions (audit log).
7. Moderate content and users.
8. Submit park reviews and ratings.
9. Upload park photos.
10. Save favorite parks.
11. Show crowd history and map view.
12. Support mobile-friendly use.
13. Sprint 1 and Sprint 2 regression smoke paths.

Out of scope:
1. Email notification delivery.
2. Multi-photo upload per park action.
3. Review editing or deletion by the submitter.
4. Crowd report data older than 7 days.
5. Advanced search filtering by review rating or equipment status.

## Test Environment
1. Local static server (for example VS Code Live Server).
2. Firebase Authentication enabled with Email/Password and password-reset.
3. Firestore enabled with all Sprint 3 collections: `safetyReports`, `equipment`, `reviews`, `auditLog`, `notifications`, and `users/{userId}/favorites` subcollection.
4. Firebase Storage enabled with upload rules permitting authenticated writes to `parks/{parkId}/photos/`.
5. Composite Firestore index active on `crowdReports`: `parkId ASC, reportedAt ASC`.
6. Firestore security rules configured for all Sprint 3 collections before executing acceptance tests.

## Test Data Setup
Use the shared seed identifiers from `development/sprint3-seed-data.md`.

### Users
| Role | userId | Email |
|---|---|---|
| Parent | `user-parent-001` | alex.parent@test.com |
| Park Admin | `user-parkadmin-001` | jordan.admin@test.com |
| Site Admin | `user-siteadmin-001` | sam.siteadmin@test.com |

Park Admin `user-parkadmin-001` must have `assignedParks: ["park-test-001"]` in their Firestore user record.

### Parks
| Park | parkId |
|---|---|
| Riverside Playground | `park-test-001` |
| Hilltop Play Area | `park-test-002` |

### Sprint 3 Collection Seed
1. At least two `safetyReports` per park in `open` status, authored by `user-parent-001`.
2. At least two `equipment` records per park, one in each status (`operational`, `needs_repair`, `out_of_service`).
3. At least one `reviews` record for `park-test-001` authored by a secondary test user (to verify duplicate enforcement for `user-parent-001`).
4. At least one `crowdReports` entry per park within the last 7 days.

## Entry Criteria
1. App loads from local server with valid Firebase configuration.
2. All three test users can authenticate.
3. Firestore indexes, rules, and Storage rules are confirmed before test execution begins.
4. Sprint 3 seed data is available in Firestore.

## Exit Criteria
1. All Sprint 3 must-have test cases executed.
2. No open critical defects.
3. No open high defects on Sprint 3 core paths.
4. All Sprint 1 and Sprint 2 regression smoke tests pass.
5. Residual medium/low defects documented with owner and next step.

---

## Test Cases

### A. Safety and Maintenance Reporting

**A1. Submit safety report (authenticated Parent)**
1. Log in as `user-parent-001`.
2. Search for and select `park-test-001`.
3. Choose type `Hazard`, enter a description, and submit.
Expected:
1. Confirmation message shown.
2. Report appears in the safety report list with status `open`.

**A2. Submit maintenance report (authenticated Parent)**
1. Log in as `user-parent-001`.
2. Select a park.
3. Choose type `Maintenance`, enter a description, and submit.
Expected:
1. Confirmation message shown.
2. Report appears in the list with status `open`.

**A3. Submit report — auth gate**
1. Sign out.
2. Open a park detail and attempt to submit a safety report.
Expected:
1. Submission is blocked.
2. Auth-required feedback shown or form is not rendered.

**A4. Park Admin transitions report open → in_review**
1. Log in as `user-parkadmin-001`.
2. Select `park-test-001`.
3. Locate an `open` report and click `Mark in_review`.
Expected:
1. Status updates to `in_review`.
2. Transition button removed; `Mark resolved` button appears.

**A5. Full transition chain: open → in_review → resolved → closed (Park Admin)**
1. Log in as `user-parkadmin-001`.
2. Transition a report through all four statuses in sequence.
Expected:
1. Each transition succeeds.
2. Status badge updates at each step.
3. Audit log records a `safety_status_changed` entry for each transition.

**A6. Parent cannot transition report status**
1. Log in as `user-parent-001`.
2. Open a park with `open` safety reports.
Expected:
1. No transition buttons rendered for the Parent role.

**A7. Status filter**
1. Log in as `user-parkadmin-001`.
2. Select a park.
3. Apply each status filter (`open`, `in_review`, `resolved`, `closed`) in turn.
Expected:
1. Report list updates to show only reports matching the selected status.

---

### B. Equipment Management

**B1. Park Admin views equipment list**
1. Log in as `user-parkadmin-001`.
2. Select `park-test-001`.
Expected:
1. Equipment items listed with name, type, and status badge.

**B2. Park Admin updates equipment status**
1. Log in as `user-parkadmin-001`.
2. Select an equipment item and change status to `needs_repair`.
Expected:
1. Status badge updates.
2. Audit log records an `equipment_status_changed` entry.

**B3. All three status values cycle correctly**
1. Log in as `user-parkadmin-001`.
2. Transition one item through `operational` → `needs_repair` → `out_of_service` → `operational`.
Expected:
1. Each transition succeeds and badge label matches the value.

**B4. Parent cannot update equipment status**
1. Log in as `user-parent-001`.
2. Select a park.
Expected:
1. No equipment status transition controls rendered.

**B5. Add new equipment record (Park Admin)**
1. Log in as `user-parkadmin-001`.
2. Select a park, enter a name and type, and submit the Add Equipment form.
Expected:
1. New item appears in the equipment list.
2. Default status is `Operational`.

---

### C. In-App Notifications

**C1. Report submitter receives notification on status transition**
1. Log in as `user-parent-001` and submit a safety report for `park-test-001`.
2. Log out. Log in as `user-parkadmin-001`.
3. Transition the report to `in_review`.
4. Log out. Log in as `user-parent-001`.
Expected:
1. Notifications button in dashboard header shows an unread badge count of 1 or more.
2. Clicking Notifications shows the status-change notification.

**C2. Notification shows unread state and marks as read**
1. Log in as a user with an unread notification.
2. Open the notification panel.
3. Click `Mark as read` on an unread notification.
Expected:
1. Notification no longer shows the unread indicator.
2. Unread badge count decrements.

**C3. Authenticated Parent sees notification toggle**
1. Log in as `user-parent-001`.
Expected:
1. Notifications button is visible in the dashboard header.

**C4. Signed-out user does not see notification toggle**
1. Sign out and open the dashboard.
Expected:
1. Notifications button is not rendered.

---

### D. Administration — Park Admin Assignment

**D1. Site Admin assigns Park Admin**
1. Log in as `user-siteadmin-001`.
2. Open `views/admin.html`.
3. Enter `park-test-002` and `user-parent-001` in the Assign Park Admins form and submit.
Expected:
1. Success message shown.
2. `user-parent-001` `assignedParks` array now includes `park-test-002` in Firestore.
3. Audit log records an `admin_assigned` entry.

**D2. Site Admin removes Park Admin assignment**
1. Log in as `user-siteadmin-001`.
2. Enter the same park and user in the form and click Remove.
Expected:
1. Success message shown.
2. `user-parent-001` `assignedParks` no longer includes `park-test-002`.
3. Audit log records an `admin_removed` entry.

**D3. Park Admin cannot access assignment panel**
1. Log in as `user-parkadmin-001`.
2. Open `views/admin.html`.
Expected:
1. Assignment panel is not rendered.

---

### E. Administration — Audit Log

**E1. Site Admin loads audit log with park filter**
1. Log in as `user-siteadmin-001`.
2. Open the Audit Log panel, enter `park-test-001` as the park filter, and submit.
Expected:
1. Audit log entries for `park-test-001` are shown.
2. Entries include `actorId`, `targetId`, `eventType`, `parkId`, and `timestamp`.

**E2. Audit log requires at least one filter**
1. Log in as `user-siteadmin-001`.
2. Submit the audit log form with all fields empty.
Expected:
1. Error message shown: at least one filter is required.
2. No entries returned.

**E3. Park Admin cannot access audit log panel**
1. Log in as `user-parkadmin-001`.
2. Open `views/admin.html`.
Expected:
1. Audit Log panel is not rendered.

---

### F. Administration — Content and User Moderation

**F1. Park Admin hides a review for assigned park**
1. Log in as `user-parkadmin-001`.
2. Open `views/admin.html`, enter a review ID for `park-test-001`, select `hide`, and submit.
Expected:
1. Success message shown.
2. The review's `hidden` field is `true` in Firestore.
3. Audit log records a `content_moderated` entry.
4. Review no longer appears in the park's public review list.

**F2. Park Admin blocked from moderating reviews outside assigned park**
1. Log in as `user-parkadmin-001`.
2. Attempt to hide a review belonging to `park-test-002` (unassigned).
Expected:
1. Action is blocked with a clear error message.

**F3. Site Admin reinstates a hidden review**
1. Log in as `user-siteadmin-001`.
2. Enter the same review ID, select `reinstate`, and submit.
Expected:
1. Review's `hidden` field is `false` in Firestore.
2. Review reappears in the public list.

**F4. Site Admin moderates a user account**
1. Log in as `user-siteadmin-001`.
2. Open the Moderate Users section, enter `user-parent-001`, select `disable`, and submit.
Expected:
1. Success message shown.
2. `user-parent-001` `disabled` field is `true` in Firestore.
3. Audit log records a `user_moderated` entry.

**F5. Park Admin cannot access user moderation section**
1. Log in as `user-parkadmin-001`.
2. Open `views/admin.html`.
Expected:
1. Moderate Users section is not rendered.

---

### G. Park Reviews and Ratings

**G1. Authenticated user submits a review**
1. Log in as `user-parent-001`.
2. Open a park with no prior review from this user.
3. Select 4 stars and enter a comment, then submit.
Expected:
1. Review appears in the list immediately.
2. Park average rating updates to reflect the new review.

**G2. Duplicate review is blocked**
1. Log in as `user-parent-001` (who already has a review for `park-test-001`).
2. Attempt to submit another review for the same park.
Expected:
1. Submission is blocked.
2. Clear duplicate-review message shown.

**G3. Average rating updates after submission**
1. Note the current average and review count for a park.
2. Submit a new review.
Expected:
1. Average rating in park detail header updates immediately.
2. Review count increments by 1.

**G4. Read-only review display for unauthenticated users**
1. Sign out.
2. Open a park detail.
Expected:
1. Existing reviews are visible.
2. Review submission form is not shown (sign-in prompt shown instead).

**G5. Rating validation (1–5 stars only)**
1. Confirm the rating dropdown only offers values 1 through 5.
Expected:
1. No value outside the 1–5 range is selectable.

---

### H. Park Photo Upload

**H1. Authenticated user uploads a valid JPEG**
1. Log in as `user-parent-001`.
2. Open a park detail.
3. Select a JPEG file under 5 MB and upload.
Expected:
1. Success message shown.
2. Photo appears in the park gallery immediately.

**H2. Unsupported file type rejected**
1. Attempt to upload a `.gif` or `.pdf` file.
Expected:
1. Upload blocked before submission.
2. Specific error message: unsupported file type.

**H3. File exceeding 5 MB rejected**
1. Attempt to upload an image file over 5 MB.
Expected:
1. Upload blocked.
2. Specific error message: file exceeds 5 MB limit.

**H4. Upload control not shown for unauthenticated users**
1. Sign out and open a park detail.
Expected:
1. Photo upload form is not shown (sign-in prompt shown instead).
2. Existing gallery photos are still visible.

---

### I. Favorite Parks

**I1. Authenticated user adds a park to favorites**
1. Log in as `user-parent-001`.
2. Open a park detail.
3. Click the heart (♡) toggle.
Expected:
1. Toggle becomes active.
2. Favorite entry created in `users/user-parent-001/favorites` in Firestore.

**I2. Authenticated user removes a park from favorites**
1. Click the active heart toggle on a favorited park.
Expected:
1. Toggle returns to inactive state.
2. Favorite entry removed from Firestore.

**I3. Favorites list shows park names in profile**
1. Log in as `user-parent-001` (with at least one saved favorite).
2. Open `views/profile.html`.
Expected:
1. Saved Favorites section shows the park name (not a raw ID).
2. Saved date is shown for each favorite.

**I4. Favorites toggle not shown for unauthenticated users**
1. Sign out and open a park detail.
Expected:
1. Heart toggle is not rendered.

---

### J. Crowd History and Map View

**J1. Park detail shows 7-day crowd history panel**
1. Log in and open a park that has seeded crowd reports.
2. Scroll to the crowd history section.
Expected:
1. Bar chart shows 7 columns (one per day).
2. Each column shows a report count and a date label.
3. Bars with zero reports show a minimum height.

**J2. Map view renders park markers**
1. Log in and run a search to populate park results.
2. Click `Map View`.
Expected:
1. Map renders centered on returned parks.
2. Each park with coordinates shows a circle marker.
3. Marker color reflects the park's busy level.

**J3. Map marker shows busy-level badge in popup**
1. Click a map marker.
Expected:
1. Popup shows park name, location, and busy-level label.
2. Busy-level label matches the label shown in the park detail panel.

**J4. Selecting a map marker navigates to park detail**
1. Click a marker popup `Open Detail` button.
Expected:
1. Park detail panel opens.
2. Map view closes or stays open depending on state.

**J5. Map view is read-only**
1. Open map view.
Expected:
1. No create/edit or report submission controls are active within the map view.

---

### K. Responsive Experience

**K1. Dashboard usable at 375px**
1. Open `views/dashboard.html` with viewport set to 375px width.
Expected:
1. Search input, filter controls, park result cards, and navigation are fully accessible.
2. No content is clipped or overlapping.

**K2. Park detail usable at 375px**
1. At 375px, open a park detail panel.
Expected:
1. Safety report form, equipment panel, review form, photo upload, and favorites toggle are usable.
2. Crowd history chart is visible and scrollable if needed.

**K3. Admin view scrollable and operable at 375px (Park Admin)**
1. Log in as `user-parkadmin-001` and open `views/admin.html` at 375px.
Expected:
1. Moderation panel and safety/equipment management panels are scrollable.
2. Form controls are tap-accessible.

**K4. Admin view scrollable and operable at 375px (Site Admin)**
1. Log in as `user-siteadmin-001` and open `views/admin.html` at 375px.
Expected:
1. Assignment, moderation, and audit log panels are scrollable.
2. No panel is hidden or unreachable.

**K5. Navigation and forms accessible at 768px**
1. Open each view (`home.html`, `dashboard.html`, `profile.html`, `login.html`, `views/admin.html`) at 768px.
Expected:
1. All navigation links and primary form inputs are fully visible and usable.
2. No layout regressions from Sprint 2 or Sprint 3 additions.

---

### L. Regression — Sprint 1 and Sprint 2 Smoke

**L1. Authentication lifecycle (Sprint 1)**
1. Register a new user, log out, and log back in.
Expected:
1. All three actions succeed with correct feedback.

**L2. Role-based access (Sprint 1)**
1. Log in as `user-parent-001` and confirm admin mutation controls are absent.
2. Log in as `user-parkadmin-001` and confirm create/edit park controls are present.
Expected:
1. Role gates are enforced in both cases.

**L3. Search, filter, and park detail (Sprint 1)**
1. Use text search, apply filters, and open a park detail.
Expected:
1. Search and filter behavior is unchanged.
2. Park detail renders all Sprint 1 and Sprint 2 fields.

**L4. Forgot-password flow (Sprint 2)**
1. Open `views/login.html` and use Forgot Password with a known email.
Expected:
1. Safe success feedback is shown.

**L5. Crowd reporting and busy-level display (Sprint 2)**
1. Submit a crowd report for a park.
2. Confirm busy-level badge updates in the park detail and in result cards.
Expected:
1. Submission succeeds.
2. Badge label reflects the submitted level.

**L6. Profile display-name update (Sprint 2)**
1. Log in, open profile, and update the display name.
Expected:
1. Update persists.
2. UI re-renders the updated name.

**L7. Navigation from index.html**
1. Open `views/index.html` and follow all navigation links.
Expected:
1. All links resolve to the correct views.
2. No 404 or broken navigation paths.

---

## Defect Severity Guide
1. Critical: security bypass, data loss, or app unusable.
2. High: core Sprint 3 feature blocked.
3. Medium: feature degraded with workaround available.
4. Low: non-blocking UX issue.

## Defect Log Template
1. ID
2. Title
3. Severity
4. Environment
5. Steps to Reproduce
6. Expected Result
7. Actual Result
8. Role/User Used
9. Screenshot/Notes
10. Owner
11. Status

## Sign-Off
1. QA/Test Owner:
2. Engineering Owner:
3. Date:
4. Final Decision: Pass / Conditional Pass / Fail
