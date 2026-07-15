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

## Project Folder Structure
```text
Playground-Pulse/
|-- assets/
|-- controllers/
|   |-- appController.js
|   |-- authController.js
|-- development/
|-- models/
|   |-- parkModel.js
|   |-- userModel.js
|-- services/
|   |-- authService.js
|   |-- databaseService.js
|   |-- firebase-config.js
|-- styles/
|   |-- main.css
|-- views/
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
