# Sprint 2 Implementation Plan

## Purpose
This document contains the complete Sprint 2 implementation plan for Playground Pulse, organized by phase so software engineers can work independently while preserving logical dependencies.

## Sprint 2 Backlog Scope
- Recover Forgotten Password
- Protect User Accounts and Passwords
- Submit Crowd Level Report
- Limit Duplicate Crowd Reports
- Display Calculated Busy Level
- Display Search Results Efficiently
- Manage User Profile

## Team Decisions Captured
- Workstream dependencies:
  - Protect User Accounts and Passwords is foundational for:
    - Recover Forgotten Password
    - Manage User Profile
    - Authenticated crowd-report submission
  - Submit Crowd-Level Report must precede:
    - Limit Duplicate Crowd Reports
    - Display Calculated Busy Level
  - Database-side search and filtering is largely independent
- Duplicate report policy for Sprint 2:
  - One report per user per park per hour
- Busy level calculation for Sprint 2:
  - Weighted average from reports in the latest 60 minutes
- Profile scope for Sprint 2:
  - Display name updates
  - Password change with reauthentication

## Architecture Mapping (MVC + Services)
- Models: [models/userModel.js](../models/userModel.js), [models/parkModel.js](../models/parkModel.js)
- Views: [views/login.html](../views/login.html), [views/dashboard.html](../views/dashboard.html), [views/profile.html](../views/profile.html)
- Controllers: [controllers/appController.js](../controllers/appController.js), [controllers/authController.js](../controllers/authController.js)
- Services: [services/firebase-config.js](../services/firebase-config.js), [services/authService.js](../services/authService.js), [services/databaseService.js](../services/databaseService.js)
- Shared styling: [styles/main.css](../styles/main.css)

## Phase 1: Security Foundation and Data Contracts
### Goal
Establish shared contracts and account-protection baseline before feature-specific implementation.

### Tasks
1. Finalize Sprint 2 field contracts in [models/userModel.js](../models/userModel.js) and [models/parkModel.js](../models/parkModel.js) for profile updates, crowd reports, and busy-level display fields.
2. Align secure service initialization and error behavior in [services/firebase-config.js](../services/firebase-config.js), [services/authService.js](../services/authService.js), and [services/databaseService.js](../services/databaseService.js).
3. Define shared constants and validation rules in controllers/services (password policy, duplicate-report window, busy-level thresholds).
4. Confirm app-level orchestration points in [controllers/appController.js](../controllers/appController.js) for integrating Sprint 2 workstreams.

### Deliverables
- Stable Sprint 2 data contracts
- Shared validation and security assumptions
- Clear integration points across controllers and services

### Suggested Owners
- Engineer A: Model updates and shared contracts
- Engineer B: Service-level baseline hardening
- Engineer C: App orchestration and integration mapping

## Phase 2: Parallel Workstreams (Core Development)
### Goal
Execute independent workstreams in parallel to maximize sprint throughput.

### Dependencies
- Requires completion of Phase 1 contracts and shared assumptions

### Workstream A: Account Security and Identity
1. Implement account/password hardening in [services/authService.js](../services/authService.js):
   - Enforce password strength rules
   - Require reauthentication for sensitive changes
   - Standardize safe, user-readable auth errors
2. Implement forgot-password flow:
   - Add reset-password action in auth service
   - Add forgot-password UI flow in [views/login.html](../views/login.html)
   - Wire handlers in [controllers/authController.js](../controllers/authController.js)
3. Implement profile management in [views/profile.html](../views/profile.html) and controller wiring:
   - Update display name
   - Change password with reauthentication
   - Keep role updates restricted (not editable in standard profile UI)

### Workstream B: Crowd Reporting Pipeline
1. Implement submit crowd-level report capability in [services/databaseService.js](../services/databaseService.js) and [controllers/appController.js](../controllers/appController.js).
2. Add crowd report UI in [views/dashboard.html](../views/dashboard.html).
3. Implement duplicate report limit logic:
   - Enforce one report per user per park per hour
   - Return clear feedback when duplicate window blocks submission
4. Implement calculated busy-level logic:
   - Compute weighted 60-minute average
   - Map to display tiers (Low, Moderate, Busy, Very Busy)
   - Render in park detail and results views

### Workstream C: Efficient Search Results
1. Refactor search/filter data access in [services/databaseService.js](../services/databaseService.js) to avoid expensive full-collection reads.
2. Add query constraints, result limits, and pagination/incremental loading.
3. Wire efficient search rendering in [controllers/appController.js](../controllers/appController.js) and [views/dashboard.html](../views/dashboard.html).
4. Add loading/empty/retry states in [styles/main.css](../styles/main.css) and connected views.

### Deliverables
- Security-enhanced account lifecycle
- Functional crowd reporting with duplicate suppression and busy-level calculation
- Efficient, scalable search result display behavior

### Suggested Owners
- Engineer A: Workstream A
- Engineer B: Workstream B
- Engineer C: Workstream C

## Phase 3: Integration Across Workstreams
### Goal
Merge parallel outputs into a unified end-to-end user experience.

### Dependencies
- Requires completion of Workstreams A, B, and C from Phase 2

### Tasks
1. Integrate account state with crowd-report submission gates in [controllers/appController.js](../controllers/appController.js).
2. Integrate busy-level output from Workstream B into search results and detail rendering paths from Workstream C.
3. Validate profile and auth state interactions across [views/login.html](../views/login.html), [views/dashboard.html](../views/dashboard.html), and [views/profile.html](../views/profile.html).
4. Validate consistent error handling and user feedback across controllers/services.

### Deliverables
- Unified Sprint 2 behavior across auth, profile, reporting, and search
- Consistent role and auth gating across views
- Integrated busy-level rendering in discovery workflows

### Suggested Owners
- Engineer A: Auth/profile integration checks
- Engineer B: Crowd-report to busy-level integration
- Engineer C: Search-performance and UI integration checks

## Phase 4: Stabilization and Sprint Acceptance
### Goal
Validate backlog completion, harden behavior, and confirm no regressions.

### Tasks
1. Add Sprint 2 acceptance and setup notes to [README.md](../README.md).
2. Execute role-path and auth-path validation for Parent, Park Admin, and Site Admin.
3. Run regression checks for Sprint 1 capabilities plus Sprint 2 additions.
4. Validate Firestore rules behavior for protected account operations and crowd-report submission constraints.
5. Standardize failure messages for:
   - Weak passwords
   - Reauthentication requirements
   - Duplicate crowd reports
   - Query/read failures

### Deliverables
- Sprint acceptance checklist complete
- Documented setup and behavior expectations
- Stable cross-sprint behavior and protected account/reporting paths

### Suggested Owners
- Engineer A: Auth/security acceptance and rules checks
- Engineer B: Crowd-report and busy-level acceptance checks
- Engineer C: Search-performance regression checks and documentation

## Parallelization Guidance
- Phase 1 is the shared blocker and should be completed first.
- After Phase 1, run these in parallel:
  - Workstream A: Protect User Accounts and Passwords, Recover Forgotten Password, Manage User Profile
  - Workstream B: Submit Crowd Level Report, then Limit Duplicate Crowd Reports, then Display Calculated Busy Level
  - Workstream C: Display Search Results Efficiently (database-side search/filter optimization)
- Workstream C can proceed independently and only requires final integration with busy-level output from Workstream B.

## Definition of Done by Backlog Item
1. Recover Forgotten Password: user can request reset flow and receives appropriate success/failure feedback.
2. Protect User Accounts and Passwords: password policy and reauthentication checks are enforced where required.
3. Submit Crowd Level Report: authenticated user can submit crowd level for a park with required metadata.
4. Limit Duplicate Crowd Reports: duplicate reports in the one-hour window are blocked.
5. Display Calculated Busy Level: busy level appears on park detail/results and updates from recent reports.
6. Display Search Results Efficiently: results load with query constraints and incremental/paginated behavior.
7. Manage User Profile: user can update display name and change password securely.

## Verification Checklist
### Account Security and Recovery
- Forgot-password flow is available and returns safe, user-readable feedback.
- Weak passwords are rejected during registration and password changes.
- Sensitive profile operations require reauthentication.

### Crowd Reporting
- Authenticated user can submit crowd level report tied to park and user identity.
- Duplicate crowd report inside one-hour window is blocked.
- User receives clear duplicate-window message when blocked.

### Busy Level Display
- Busy-level calculation reflects latest 60-minute weighted reports.
- Busy level is rendered in park detail and search result cards.

### Efficient Search
- Search/filter paths use constrained queries and avoid broad full reads in normal use.
- Results can be loaded incrementally or by page.
- Loading/empty/error states are visible and understandable.

### Profile Management
- Display name updates persist and re-render correctly.
- Password change succeeds with valid reauthentication.

### Regression
- Sprint 1 flows remain functional (login/logout, role access, search/filter, detail, create/edit records).
- Navigation from [index.html](../index.html) continues to work across key views.

## Risks and Mitigations
- Risk: Duplicate-report policy changes mid-sprint.
  - Mitigation: Lock policy window in Phase 1 and apply consistently in service and UI.
- Risk: Search efficiency work introduces regression in filter behavior.
  - Mitigation: Keep existing filter acceptance tests and run them after query refactor.
- Risk: Security checks only implemented client-side.
  - Mitigation: Verify corresponding Firestore rules and server-enforced constraints.
- Risk: Busy-level logic drifts across UI contexts.
  - Mitigation: Centralize calculation in service layer and reuse same output contract.

## Out of Scope for Sprint 2
- Role administration workflows and approval pipelines
- Advanced analytics dashboards
- Historical trend visualizations beyond current busy-level display

## Phase 4 Implementation Status Update (Current Pass)

### Completed
1. Created Sprint 2 implementation sequencing and dependency model.
2. Defined parallel workstreams and integration checkpoints.
3. Defined Sprint 2 verification and acceptance criteria.

### Deferred In This Pass
1. Execution of implementation tasks in code.
2. Runtime validation and role-path test execution.

### Next Execution Step (When Unblocked)
Start Phase 1 contract locking and assign Workstreams A, B, and C to parallel owners.
