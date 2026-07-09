/*
  User Model
  Purpose: Define the shape of user data used across the app.
  Add validation rules and helper methods for user data here.
*/

const USER_ROLES = {
  PARENT: "Parent",
  PARK_ADMIN: "Park Admin",
  SITE_ADMIN: "Site Admin"
};

const ALLOWED_USER_ROLES = Object.values(USER_ROLES);

function isValidUserRole(role) {
  return ALLOWED_USER_ROLES.includes(role);
}

function createUserModel(partialUser = {}) {
  const role = partialUser.role || USER_ROLES.PARENT;

  return {
    uid: partialUser.uid || "",
    email: partialUser.email || "",
    role: isValidUserRole(role) ? role : USER_ROLES.PARENT,
    displayName: partialUser.displayName || "",
    createdAt: partialUser.createdAt || new Date().toISOString(),
    updatedAt: partialUser.updatedAt || new Date().toISOString()
  };
}

export { USER_ROLES, ALLOWED_USER_ROLES, isValidUserRole, createUserModel };
