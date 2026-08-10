# Live Demo Steps

This file contains the detailed, step-by-step walkthroughs for the three role-based demo workflows referenced on the About page (Website Showcase, Section 2). Use this as the presenter's script/checklist during the live demonstration; the About page itself carries a shorter summary for general audiences.

Each workflow demonstrates the actions unique to that role, covers the happy path, and deliberately triggers a few key error states so the audience sees both correct behavior and the guardrails behind it.

---

## Workflow 1: Parent

**Goal:** Show that a caregiver can register, find a park that actually fits their family, and leave it a little better for the next parent who visits.

**Steps:**
1. Register a new account using a weak password (e.g., missing a number or uppercase letter) to trigger the live password checklist error.
2. Correct the password to meet policy and complete sign-up.
3. Sign in and land on the dashboard.
4. Search for a park by zip code with the toddler-safe and restroom filters turned on.
5. Narrow the filters further until no parks match, to show the "No parks found. Try adjusting your search or filters." empty state.
6. Reset the filters and open a park's detail page.
7. Submit a crowd report for the park.
8. Immediately attempt to submit a second crowd report on the same park to trigger the one-hour cooldown error ("You have already submitted a crowd report for this park during the current one-hour window.").
9. Leave a star rating and a written review for the park.
10. Attempt to submit a second review on the same park to trigger "You have already reviewed this park."
11. Upload a photo, first selecting an unsupported file type (e.g., a PDF) to trigger "Unsupported file type. Please upload a JPEG, PNG, or WebP image."
12. Upload a valid photo (JPEG/PNG/WebP under 5 MB) to complete the happy path.
13. Save the park to Favorites and confirm it appears on the Profile page.

---

## Workflow 2: Park Admin

**Goal:** Show that a Park Admin's authority is real but scoped — they can maintain and moderate the parks assigned to them, and nothing else.

**Steps:**
1. Sign in as a Park Admin account.
2. Open an assigned park and edit its details (e.g., hours or description) to show a successful, in-scope edit.
3. Attempt to edit a park that is NOT on the admin's assigned list to trigger "You don't have permission to edit this park."
4. Return to the assigned park and toggle an equipment item's status (e.g., Operational to Needs Repair).
5. Add a brand-new equipment record to the assigned park.
6. Open an existing open safety report and advance its status to "In Review."
7. Attempt to delete that safety report to trigger "You are not authorized to delete safety reports." (deletion is Site Admin-only).
8. Open the reviews list for the assigned park and hide an inappropriate review.
9. Attempt to moderate a review on a park the admin does NOT manage to trigger "Park Admin can moderate reviews only for assigned parks."

---

## Workflow 3: Site Admin

**Goal:** Demonstrate full platform oversight — onboarding new parks, provisioning admins, moderating content across the whole system, and staying accountable via the audit log.

**Steps:**
1. Sign in as a Site Admin account and open the administration console.
2. Create a brand-new park record from scratch (name, location, and required fields).
3. Invite a new Park Admin by email and assign them to the park just created.
4. Attempt to invite a Site Admin account WITH assigned parks attached to trigger "Site Admin invites cannot include assigned parks."
5. Suspend a demo parent account from the moderation panel.
6. Attempt to sign in as the suspended account to show "This account has been disabled."
7. Open a safety report that has already been closed and reopen it (a transition only Site Admins can perform).
8. Delete that safety report outright.
9. Open the Audit Log and filter by event type to show every action just performed during the demo.
10. Clear all filters and attempt to run the audit log query to trigger "At least one filter (parkId, actorId, targetId, eventType, fromTimestamp, toTimestamp) is required."

---

## Reference: Error Messages Triggered in This Demo

| Role | Error Message | Trigger |
|---|---|---|
| Parent | "Password must be at least 8 characters." (and related policy checks) | Weak password on registration |
| Parent | "No parks found. Try adjusting your search or filters." | Over-filtered search |
| Parent | "You have already submitted a crowd report for this park during the current one-hour window." | Duplicate crowd report within an hour |
| Parent | "You have already reviewed this park." | Duplicate review submission |
| Parent | "Unsupported file type. Please upload a JPEG, PNG, or WebP image." | Invalid photo upload |
| Park Admin | "You don't have permission to edit this park." | Editing an unassigned park |
| Park Admin | "You are not authorized to delete safety reports." | Attempting to delete a safety report |
| Park Admin | "Park Admin can moderate reviews only for assigned parks." | Moderating a review on an unassigned park |
| Site Admin | "Site Admin invites cannot include assigned parks." | Inviting a Site Admin with assigned parks |
| Site Admin | "This account has been disabled." | Logging in as a suspended account |
| Site Admin | "At least one filter (parkId, actorId, targetId, eventType, fromTimestamp, toTimestamp) is required." | Running the audit log with no filters |
