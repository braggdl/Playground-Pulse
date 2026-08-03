import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

const USER_ROLES = {
  PARK_ADMIN: "Park Admin",
  SITE_ADMIN: "Site Admin"
};

const AUDIT_EVENT_TYPES = {
  ADMIN_INVITED: "admin_invited"
};

const PASSWORD_POLICY_VERSION = 2;
const INVITE_EXPIRATION_DAYS = 7;

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

async function ensureSiteAdminActor(db, uid) {
  const actor = await getUserRecordByUid(db, uid);

  if (!actor || actor.data?.role !== USER_ROLES.SITE_ADMIN) {
    throw new HttpsError("permission-denied", "Only Site Admins can invite privileged accounts.");
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
  const actor = await ensureSiteAdminActor(db, request.auth.uid);

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