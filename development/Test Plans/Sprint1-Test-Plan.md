# Sprint 1 Test Plan

## Objective
Validate Sprint 1 core functionality for authentication, role-based access, park discovery, park detail, and role-gated create/edit park management.

## Scope
In scope:
1. Register, log in, and log out.
2. Protected route behavior for dashboard/profile.
3. Role behavior for Parent, Park Admin, and Site Admin.
4. Search and filter parks.
5. Park detail rendering.
6. Create/edit park records for authorized roles.

Out of scope:
1. Crowd reporting features.
2. Safety report workflows.
3. Admin moderation workflows outside Sprint 1.

## Test Environment
1. Local static server (for example Live Server).
2. Firebase Authentication enabled (Email/Password).
3. Firestore enabled with `users` and `parks` collections.
4. Seed data available for at least 5 parks across varying filter values.

## Test Data Setup
Create these test users:
1. Parent user
2. Park Admin user
3. Site Admin user

Prepare parks data that includes combinations of:
1. Age groups: toddler, kid, teen
2. Fenced area: true/false
3. Restrooms: true/false
4. Shade available: true/false
5. Maintenance status: good, needs_attention, closed, unknown

## Entry Criteria
1. App loads successfully from local server.
2. Firebase configuration is valid.
3. Test users and parks seed data are available.

## Exit Criteria
1. All must-have Sprint 1 test cases executed.
2. No open critical defects.
3. No open high defects blocking core user flow.
4. Known medium/low defects documented with owner and next action.

## Test Cases

### A. Authentication
A1. Register new user
1. Navigate to login page.
2. Switch to register form.
3. Submit valid new user data.
Expected:
1. Registration succeeds.
2. User record is created.
3. User lands on dashboard.

A2. Login with valid credentials
1. Enter valid email/password.
2. Submit login.
Expected:
1. Login succeeds.
2. User lands on dashboard.

A3. Login with invalid credentials
1. Enter valid email + incorrect password.
2. Submit login.
Expected:
1. Login fails gracefully.
2. Error message is shown.
3. User remains on login page.

A4. Logout
1. Log in first.
2. Click logout.
Expected:
1. Session ends.
2. User returns to login.
3. Protected views require re-authentication.

### B. Route Protection
B1. Direct access to dashboard while logged out
1. Navigate directly to dashboard URL.
Expected:
1. Redirect to login.

B2. Direct access to profile while logged out
1. Navigate directly to profile URL.
Expected:
1. Redirect to login.

B3. Access login while already authenticated
1. Log in.
2. Navigate to login URL.
Expected:
1. Redirect to dashboard.

### C. Role-Based Access
C1. Parent role permissions
1. Log in as Parent.
2. Open dashboard and select a park.
Expected:
1. Can search/filter/view detail.
2. No create/edit actions visible or executable.

C2. Park Admin role permissions
1. Log in as Park Admin.
2. Open dashboard and select a park.
Expected:
1. Can search/filter/view detail.
2. Can open create/edit actions and submit changes.

C3. Site Admin role permissions
1. Log in as Site Admin.
2. Open dashboard and select a park.
Expected:
1. Can search/filter/view detail.
2. Can open create/edit actions and submit changes.

### D. Discovery: Search + Filters
D1. Search by park name
1. Enter known park name text.
Expected:
1. Matching parks appear.

D2. Search by location text
1. Enter known location text.
Expected:
1. Matching parks appear.

D3. Filter by single criterion
1. Apply one filter (for example fenced area).
Expected:
1. Only matching parks are shown.

D4. Filter by multiple criteria
1. Apply age group + amenity + maintenance filters.
Expected:
1. Result set matches all active filters.

D5. Clear filters
1. Apply multiple filters.
2. Click clear filters.
Expected:
1. Filter inputs reset.
2. Results reset accordingly.

D6. Empty state
1. Use filter combination with no matching records.
Expected:
1. Empty-state message is shown.

### E. Park Detail
E1. Open park detail from result card
1. Search for a park.
2. Click a park card.
Expected:
1. Detail area loads selected park.
2. Name and location shown.
3. Safety and amenities shown.
4. Features/age groups shown.

E2. Return from detail to list
1. Open park detail.
2. Click Back to List.
Expected:
1. Detail panel closes.
2. Result list remains available.

### F. Create/Edit Park Records
F1. Create park (authorized role)
1. Log in as Park Admin or Site Admin.
2. Open create park form.
3. Submit valid required fields.
Expected:
1. Save succeeds.
2. Success message shown.
3. New park appears in list/detail paths.

F2. Edit park (authorized role)
1. Open existing park detail.
2. Click Edit Park.
3. Modify fields and save.
Expected:
1. Save succeeds.
2. Updated values appear in detail and refreshed results.

F3. Unauthorized create/edit attempt (Parent)
1. Log in as Parent.
2. Attempt to access admin actions.
Expected:
1. Create/edit actions are not available.
2. No unauthorized mutation occurs.

### G. UI/UX States
G1. Loading states
1. Trigger search/filter operations.
Expected:
1. Loading indicator appears.
2. Indicator clears when results return.

G2. Error state
1. Simulate query/auth failure.
Expected:
1. Error message is displayed.
2. UI remains usable for retry.

G3. Profile role rendering
1. Log in with each role.
2. Open profile.
Expected:
1. Role text is visible and correct.
2. No permanent "Loading..." state.

### H. Regression Smoke
H1. Navigation smoke
1. Traverse index -> home -> login -> dashboard -> profile.
Expected:
1. No broken route transitions.
2. No infinite redirects/flicker.

H2. Session persistence smoke
1. Log in.
2. Refresh protected page.
Expected:
1. Session remains valid.
2. Page remains accessible.

## Defect Severity Guide
1. Critical: app unusable, data loss, auth bypass, or security breach.
2. High: core flow blocked (login, discovery, detail, create/edit).
3. Medium: major feature partially degraded with workaround.
4. Low: minor UI issue or non-blocking defect.

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
