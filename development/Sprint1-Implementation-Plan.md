# Sprint 1 Implementation Plan

## Purpose
This document contains the complete Sprint 1 implementation plan for Playground Pulse, organized by phase so software engineers can work independently while preserving logical dependencies.

## Sprint 1 Backlog Scope
- Search for parks
- Filter parks by child-friendly criteria
- View park detail page
- Register, log in, and log out
- Support role-based access
- Create and edit park records

## Team Decisions Captured
- Create/edit permissions: Park Admin and Site Admin only
- Parent role scope in Sprint 1: read/search/filter only
- Filter scope in Sprint 1:
  - Age groups (toddler, kid, teen)
  - Fenced area
  - Restrooms
  - Shade availability
  - Maintenance status
- Park detail scope in Sprint 1:
  - Name and location
  - Safety and amenities
  - Edit action visible only for authorized roles

## Architecture Mapping (MVC + Services)
- Models: [models/userModel.js](../models/userModel.js), [models/parkModel.js](../models/parkModel.js)
- Views: [views/home.html](../views/home.html), [views/login.html](../views/login.html), [views/dashboard.html](../views/dashboard.html), [views/profile.html](../views/profile.html), [index.html](../index.html)
- Controllers: [controllers/appController.js](../controllers/appController.js), [controllers/authController.js](../controllers/authController.js)
- Services: [services/firebase-config.js](../services/firebase-config.js), [services/authService.js](../services/authService.js), [services/databaseService.js](../services/databaseService.js)
- Shared styling: [styles/main.css](../styles/main.css)

## Phase 1: Foundation Setup
### Goal
Establish stable data contracts and startup wiring before feature implementation.

### Tasks
1. Finalize Firebase setup flow in [services/firebase-config.js](../services/firebase-config.js).
2. Align initialization patterns in [services/authService.js](../services/authService.js) and [services/databaseService.js](../services/databaseService.js).
3. Define Sprint 1 field shapes in [models/userModel.js](../models/userModel.js) and [models/parkModel.js](../models/parkModel.js).
4. Add app bootstrap flow in [controllers/appController.js](../controllers/appController.js) for shared state, startup decisions, and route/view coordination.

### Deliverables
- Consistent user and park model fields
- Ready-to-implement service layer contracts
- Clear app initialization path

### Suggested Owners
- Engineer A: Models
- Engineer B: Firebase config + service initialization
- Engineer C: App bootstrap controller flow

## Phase 2: Authentication and Role Context
### Goal
Implement identity flow and role checks that all protected features depend on.

### Dependencies
- Requires completion of Phase 1 model and service contracts

### Tasks
1. Implement register, login, logout in [services/authService.js](../services/authService.js).
2. Wire auth forms and actions in [controllers/authController.js](../controllers/authController.js) and [views/login.html](../views/login.html).
3. Add signed-in route protection logic in [controllers/appController.js](../controllers/appController.js).
4. Enforce role policy in controller behavior:
   - Park Admin and Site Admin can create/edit park records
   - Parent cannot create/edit park records

### Deliverables
- Working registration and login/logout flow
- Role context available to UI and controller logic
- Protected-route behavior for unauthenticated users

### Suggested Owners
- Engineer A: Auth service implementation
- Engineer B: Auth controller + login UI wiring
- Engineer C: Route guard + role enforcement

## Phase 3: Park Discovery (Search + Filters)
### Goal
Deliver park discovery experience for authenticated and permitted user paths.

### Dependencies
- Requires finalized park model fields from Phase 1
- Can start while Phase 2 is being finalized if read access is not role-restricted

### Tasks
1. Implement read/search/filter query logic in [services/databaseService.js](../services/databaseService.js).
2. Support filters:
   - Age groups
   - Fenced area
   - Restrooms
   - Shade availability
   - Maintenance status
3. Wire search/filter UI interactions in [controllers/appController.js](../controllers/appController.js).
4. Add filter and results UI controls in [views/home.html](../views/home.html) and [views/dashboard.html](../views/dashboard.html).
5. Add loading, empty-state, and error-state styling in [styles/main.css](../styles/main.css).

### Deliverables
- Searchable park list
- Multi-filter park results
- Clear user feedback for loading/no results/errors

### Suggested Owners
- Engineer A: Database query implementation
- Engineer B: Controller logic for search/filter actions
- Engineer C: UI control wiring and state rendering

## Phase 4: Park Detail + Create/Edit Records
### Goal
Deliver park detail view and role-gated record management.

### Dependencies
- Requires role enforcement from Phase 2
- Requires search/list retrieval paths from Phase 3

### Tasks
1. Implement park detail retrieval by id in [services/databaseService.js](../services/databaseService.js).
2. Add selection-to-detail flow in [controllers/appController.js](../controllers/appController.js).
3. Render required detail fields in [views/dashboard.html](../views/dashboard.html) or designated detail area:
   - Name and location
   - Safety and amenities
   - Role-restricted edit action
4. Implement create/edit record operations in [services/databaseService.js](../services/databaseService.js).
5. Add create/edit form handling in [controllers/appController.js](../controllers/appController.js).
6. Ensure UI only shows edit/create actions for Park Admin and Site Admin.

### Deliverables
- Park detail experience
- Role-restricted create/edit functionality
- Updated records reflected in list/detail flows

### Suggested Owners
- Engineer A: Detail retrieval + rendering path
- Engineer B: Create/edit service logic
- Engineer C: Controller form handling + role-gated UI

## Phase 5: Stabilization and Sprint Acceptance
### Goal
Validate all backlog items and harden user flows.

### Tasks
1. Add acceptance and setup notes to [README.md](../README.md).
2. Execute role-path validation for Parent, Park Admin, and Site Admin.
3. Run regression navigation checks from [index.html](../index.html) into all views.
4. Standardize error handling for auth failures, permission errors, and query failures.

### Deliverables
- Sprint acceptance checklist complete
- Documented setup and behavior expectations
- Stable navigation and role behavior

### Suggested Owners
- Engineer A: Acceptance test pass for auth/roles
- Engineer B: Acceptance test pass for search/filter/detail
- Engineer C: Documentation + regression checks

## Parallelization Guidance
- Phase 3 query design can begin once model fields are finalized.
- Styling and UI state work in [styles/main.css](../styles/main.css) can run in parallel with controller event wiring.
- README updates can be drafted during Phases 3 and 4, finalized in Phase 5.

## Definition of Done by Backlog Item
1. Search for parks: text search returns expected matching records.
2. Filter parks by child-friendly criteria: all five agreed filters can be combined and cleared.
3. View park detail page: selecting a park shows required detail fields.
4. Register, log in, and log out: auth lifecycle works with visible success/error states.
5. Support role-based access: Parent blocked from create/edit; Park Admin and Site Admin allowed.
6. Create and edit park records: authorized users can save updates and see reflected changes.

## Verification Checklist
### Authentication
- Register new user succeeds and redirects correctly.
- Login succeeds with valid credentials and fails gracefully with invalid credentials.
- Logout ends session and blocks protected actions.

### Role Access
- Parent cannot see or invoke create/edit actions.
- Park Admin can create/edit records.
- Site Admin can create/edit records.

### Discovery
- Search by text returns matching records.
- Combined filters return valid subset.
- Clearing filters resets results.

### Detail and CRUD
- Park detail shows name/location and safety/amenities.
- Edit affordance appears only for authorized roles.
- Create/edit updates are visible in subsequent reads.

### Regression
- Root navigation from [index.html](../index.html) still works.
- Existing views load without breaking errors.

## Risks and Mitigations
- Risk: Model fields change mid-sprint.
  - Mitigation: Lock required fields at end of Phase 1.
- Risk: Role checks only implemented in UI.
  - Mitigation: Enforce in controller behavior and backend access strategy.
- Risk: Search/filter query complexity grows.
  - Mitigation: Start with exact Sprint 1 filter set only and defer extras.

## Out of Scope for Sprint 1
- Advanced moderation workflows
- Crowd-level reporting UX enhancements
- Non-essential admin tooling
