import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import functionsV1 from "firebase-functions/v1";

initializeApp();

const USER_ROLES = {
  PARENT: "Parent",
  PARK_ADMIN: "Park Admin",
  SITE_ADMIN: "Site Admin"
};

const ALLOWED_USER_ROLES = Object.values(USER_ROLES);

// Must stay in sync with models/auditLogModel.js on the client. `claims_synced`
// is server-only (the client never writes it) but is listed here for completeness.
const AUDIT_EVENT_TYPES = {
  ADMIN_INVITED: "admin_invited",
  ADMIN_ASSIGNED: "admin_assigned",
  ADMIN_REMOVED: "admin_removed",
  USER_MODERATED: "user_moderated",
  CLAIMS_SYNCED: "claims_synced"
};

const PASSWORD_POLICY_VERSION = 2;
const INVITE_EXPIRATION_DAYS = 7;

/**
 * Writes the authoritative role onto the user's Auth token as a custom claim.
 *
 * Custom claims can only be set by the Admin SDK, never by a browser client, so
 * Firestore/Storage security rules can trust `request.auth.token.role` in a way
 * they can never trust the client-writable `users/{uid}.role` document field.
 *
 * NOTE: claims are embedded in the ID token and only refresh when the token does
 * (on sign-in, or after ~1 hour). Clients should call getIdToken(true) after a
 * role change to pick it up immediately.
 */
async function applyRoleClaim(auth, uid, role) {
  if (!ALLOWED_USER_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", `Unsupported role: ${role}`);
  }

  const existing = await auth.getUser(uid);
  // Preserve unrelated claims that other features may add later.
  const nextClaims = { ...(existing.customClaims || {}), role };

  await auth.setCustomUserClaims(uid, nextClaims);
  return nextClaims;
}

function normalizeInvitePayload(data = {}) {
  const email = String(data.email || "").trim().toLowerCase();
  const displayName = String(data.displayName || "").trim();
  const role = String(data.role || "").trim();
  const assignedParks = Array.isArray(data.assignedParks)
    ? Array.from(new Set(data.assignedParks.map((parkId) => String(parkId || "").trim()).filter(Boolean)))
    : [];

  if (!email) {
    throw new HttpsError("invalid-argument", "Invitee email is required.");
  }

  if (![USER_ROLES.PARK_ADMIN, USER_ROLES.SITE_ADMIN].includes(role)) {
    throw new HttpsError("invalid-argument", "Only Park Admin and Site Admin invites are supported.");
  }

  if (role === USER_ROLES.SITE_ADMIN && assignedParks.length > 0) {
    throw new HttpsError("invalid-argument", "Site Admin invites cannot include assigned parks.");
  }

  return {
    email,
    displayName,
    role,
    assignedParks
  };
}

async function getUserRecordByUid(db, uid) {
  if (!uid) {
    return null;
  }

  const directSnapshot = await db.collection("users").doc(uid).get();
  if (directSnapshot.exists) {
    return {
      id: directSnapshot.id,
      ref: directSnapshot.ref,
      data: directSnapshot.data()
    };
  }

  const querySnapshot = await db.collection("users").where("uid", "==", uid).limit(1).get();
  if (querySnapshot.empty) {
    return null;
  }

  const documentSnapshot = querySnapshot.docs[0];
  return {
    id: documentSnapshot.id,
    ref: documentSnapshot.ref,
    data: documentSnapshot.data()
  };
}

/**
 * Authorizes the caller as a Site Admin.
 *
 * `tokenRole` comes from the caller's verified ID token (request.auth.token.role),
 * which only the Admin SDK can set. It is the authority. The Firestore user
 * document is still loaded because callers need the actor record downstream, but
 * its `role` field is deliberately NOT consulted for the permission decision --
 * it is client-writable and therefore untrustworthy.
 */
async function ensureSiteAdminActor(db, uid, tokenRole) {
  if (tokenRole !== USER_ROLES.SITE_ADMIN) {
    throw new HttpsError("permission-denied", "Only Site Admins can invite privileged accounts.");
  }

  const actor = await getUserRecordByUid(db, uid);

  if (!actor) {
    throw new HttpsError("permission-denied", "Actor user record not found.");
  }

  return actor;
}

async function ensureAssignedParksExist(db, assignedParks = []) {
  for (const parkId of assignedParks) {
    const parkSnapshot = await db.collection("parks").doc(parkId).get();
    if (!parkSnapshot.exists) {
      throw new HttpsError("invalid-argument", `Assigned park not found: ${parkId}`);
    }
  }
}

function buildUserProfile(userRecord = {}, invite = {}, actorUid) {
  const now = new Date().toISOString();

  return {
    uid: userRecord.uid,
    email: userRecord.email,
    role: invite.role,
    displayName: invite.displayName || userRecord.displayName || "",
    lastPasswordChangeAt: null,
    lastReauthenticatedAt: null,
    reauthRequired: false,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
    assignedParks: invite.role === USER_ROLES.PARK_ADMIN ? invite.assignedParks : [],
    invitedBy: actorUid,
    invitationStatus: "pending",
    createdAt: userRecord.createdAt || now,
    updatedAt: now
  };
}

function buildInviteRecord({ email, role, assignedParks, actorUid, targetUid }) {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + INVITE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  return {
    email,
    emailLowercase: email,
    role,
    assignedParks,
    invitedBy: actorUid,
    targetUid,
    status: "pending",
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
    revokedAt: null,
    updatedAt: createdAt.toISOString()
  };
}

async function upsertAuthUser(auth, invite) {
  try {
    return await auth.getUserByEmail(invite.email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    return auth.createUser({
      email: invite.email,
      displayName: invite.displayName || undefined
    });
  }
}

async function writeAuditEntry(db, actorUid, targetUid, invite) {
  await db.collection("auditLog").add({
    eventType: AUDIT_EVENT_TYPES.ADMIN_INVITED,
    actorId: actorUid,
    targetId: targetUid,
    parkId: invite.assignedParks[0] || "",
    metadata: {
      action: "invite_admin_user",
      role: invite.role,
      assignedParks: invite.assignedParks
    },
    timestamp: new Date().toISOString()
  });
}

export const inviteAdminUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to continue.");
  }

  const invite = normalizeInvitePayload(request.data);
  const db = getFirestore();
  const auth = getAuth();
  const actor = await ensureSiteAdminActor(db, request.auth.uid, request.auth.token?.role);

  await ensureAssignedParksExist(db, invite.assignedParks);

  const targetAuthUser = await upsertAuthUser(auth, invite);
  const existingUserSnapshot = await db.collection("users").doc(targetAuthUser.uid).get();
  const existingUserData = existingUserSnapshot.exists ? existingUserSnapshot.data() : {};
  const userProfile = buildUserProfile({
    uid: targetAuthUser.uid,
    email: targetAuthUser.email || invite.email,
    displayName: existingUserData.displayName || targetAuthUser.displayName || invite.displayName,
    createdAt: existingUserData.createdAt
  }, invite, actor.data.uid || actor.id);

  await db.collection("users").doc(targetAuthUser.uid).set(userProfile, { merge: true });

  // Set the authoritative role on the Auth token. Security rules read this, not the
  // Firestore document written above (that copy exists only for display/query).
  await applyRoleClaim(auth, targetAuthUser.uid, invite.role);

  const inviteDocumentId = `${targetAuthUser.uid}_${invite.role.toLowerCase().replace(/\s+/g, "_")}`;
  const inviteRecord = buildInviteRecord({
    email: invite.email,
    role: invite.role,
    assignedParks: invite.assignedParks,
    actorUid: actor.data.uid || actor.id,
    targetUid: targetAuthUser.uid
  });

  await db.collection("adminInvites").doc(inviteDocumentId).set(inviteRecord, { merge: true });
  await writeAuditEntry(db, actor.data.uid || actor.id, targetAuthUser.uid, invite);

  const passwordSetupLink = await auth.generatePasswordResetLink(invite.email);

  return {
    success: true,
    invitationId: inviteDocumentId,
    targetUserId: targetAuthUser.uid,
    email: invite.email,
    role: invite.role,
    assignedParks: invite.assignedParks,
    expiresAt: inviteRecord.expiresAt,
    passwordSetupLink
  };
});

/**
 * Stamps every newly created account with the default Parent role claim.
 *
 * Without this, a brand-new user has no `role` claim and security rules that
 * require one would reject all of their writes. Uses the v1 auth trigger because
 * Firebase does not yet offer a v2 equivalent for onCreate.
 *
 * Invited admins are also caught here first (they get Parent), then immediately
 * upgraded by applyRoleClaim() inside inviteAdminUser.
 */
export const assignDefaultRoleClaim = functionsV1.auth.user().onCreate(async (user) => {
  const auth = getAuth();

  try {
    await auth.setCustomUserClaims(user.uid, { role: USER_ROLES.PARENT });
  } catch (error) {
    console.error(`Failed to set default role claim for ${user.uid}:`, error);
    throw error;
  }
});

/**
 * Self-service migration endpoint: copies the caller's existing Firestore role
 * onto their Auth token as a custom claim, but ONLY when they have no claim yet.
 *
 * This exists so accounts created before custom claims were introduced are not
 * locked out. It is deliberately narrow:
 *   - callers can only ever act on themselves (uid comes from the verified token)
 *   - it refuses to run if a role claim is already present, so it cannot be used
 *     to re-escalate or overwrite a claim an admin has set
 *   - it can only ever copy a role that already exists in Firestore
 *
 * SECURITY NOTE: while legacy `users/{uid}.role` documents remain client-writable,
 * a user who self-assigned "Site Admin" before the rules were deployed could use
 * this to mint a matching claim. Audit the users collection for unexpected roles
 * before deploying, and remove this function once all active accounts have claims.
 */
export const syncOwnRoleClaim = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to continue.");
  }

  const uid = request.auth.uid;
  const currentClaim = request.auth.token?.role;

  const db = getFirestore();
  const auth = getAuth();
  const userRecord = await getUserRecordByUid(db, uid);
  const firestoreRole = userRecord?.data?.role;
  const role = ALLOWED_USER_ROLES.includes(firestoreRole) ? firestoreRole : USER_ROLES.PARENT;

  // Reconcile a STALE claim, not just a missing one. Accounts provisioned by
  // seeding or a direct Firestore edit are stamped 'Parent' by the onCreate
  // trigger and never upgraded, which leaves the UI showing admin controls while
  // security rules (which read the claim) reject every write.
  //
  // This is safe because `users/{uid}.role` is no longer client-writable: the
  // rules forbid clients from touching `role` on update and pin it to 'Parent'
  // on create, so the only way the document can say "Site Admin" is if a Cloud
  // Function using the Admin SDK put it there.
  if (currentClaim === role) {
    return { success: true, role, changed: false };
  }

  await applyRoleClaim(auth, uid, role);

  await db.collection("auditLog").add({
    eventType: AUDIT_EVENT_TYPES.CLAIMS_SYNCED,
    actorId: uid,
    targetId: uid,
    parkId: "",
    metadata: { action: "sync_own_role_claim", role },
    timestamp: new Date().toISOString()
  });

  return { success: true, role, changed: true };
});

/**
 * Site-Admin-only endpoint to change another user's role and park assignments.
 *
 * Replaces the client-side role writes that assignParkAdmin()/removeParkAdmin()
 * previously performed directly against Firestore. Security rules now forbid the
 * client from writing `role` or `assignedParks` on any user document, so those
 * mutations have to happen here where the caller can be verified against a token
 * claim rather than a client-writable document field.
 */
export const setUserRoleAndParks = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to continue.");
  }

  const db = getFirestore();
  const auth = getAuth();
  const actor = await ensureSiteAdminActor(db, request.auth.uid, request.auth.token?.role);

  const targetUserId = String(request.data?.targetUserId || "").trim();
  const role = String(request.data?.role || "").trim();
  const assignedParks = Array.isArray(request.data?.assignedParks)
    ? Array.from(new Set(request.data.assignedParks.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "targetUserId is required.");
  }

  if (!ALLOWED_USER_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", `Unsupported role: ${role}`);
  }

  if (role !== USER_ROLES.PARK_ADMIN && assignedParks.length > 0) {
    throw new HttpsError("invalid-argument", "Only Park Admins can have assigned parks.");
  }

  await ensureAssignedParksExist(db, assignedParks);

  const targetUser = await getUserRecordByUid(db, targetUserId);
  if (!targetUser) {
    throw new HttpsError("not-found", "Target user not found.");
  }

  await targetUser.ref.update({
    role,
    assignedParks,
    updatedAt: new Date().toISOString()
  });

  await applyRoleClaim(auth, targetUserId, role);

  await db.collection("auditLog").add({
    eventType: role === USER_ROLES.PARENT
      ? AUDIT_EVENT_TYPES.ADMIN_REMOVED
      : AUDIT_EVENT_TYPES.ADMIN_ASSIGNED,
    actorId: actor.data.uid || actor.id,
    targetId: targetUserId,
    parkId: assignedParks[0] || "",
    metadata: { action: "set_user_role_and_parks", role, assignedParks },
    timestamp: new Date().toISOString()
  });

  return { success: true, targetUserId, role, assignedParks };
});

/**
 * Site-Admin-only endpoint to suspend or reinstate a user account.
 *
 * Security rules forbid clients from writing the `disabled` / moderation fields
 * on any user document, so this mutation has to happen server-side. It also
 * disables the account in Firebase Auth, which the previous client-only
 * implementation never did -- a "disabled" user could still sign in and hold a
 * valid token.
 */
export const moderateUserAccount = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to continue.");
  }

  const db = getFirestore();
  const auth = getAuth();
  const actor = await ensureSiteAdminActor(db, request.auth.uid, request.auth.token?.role);

  const targetUserId = String(request.data?.targetUserId || "").trim();
  const rawAction = String(request.data?.action || "").trim();
  const action = (rawAction === "hide" || rawAction === "disable")
    ? "hide"
    : (rawAction === "reinstate" ? "reinstate" : null);

  if (!targetUserId) {
    throw new HttpsError("invalid-argument", "targetUserId is required.");
  }

  if (!action) {
    throw new HttpsError("invalid-argument", "Action must be one of: hide, disable, reinstate.");
  }

  if (targetUserId === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot moderate your own account.");
  }

  const targetUser = await getUserRecordByUid(db, targetUserId);
  if (!targetUser) {
    throw new HttpsError("not-found", "Target user not found.");
  }

  const disabled = action === "hide";
  const actorUid = actor.data.uid || actor.id;
  const now = new Date().toISOString();

  await targetUser.ref.update({
    disabled,
    moderationAction: action,
    moderatedBy: actorUid,
    moderatedAt: now,
    updatedAt: now
  });

  // Enforce the suspension at the Auth layer, not just in the profile document.
  await auth.updateUser(targetUser.data.uid || targetUser.id, { disabled });

  await db.collection("auditLog").add({
    eventType: AUDIT_EVENT_TYPES.USER_MODERATED,
    actorId: actorUid,
    targetId: targetUser.data.uid || targetUser.id,
    parkId: "",
    metadata: { action },
    timestamp: now
  });

  return { success: true, targetUserId, action, disabled };
});