# Playground-Pulse
A kid-friendly park finder.

# Team Members
Group Corktown: Danny Bragg, Brandon Schwartz, and May Wu

# Course
CSSE5150

# Project Description
For parents and caregivers, planning an outdoor outing can be challenging because standard mapping tools (like Google Maps) lack specific, child-friendly details. Caregivers often do not know if a park has age-appropriate equipment (such as toddler swings versus steep climbing structures), critical safety fencing, operational restrooms, or if it is currently overcrowded or undergoing maintenance. This information gap frequently leads to wasted trips, safety concerns, and frustrated children.

Playground Pulse: A Kid-Friendly Park Finder is a web-based, community-driven park finder application designed to solve this problem by providing detailed, real-time insights into local playgrounds. Utilizing three distinct user roles (Parent, Park Admin, and Site Admin) and a persistent relational database, the system allows parents to search and filter parks with granular criteria, report current crowd levels, and submit safety or maintenance concerns. This empowers families to make informed decisions before leaving the house, ensuring a safer, more predictable, and highly enjoyable outdoor experience.

## Core Functionality
1. User authentication with registration, login, and logout.
2. Forgot-password recovery flow with reset email support.
3. Role-aware experience for Parent, Park Admin, and Site Admin users.
4. Park search by text (name/location).
5. Child-friendly park filtering by:
   - Age group (toddler, kid, teen)
   - Fenced area
   - Restrooms
   - Shade availability
   - Maintenance status
6. Park detail view with location, safety notes, amenities notes, and feature summary.
7. Park creation and editing for authorized admin roles.
8. Crowd-level reporting with duplicate-window protection (one report per user per park per hour).
9. Busy-level display in search cards and park detail based on reports in the latest 60 minutes.
10. Profile management for display-name updates and password change with reauthentication.
11. Safety and maintenance report submission with status tracking for authenticated users.
12. Equipment status management for park admin roles.
13. In-app notifications for report status changes.
14. Park review and star-rating submission with per-user duplicate enforcement.
15. Park photo upload with file type and size validation.
16. Favorite park saving and retrieval from user profile.
17. 7-day crowd history trend panel on park detail.
18. Map view with park location markers and busy-level badges.
19. Administration console for Site Admin and Park Admin workflows.

## User Roles
1. Parent: browse, search, filter, and view park details.
2. Park Admin: parent capabilities plus create/edit park records.
3. Site Admin: parent capabilities plus create/edit park records.

## Usage

### Start The App Locally
1. Open this project in VS Code.
2. Run a local static server from the project root (for example, VS Code Live Server).
3. Open `views/index.html` or `views/login.html` in your browser.

### Typical User Flow
1. Open `views/login.html` and sign in or register.
2. Go to Dashboard to search and filter parks.
3. Select a park to open its detail section and submit crowd level if signed in.
4. If your role is Park Admin or Site Admin, create or edit park records from the dashboard controls.
5. Open Profile to review account details, edit display name, or change password.
6. Open `views/admin.html` for administration tools (role-gated):
   - Site Admin: assign/remove Park Admins, moderate reviews/users, view audit log
   - Park Admin: moderate reviews for assigned parks

### Safety and Maintenance Reports
1. Open a park detail panel from Dashboard.
2. Submit a safety or maintenance report with type and description (authenticated users only).
3. Park Admin and Site Admin can view, filter by status, and transition report statuses from the dashboard safety panel and from `views/admin.html`.
4. Report submitters receive an in-app notification on each status transition.
5. Click the Notifications button in the header to view and mark notifications as read.

### Equipment Status
1. Park Admin and Site Admin can view and update equipment status for a park from the dashboard equipment panel.
2. Equipment status values: `Operational`, `Needs Repair`, `Out of Service`.
3. Status changes are recorded in the audit log.

### Reviews and Photos
1. Open a park detail panel and scroll to the Community section.
2. Submit a 1–5 star review with optional comments (authenticated users; one review per user per park).
3. Upload a JPEG, PNG, or WebP photo under 5 MB (authenticated users only).
4. Photos appear in the park gallery immediately after upload.

### Favorite Parks
1. Click the heart (♡) toggle in a park detail panel to save or remove a park from favorites.
2. Open Profile to view the Saved Favorites list with park names and saved dates.

### Crowd History and Map View
1. Open a park detail panel to see the 7-day crowd trend bar chart.
2. Click `Map View` on Dashboard to see park location markers with busy-level badges.
3. Click a map marker popup to open a park's full detail panel.

### Administration Console
1. Open `views/admin.html` for administration tools (role-gated):
   - Site Admin: assign/remove Park Admins, moderate reviews/users, view audit log, manage safety reports and equipment for any park
   - Park Admin: moderate reviews for assigned parks, manage safety reports and equipment for assigned parks

### Account Recovery And Profile Security
1. Use the `Forgot password?` action on `views/login.html` to request a reset email.
2. Profile password changes require current-password reauthentication.
3. Password policy requires:
   - minimum length
   - uppercase letter
   - lowercase letter
   - number

### Crowd Reporting And Busy Level
1. Open a park detail panel from Dashboard.
2. Submit crowd level from 1 (Low) to 4 (Very Busy).
3. Duplicate reports are blocked inside the same one-hour window per user and park.
4. Busy level is computed from recent reports in the last 60 minutes using recency-weighted averaging and mapped to `Low`, `Moderate`, `Busy`, and `Very Busy`.

### Search And Filter
1. Use the dashboard search box for name/location text.
2. Apply one or multiple filters.
3. Use Clear Filters to reset discovery criteria.
4. Use `Load more parks` to paginate through result sets.

### Park Detail And Management
1. Click a park card to open detail information.
2. Admin roles can open create/edit park forms from dashboard/detail actions.
3. Save changes to update park records.

## Firebase Configuration
1. Set Firebase project values in `services/firebase-config.js`.
2. Enable Email/Password sign-in in Firebase Authentication.
3. Enable password-reset support in Firebase Authentication.
4. Ensure Firestore is enabled and configured for your environment.
5. Use `users` and `parks` collections for core app data.
6. Ensure `crowdReports` collection is available for Sprint 2 crowd-report features.
7. Ensure Sprint 3 collections are available: `safetyReports`, `equipment`, `reviews`, `auditLog`, `notifications`.
8. Ensure Firebase Storage is enabled for park photo uploads under `parks/{parkId}/photos/`.
9. Create a composite Firestore index on the `crowdReports` collection: `parkId ASC, reportedAt ASC` (required by the 7-day crowd history query).
10. Seed `users` collection with test users including `assignedParks` array and role fields per `development/sprint3-seed-data.md`.

## Sprint 2 Acceptance and Setup Notes
1. Confirm route protection works for `dashboard.html` and `profile.html` when signed out.
2. Confirm forgot-password flow is reachable from `views/login.html` and returns safe feedback.
3. Confirm weak passwords are rejected for registration and password changes.
4. Confirm profile display-name updates persist and password change requires current-password reauthentication.
5. Confirm crowd reports can be submitted by authenticated users only.
6. Confirm duplicate crowd reports are blocked per user/park/hour with a clear message.
7. Confirm busy-level badges render in both search result cards and park detail views.
8. Confirm search/filter pagination (`Load more parks`) behaves correctly with loading/empty/error states.
9. Validate role paths for Parent, Park Admin, and Site Admin against expected permissions.
10. Use `development/Test Plans/Sprint2-Test-Plan.md` as the execution checklist and sign-off artifact.

## Sprint 3 Acceptance and Setup Notes
1. Confirm Firestore collections exist and security rules are configured for `safetyReports`, `equipment`, `reviews`, `auditLog`, `notifications`, and the `users/{userId}/favorites` subcollection.
2. Confirm Firebase Storage rules permit authenticated uploads to `parks/{parkId}/photos/`.
3. Confirm the composite Firestore index on `crowdReports (parkId ASC, reportedAt ASC)` is active before running crowd history tests.
4. Seed test data using `development/sprint3-seed-data.md` identifiers before executing the Sprint 3 test plan.
5. Confirm authenticated users of all roles can submit safety and maintenance reports and receive in-app notifications on status transitions.
6. Confirm Park Admin and Site Admin can transition safety report statuses and update equipment status; Parent role is blocked from both.
7. Confirm Site Admin can assign/remove Park Admins, view the audit log, and moderate any review or user account.
8. Confirm Park Admin can moderate only reviews scoped to assigned parks; audit log and user moderation are inaccessible.
9. Confirm duplicate review submissions are blocked with a clear message.
10. Confirm photo uploads validate file type (JPEG, PNG, WebP) and size (≤ 5 MB); invalid uploads return specific error messages.
11. Confirm favorites toggle persists across sessions and the profile Saved Favorites list shows park names.
12. Validate responsive layout at 375px and 768px viewports across all five views.
13. Use `development/Test Plans/Sprint3-Test-Plan.md` as the execution checklist and sign-off artifact.
14. Validate Sprint 1 and Sprint 2 regression smoke paths remain functional after Sprint 3 changes.

```text
Playground-Pulse/
|-- assets/
|-- constants/
|   |-- authConstants.js
|   |-- reportConstants.js
|   |-- searchConstants.js
|-- controllers/
|   |-- appController.js
|   |-- authController.js
|-- development/
|   |-- Sprint Implementation Plans/
|   |-- Test Plans/
|   |-- sprint3-seed-data.md
|   |-- AI_Status_Updates.md
|-- models/
|   |-- auditLogModel.js
|   |-- equipmentModel.js
|   |-- parkModel.js
|   |-- reviewModel.js
|   |-- safetyReportModel.js
|   |-- userModel.js
|-- services/
|   |-- authService.js
|   |-- databaseService.js
|   |-- firebase-config.js
|   |-- notificationService.js
|   |-- storageService.js
|-- styles/
|   |-- main.css
|-- views/
|   |-- admin.html
|   |-- dashboard.html
|   |-- home.html
|   |-- index.html
|   |-- login.html
|   |-- profile.html
|-- README.md
```

## Folder Purpose
1. `views`: HTML pages and UI markup.
2. `controllers`: Event handling and page coordination.
3. `services`: Firebase auth and Firestore access.
4. `models`: Shared data shapes and defaults.
5. `styles`: Shared CSS styling.
6. `development`: planning docs and supporting sprint artifacts.
