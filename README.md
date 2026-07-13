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
2. Role-aware experience for Parent, Park Admin, and Site Admin users.
3. Park search by text (name/location).
4. Child-friendly park filtering by:
   - Age group (toddler, kid, teen)
   - Fenced area
   - Restrooms
   - Shade availability
   - Maintenance status
5. Park detail view with location, safety notes, amenities notes, and feature summary.
6. Park creation and editing for authorized admin roles.

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
3. Select a park to open its detail section.
4. If your role is Park Admin or Site Admin, create or edit park records from the dashboard controls.
5. Open Profile to review account details and role.

### Search And Filter
1. Use the dashboard search box for name/location text.
2. Apply one or multiple filters.
3. Use Clear Filters to reset discovery criteria.

### Park Detail And Management
1. Click a park card to open detail information.
2. Admin roles can open create/edit park forms from dashboard/detail actions.
3. Save changes to update park records.

## Firebase Configuration
1. Set Firebase project values in `services/firebase-config.js`.
2. Enable Email/Password sign-in in Firebase Authentication.
3. Ensure Firestore is enabled and configured for your environment.
4. Use `users` and `parks` collections for core app data.

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
