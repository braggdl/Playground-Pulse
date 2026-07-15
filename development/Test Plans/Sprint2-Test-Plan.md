# Sprint 2 Test Plan

## Objective
Validate Sprint 2 features for account security/recovery, crowd reporting, busy-level display, efficient search behavior, and profile management without regressing Sprint 1 core capabilities.

## Scope
In scope:
1. Forgot-password flow.
2. Password policy and reauthentication protections.
3. Crowd report submission and duplicate suppression.
4. Busy-level display in result cards and park detail.
5. Search/filter with pagination and state handling.
6. Profile display-name and password update flows.
7. Sprint 1 regression smoke paths.

Out of scope:
1. Role administration workflows.
2. Analytics dashboards or historical trend visualizations.

## Test Environment
1. Local static server (for example Live Server).
2. Firebase Authentication enabled with Email/Password and password-reset.
3. Firestore enabled with `users`, `parks`, and `crowdReports` collections.
4. Firestore indexes/rules configured for deployed query constraints and protected operations.

## Test Data Setup
Create these test users:
1. Parent user.
2. Park Admin user.
3. Site Admin user.

Prepare park data:
1. At least 10 parks with mixed amenities and maintenance statuses.
2. Parks across distinct locations/names for text search coverage.

Prepare crowd report data:
1. Multiple reports in the last 60 minutes across at least 3 parks.
2. At least one park with no recent reports.
3. Duplicate report attempt scenario (same user + same park + same hour).

## Entry Criteria
1. App loads from local server with valid Firebase configuration.
2. Test users can authenticate.
3. Parks and crowd report baseline data are available.

## Exit Criteria
1. All Sprint 2 must-have test cases executed.
2. No open critical defects.
3. No open high defects on Sprint 2 core paths.
4. Residual medium/low defects documented with owner and next step.

## Test Cases

### A. Account Security and Recovery
A1. Forgot password request
1. Open login page.
2. Click `Forgot password?`.
3. Submit valid user email.
Expected:
1. Safe success feedback is shown.
2. No sensitive account existence leak.

A2. Weak password registration rejection
1. Open register form.
2. Enter weak password.
3. Submit registration.
Expected:
1. Registration blocked.
2. Password-policy feedback shown.

A3. Password change requires current password
1. Log in and open profile.
2. Attempt password update with invalid current password.
Expected:
1. Update blocked.
2. Reauthentication/credential failure feedback shown.

A4. Password change success path
1. Log in and open profile.
2. Enter valid current password and valid strong new password.
Expected:
1. Password update succeeds.
2. Success feedback shown.

### B. Crowd Reporting
B1. Submit crowd report
1. Log in and open park detail.
2. Submit crowd level.
Expected:
1. Submission succeeds.
2. Success feedback shown.
3. Report summary updates.

B2. Duplicate suppression
1. Submit crowd report for a park.
2. Re-submit for same park/user within same hour.
Expected:
1. Duplicate is blocked.
2. Duplicate-window message is shown.

B3. Auth gate
1. Sign out.
2. Attempt to submit crowd report.
Expected:
1. Submission is blocked.
2. Auth-required feedback shown.

### C. Busy-Level Display
C1. Busy level on result cards
1. Run dashboard search.
Expected:
1. Busy-level badge appears for returned parks.

C2. Busy level on park detail
1. Open park detail.
Expected:
1. Busy-level badge and report count appear.
2. Last update timestamp appears when available.

C3. Weighted 60-minute behavior
1. Seed reports with varying recency.
2. Compare displayed score with weighted expectation.
Expected:
1. Newer reports influence score more than older reports.
2. Label tier mapping is correct.

### D. Efficient Search
D1. Text search by name prefix
1. Enter known park name prefix.
Expected:
1. Matching records returned.
2. Non-matching records excluded.

D2. Text search by location prefix
1. Enter known location prefix.
Expected:
1. Matching records returned.

D3. Combined search + filters + pagination
1. Apply text search and multiple filters.
2. Use `Load more parks`.
Expected:
1. Additional matching results append.
2. No crash or stalled loading state.

D4. State handling
1. Trigger loading, empty, and retry paths.
Expected:
1. State messaging is visible and understandable.

### E. Profile Management
E1. Display-name update
1. Open profile.
2. Edit display name and save.
Expected:
1. Update persists.
2. UI re-renders updated name.

E2. Role immutability in profile UI
1. Open profile as any role.
Expected:
1. Role is displayed but not editable.

E3. Logout from profile
1. Click logout from profile page.
Expected:
1. Session ends.
2. Redirect to login.

### F. Regression Smoke (Sprint 1)
F1. Authentication lifecycle
1. Register/login/logout still work end-to-end.

F2. Role-based access
1. Parent cannot access admin mutation actions.
2. Park Admin and Site Admin can create/edit parks.

F3. Discovery/detail flow
1. Search/filter/detail navigation remains stable.

## Defect Severity Guide
1. Critical: security bypass, data loss, or app unusable.
2. High: core Sprint 2 feature blocked.
3. Medium: feature degraded with workaround.
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
