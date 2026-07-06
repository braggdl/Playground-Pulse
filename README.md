# Playground-Pulse
A kid-friendly park finder.
# Team Members
Group Corktown: Danny Bragg, Brandon Schwartz, and May Wu
#Course
CSSE5150
# Project Description:
For parents and caregivers, planning an outdoor outing can be challenging because standard mapping tools (like Google Maps) lack specific, child-friendly details. Caregivers often do not know if a park has age-appropriate equipment (such as toddler swings versus steep climbing structures), critical safety fencing, operational restrooms, or if it is currently overcrowded or undergoing maintenance. This information gap frequently leads to wasted trips, safety concerns, and frustrated children.
Playground Pulse: A Kid-Friendly Park Finder is a web-based, community-driven park finder application designed to solve this problem by providing detailed, real-time insights into local playgrounds. Utilizing three distinct user roles (Parent, Park Admin, and Site Admin) and a persistent relational database, the system allows parents to search and filter parks with granular criteria, report current crowd levels, and submit safety or maintenance concerns. This empowers families to make informed decisions before leaving the house, ensuring a safer, more predictable, and highly enjoyable outdoor experience.
# Usage
Section for future use to document how web app is to be used by the end user. 

## Starter Web Application Overview
This repository now includes a beginner-friendly starter web application scaffold using HTML, CSS, and JavaScript with a simple MVC-style organization.

## Project Folder Structure
```text
Playground-Pulse/
|-- assets/
|   |-- README.md
|-- controllers/
|   |-- appController.js
|   |-- authController.js
|-- Development/
|   |-- PlaygroundPulseIssuesList.csv
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
|   |-- login.html
|   |-- profile.html
|-- README.md
```

## Major Folder Purpose
- `models`: Data shape definitions and model helper functions.
- `views`: HTML pages and user interface templates.
- `controllers`: UI event handling and coordination between views, models, and services.
- `services`: External system integration code (Firebase auth and Firestore database logic).
- `assets`: Static files such as images, icons, and media.
- `styles`: Shared CSS files.
- `Development`: Development support files such as issue-tracking CSVs.

## Running Locally
1. Open this folder in VS Code.
2. Open one of the HTML files in `views` (for example `home.html`).
3. Run with a local static server (for example VS Code Live Server) or open the file in a browser.
4. As features are added, connect JavaScript files to the HTML pages with script tags.

## Where Code Should Be Placed
- Models should be created in `models/`.
- Views (pages/templates) should be created in `views/`.
- Controllers should be created in `controllers/`.
- Services should be created in `services/`.
- Static assets should be added to `assets/`.

## Firebase Setup Locations
- Firebase configuration belongs in `services/firebase-config.js`.
- Authentication code belongs in `services/authService.js`.
- Firestore database code belongs in `services/databaseService.js`.

## Before Firebase Will Work
The following items still need to be configured:
1. Add your Firebase project values to `services/firebase-config.js`.
2. Install and import Firebase SDK dependencies.
3. Replace placeholder auth functions (`login`, `logout`, `registerUser`) with real Firebase Authentication calls.
4. Replace placeholder database functions (`createRecord`, `readRecords`, `updateRecord`, `deleteRecord`) with real Firestore calls.
5. Enable Authentication providers and Firestore rules in the Firebase Console.
