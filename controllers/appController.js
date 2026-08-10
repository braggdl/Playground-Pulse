/*
  App Controller
  Purpose: Coordinate view-level actions and call services/models as needed.
  Add route handling, event listeners, and page-specific logic in this file.
*/

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeAuthController, handleLogout } from "./authController.js";
import { USER_ROLES } from "../models/userModel.js";
import { canPerformAction } from "../constants/authConstants.js";
import { PARK_SEARCH_DEFAULTS } from "../constants/searchConstants.js";
import {
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  SAFETY_REPORT_STATUSES,
  SAFETY_REPORT_TRANSITIONS,
  CROWD_REPORT_POLICY
} from "../constants/reportConstants.js";
import {
  addFavorite,
  assignParkAdmin,
  calculateBusyLevelFromReports,
  createEquipment,
  createParkRecord,
  createReview,
  createSafetyReport,
  deleteEquipment,
  deleteParkRecord,
  deleteSafetyReport,
  editParkRecord,
  getAuditLog,
  getCrowdHistory,
  getEquipment,
  getFavorites,
  getParkById,
  getRecentCrowdReportsForPark,
  getReviews,
  getSafetyReports,
  getUserNotifications,
  markNotificationRead,
  moderateReview,
  moderateUser,
  readRecords,
  removeFavorite,
  removeParkAdmin,
  searchAndFilterParks,
  submitCrowdReport,
  submitParkPhoto,
  updateEquipmentStatus,
  updateRecord,
  updateSafetyReportStatus,
  getRecordById
} from "../services/databaseService.js";
import { inviteAdminAccount, syncOwnRoleClaim } from "../services/adminInvitationService.js";
import { subscribeToUserNotifications } from "../services/notificationService.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";

// Must match the key used by the inline first-paint script in each page's <head>.
const AUTH_HINT_STORAGE_KEY = "pp.authHint";

const appState = {
  isInitialized: false,
  currentView: "",
  // Workstream A: Auth and profile state.
  authReady: false,
  currentUser: null,
  userRole: null,
  // Park IDs this user administers. Empty for Parent and Site Admin (Site Admins
  // manage every park, so the list is not consulted for them).
  assignedParks: [],
  authStatusMessage: null,
  // Workstream B: Crowd reporting state.
  crowdReportSubmitting: false,
  crowdReportError: null,
  crowdReportSuccess: null,
  crowdReportLevel: "1",
  lastCrowdReportWindowKey: null,
  latestBusyLevel: null,
  // Workstream C: Search and filter state.
  searchTerm: "",
  filterCriteria: {
    ageGroups: [],
    fencedArea: null,
    restrooms: null,
    shadeAvailable: null,
    maintenanceStatus: null
  },
  parkQuery: {
    pageSize: PARK_SEARCH_DEFAULTS.pageSize,
    hasMore: false,
    lastDocument: null
  },
  parkResults: [],
  isLoadingParks: false,
  parksError: null,
  // Shared Sprint 1 and Phase 1 park management state.
  selectedPark: null,
  parkFormMode: null,
  parkFormRecordId: null,
  parkFormError: null,
  parkFormSuccess: null,
  isSubmittingParkForm: false,
  // Sprint 3: community features state.
  reviewForm: {
    rating: 5,
    body: ""
  },
  reviewSubmitting: false,
  reviewError: null,
  reviewSuccess: null,
  reviews: [],
  favoriteParks: [],
  favoriteLoading: false,
  favoriteError: null,
  photoSubmitting: false,
  photoError: null,
  photoSuccess: null,
  // Sprint 3 Workstream 1: safety, equipment, notifications.
  safetyReportDescription: "",
  safetyReportType: "hazard",
  safetyReportSubmitting: false,
  safetyReportError: null,
  safetyReportSuccess: null,
  safetyReports: [],
  safetyReportsLoading: false,
  safetyReportStatusFilter: "",
  equipmentNameInput: "",
  equipmentTypeInput: "playground",
  equipmentSubmitting: false,
  equipmentError: null,
  equipmentSuccess: null,
  equipmentItems: [],
  equipmentLoading: false,
  notifications: [],
  notificationsPanelOpen: false,
  notificationsError: null,
  unreadNotificationCount: 0,
  notificationsUnsubscribe: null,
  // Sprint 3 Workstream 4: map and crowd history.
  crowdHistory: [],
  crowdHistoryError: null,
  crowdHistoryStaleRefreshPending: false,
  mapMode: true,
  mapInstance: null,
  mapMarkersLayer: null,
  dashboardParkModalOpen: false,
  activeParkActionModal: null,
  profileFavoriteModalOpen: false,
  // Delete park confirmation modal state.
  deleteParkConfirmInput: "",
  isDeletingPark: false,
  deleteParkError: null,
  // Admin view state.
  adminParks: [],
  adminSelectedParkId: "",
  adminPanelError: null,
  // Sprint 3 Workstream 2: administration actions and audit.
  admin: {
    actionMessage: null,
    actionError: false,
    isSubmitting: false,
    auditEntries: [],
    isLoadingAudit: false,
    auditError: null
  }
};

function getCurrentView() {
  const pathName = window.location.pathname.toLowerCase();

  if (pathName.endsWith("login.html")) {
    return "login";
  }

  if (pathName.endsWith("dashboard.html")) {
    return "dashboard";
  }

  if (pathName.endsWith("profile.html")) {
    return "profile";
  }

  if (pathName.endsWith("admin.html")) {
    return "admin";
  }

  if (pathName.endsWith("home.html")) {
    return "home";
  }

  return "index";
}

function isProtectedView(viewName) {
  return ["profile", "admin"].includes(viewName);
}

function hideProtectedViewUntilAuthReady() {
  document.body.classList.remove("protected-pending");

  if (!isProtectedView(appState.currentView)) {
    document.body.style.visibility = "visible";
    return;
  }

  document.body.classList.add("protected-pending");
  document.body.style.visibility = "hidden";
}

function revealProtectedViewAfterAuthReady() {
  document.body.classList.remove("protected-pending");
  document.body.style.visibility = "visible";
}

// ============================================================
// Authentication and Authorization Functions
// ============================================================

function isAuthenticated() {
  return appState.currentUser !== null;
}

function getCurrentUserRole() {
  return appState.userRole;
}

/**
 * Whether the current user administers a specific park.
 *
 * Mirrors managesPark() in firestore.rules: Site Admins manage every park, Park
 * Admins only those in their assignedParks list. Role-only checks are not enough
 * for park-scoped actions -- the rules would reject the write and the user would
 * see a raw permission error instead of a disabled control.
 *
 * Called with no parkId (e.g. before a park is selected), this falls back to the
 * role check so admin panels still render.
 */
function managesPark(parkId) {
  const role = getCurrentUserRole();

  if (role === USER_ROLES.SITE_ADMIN) {
    return true;
  }

  if (role !== USER_ROLES.PARK_ADMIN) {
    return false;
  }

  if (!parkId) {
    return true;
  }

  return (appState.assignedParks || []).includes(parkId);
}

function canCreateParkRecord() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.SITE_ADMIN;
}

function canEditParkRecord(parkId = appState.selectedPark?.id) {
  const role = getCurrentUserRole();

  if (role !== USER_ROLES.PARK_ADMIN && role !== USER_ROLES.SITE_ADMIN) {
    return false;
  }

  return managesPark(parkId);
}

function canDeleteParkRecord() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.SITE_ADMIN;
}

function canAccessAdminView() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.PARK_ADMIN || role === USER_ROLES.SITE_ADMIN;
}

// Park-scoped permissions. Each combines the role rule from PARK_ROLE_RULES with
// the assigned-park check enforced by managesPark() in firestore.rules.
function canManageSafetyReports(parkId = appState.selectedPark?.id) {
  return canPerformAction(getCurrentUserRole(), "safetyReportTransition")
    && managesPark(parkId);
}

function canManageEquipment(parkId = appState.selectedPark?.id) {
  return canPerformAction(getCurrentUserRole(), "equipmentStatusChange")
    && managesPark(parkId);
}

function canDeleteSafetyReports() {
  // Site Admin only per PARK_ROLE_RULES; no park scoping needed.
  return canPerformAction(getCurrentUserRole(), "safetyReportDelete");
}

function canDeleteEquipmentRecords(parkId = appState.selectedPark?.id) {
  return canPerformAction(getCurrentUserRole(), "equipmentDelete")
    && managesPark(parkId);
}

function enforceRoleOrThrow(requiredRoles) {
  const currentRole = getCurrentUserRole();
  if (!requiredRoles.includes(currentRole)) {
    throw new Error(`You don't have permission to perform this action. Required role(s): ${requiredRoles.join(", ")}`);
  }
}

function formatAppError(error, fallbackMessage) {
  return error?.message || fallbackMessage;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDisplayDateTime(value) {
  if (!value) {
    return "Not reported yet";
  }

  const date = parseDateForLocalDisplay(value);
  if (Number.isNaN(date.getTime())) {
    return "Not reported yet";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function parseDateForLocalDisplay(value) {
  if (!value) {
    return new Date("");
  }

  const raw = String(value);
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

  if (dateOnlyPattern.test(raw)) {
    // Noon UTC avoids most local-date rollbacks when formatting in negative time zones.
    return new Date(`${raw}T12:00:00.000Z`);
  }

  return new Date(raw);
}

function getBusyLevelTone(label) {
  switch (label) {
    case "Low":
      return "busy-level-low";
    case "Moderate":
      return "busy-level-moderate";
    case "Busy":
      return "busy-level-busy";
    case "Very Busy":
      return "busy-level-very-busy";
    default:
      return "busy-level-unknown";
  }
}

function renderBusyLevelBadge(busyLevel = {}) {
  const score = Number.isFinite(busyLevel.score) ? busyLevel.score : null;
  const label = busyLevel.label || "Unknown";
  const toneClass = getBusyLevelTone(label);
  const scoreSuffix = score !== null ? ` <span class="busy-level-score">${escapeHtml(String(score))}</span>` : "";

  return `<span class="busy-level-pill ${toneClass}">${escapeHtml(label)}${scoreSuffix}</span>`;
}

function getSafetyReportBadgeClass(status) {
  switch (status) {
    case SAFETY_REPORT_STATUSES.OPEN:
      return "badge-open";
    case SAFETY_REPORT_STATUSES.IN_REVIEW:
      return "badge-in-review";
    case SAFETY_REPORT_STATUSES.RESOLVED:
      return "badge-resolved";
    case SAFETY_REPORT_STATUSES.CLOSED:
      return "badge-closed";
    default:
      return "badge-closed";
  }
}

function getEquipmentBadgeClass(status) {
  switch (status) {
    case EQUIPMENT_STATUSES.OPERATIONAL:
      return "badge-operational";
    case EQUIPMENT_STATUSES.NEEDS_REPAIR:
      return "badge-needs-repair";
    case EQUIPMENT_STATUSES.OUT_OF_SERVICE:
      return "badge-out-of-service";
    default:
      return "badge-out-of-service";
  }
}

function formatSafetyReportType(type) {
  switch (String(type || "").toLowerCase()) {
    case "hazard":
      return "Hazard";
    case "injury":
      return "Injury";
    case "concern":
      return "General Concern";
    case "safety":
      return "Safety";
    case "maintenance":
      return "Maintenance";
    default:
      return "Report";
  }
}

function formatEquipmentType(type) {
  switch (String(type || "").toLowerCase()) {
    case "playground":
      return "Playground";
    case "surface":
      return "Surface";
    case "facility":
      return "Facility";
    default:
      return "-";
  }
}

function formatStatusLabel(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatNotificationTitle(notification = {}) {
  if (notification.title) {
    return notification.title;
  }

  if (notification.event === "safety_report_status_changed") {
    const parkName = notification.payload?.parkName || "Unknown park";
    return `Safety report updated: ${parkName}`;
  }

  return "Update";
}

function formatNotificationMessage(notification = {}) {
  if (notification.message) {
    return notification.message;
  }

  if (notification.payload?.message) {
    return notification.payload.message;
  }

  if (notification.event === "safety_report_status_changed") {
    const reportType = notification.payload?.type || "safety report";
    const fromStatus = formatStatusLabel(notification.payload?.fromStatus) || "Unknown";
    const toStatus = formatStatusLabel(notification.payload?.toStatus) || "Unknown";
    return `${reportType} status changed from ${fromStatus} to ${toStatus}.`;
  }

  return "A new update is available.";
}

function formatShortDate(value) {
  if (!value) {
    return "-";
  }

  const date = parseDateForLocalDisplay(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function normalizeNotificationList(notifications = []) {
  const normalized = [...notifications].map((notification) => ({
    ...notification,
    isRead: typeof notification.isRead === "boolean" ? notification.isRead : Boolean(notification.read)
  }));

  const sorted = normalized.sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });

  appState.notifications = sorted;
  appState.unreadNotificationCount = sorted.filter((notification) => !notification.isRead).length;
}

function getParkCoordinates(park) {
  if (!park) {
    return null;
  }

  // Support flat top-level fields (latitude/longitude), legacy aliases (lat/lng/lon),
  // and the nested { coordinates: { lat, lng } } format used by seed data and earlier park records.
  const lat = Number(
    park.latitude ?? park.lat ?? park.coordinates?.lat ?? park.coordinates?.latitude
  );
  const lng = Number(
    park.longitude ?? park.lng ?? park.lon ?? park.coordinates?.lng ?? park.coordinates?.longitude ?? park.coordinates?.lon
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return [lat, lng];
}

function getBusyLevelMapClass(label) {
  const normalized = String(label || "Unknown").toLowerCase();

  if (normalized === "low") {
    return "low";
  }

  if (normalized === "moderate") {
    return "moderate";
  }

  if (normalized === "busy") {
    return "busy";
  }

  if (normalized === "very busy") {
    return "very-busy";
  }

  return "unknown";
}

function getBusyLevelMapColor(label) {
  const statusClass = getBusyLevelMapClass(label);
  switch (statusClass) {
    case "low":
      return "#2e7d32";
    case "moderate":
      return "#f57f17";
    case "busy":
      return "#e65100";
    case "very-busy":
      return "#c62828";
    default:
      return "#546e7a";
  }
}

function clearCrowdReportState() {
  appState.crowdReportSubmitting = false;
  appState.crowdReportError = null;
  appState.crowdReportSuccess = null;
  appState.crowdReportLevel = "1";
  appState.latestBusyLevel = null;
  appState.lastCrowdReportWindowKey = null;
}

function clearCommunityFeedback() {
  appState.reviewError = null;
  appState.reviewSuccess = null;
  appState.photoError = null;
  appState.photoSuccess = null;
}

function showWelcomePopup(user) {
  const overlayContainer = document.getElementById("welcome-popup-overlay");
  if (!overlayContainer) {
    return;
  }

  const displayName = user?.displayName || "User";
  overlayContainer.innerHTML = `
    <div class="welcome-popup-overlay" id="welcome-popup-inner">
      <div class="welcome-popup">
        <h2>Welcome, ${escapeHtml(displayName)}!</h2>
        <p>You are now signed in to Playground Pulse.</p>
      </div>
    </div>
  `;

  // Remove the popup from the DOM after the animation completes (2.5 seconds).
  setTimeout(() => {
    overlayContainer.innerHTML = "";
  }, 2600);
}

function updateCrowdReportLevel(level) {
  appState.crowdReportLevel = String(level || "1");
  appState.crowdReportError = null;
  appState.crowdReportSuccess = null;
  renderCrowdReportPanel();
}

async function loadCrowdReportStateForPark(parkId) {
  const park = await getParkById(parkId);
  let recentReports = [];

  try {
    recentReports = await getRecentCrowdReportsForPark(parkId);
  } catch (error) {
    // Keep park detail usable even when crowd-report query/indexes are unavailable.
    console.warn("Crowd report enrichment unavailable for selected park:", error);
  }

  const busyLevel = calculateBusyLevelFromReports(recentReports);
  const latestReport = recentReports[0] || null;
  const fallbackBusyLevel = park.busyLevel || {};
  const fallbackCrowdReporting = park.crowdReporting || {};

  // Treat persisted busyLevel data as stale if it is older than the calculation window.
  // This prevents a weeks-old cached score from being displayed as current.
  const staleThresholdMs = CROWD_REPORT_POLICY.windowMinutes * 60 * 1000;
  const fallbackUpdatedMs = fallbackBusyLevel.updatedAt
    ? new Date(fallbackBusyLevel.updatedAt).getTime()
    : 0;
  const fallbackIsStale = (Date.now() - fallbackUpdatedMs) > staleThresholdMs;

  const enrichedPark = {
    ...park,
    busyLevel: {
      score: busyLevel.score ?? (fallbackIsStale ? null : (fallbackBusyLevel.score ?? null)),
      label: busyLevel.score !== null
        ? busyLevel.label
        : (fallbackIsStale ? "Unknown" : (fallbackBusyLevel.label || "Unknown")),
      updatedAt: latestReport?.reportedAt || (fallbackIsStale ? null : (fallbackBusyLevel.updatedAt || null))
    },
    crowdReporting: {
      enabled: true,
      reportCountLastHour: recentReports.length ? busyLevel.reportCount : (fallbackIsStale ? 0 : Number(fallbackCrowdReporting.reportCountLastHour || 0)),
      lastReportedAt: latestReport?.reportedAt || (fallbackIsStale ? null : (fallbackCrowdReporting.lastReportedAt || null)),
      latestWindowKey: latestReport?.windowKey || (fallbackIsStale ? null : (fallbackCrowdReporting.latestWindowKey || null))
    }
  };

  appState.latestBusyLevel = enrichedPark.busyLevel;
  appState.lastCrowdReportWindowKey = latestReport?.windowKey || null;

  return enrichedPark;
}

function syncParkResultsWithSelectedPark(updatedPark) {
  if (!updatedPark?.id || !Array.isArray(appState.parkResults) || appState.parkResults.length === 0) {
    return;
  }

  appState.parkResults = appState.parkResults.map((park) => {
    if (park.id !== updatedPark.id) {
      return park;
    }

    return {
      ...park,
      busyLevel: updatedPark.busyLevel,
      crowdReporting: updatedPark.crowdReporting
    };
  });
}

async function persistCrowdReportParkState(updatedPark) {
  if (!updatedPark?.id) {
    return updatedPark;
  }

  const payload = {
    busyLevel: updatedPark.busyLevel,
    crowdReporting: updatedPark.crowdReporting,
    updatedAt: new Date().toISOString()
  };

  await updateRecord("parks", updatedPark.id, payload);

  return {
    ...updatedPark,
    ...payload
  };
}

async function loadSafetyReportsForSelectedPark() {
  if (!appState.selectedPark?.id) {
    appState.safetyReports = [];
    return;
  }

  appState.safetyReportsLoading = true;
  try {
    appState.safetyReports = await getSafetyReports(appState.selectedPark.id, {
      status: appState.safetyReportStatusFilter || null
    });
  } finally {
    appState.safetyReportsLoading = false;
  }
}

async function loadEquipmentForSelectedPark() {
  if (!appState.selectedPark?.id) {
    appState.equipmentItems = [];
    return;
  }

  appState.equipmentLoading = true;
  try {
    appState.equipmentItems = await getEquipment(appState.selectedPark.id);
  } finally {
    appState.equipmentLoading = false;
  }
}

async function loadCrowdHistoryForSelectedPark() {
  if (!appState.selectedPark?.id) {
    appState.crowdHistory = [];
    appState.crowdHistoryError = null;
    return;
  }

  try {
    appState.crowdHistory = await getCrowdHistory(appState.selectedPark.id, 7);
    appState.crowdHistoryError = null;
  } catch (error) {
    appState.crowdHistoryError = formatAppError(error, "Unable to load crowd history.");
    appState.crowdHistory = [];
  }
}

async function loadSprint3DetailData() {
  if (!appState.selectedPark?.id) {
    appState.safetyReports = [];
    appState.equipmentItems = [];
    appState.crowdHistory = [];
    return;
  }

  await Promise.all([
    loadSafetyReportsForSelectedPark(),
    loadEquipmentForSelectedPark(),
    loadCrowdHistoryForSelectedPark()
  ]);
}

async function loadAdminParkOptions() {
  if (appState.currentView !== "admin") {
    return;
  }

  appState.adminParks = await readRecords("parks", {});
  if (!appState.adminSelectedParkId && appState.adminParks.length > 0) {
    appState.adminSelectedParkId = appState.adminParks[0].id;
  }
}

function stopNotificationsSubscription() {
  if (typeof appState.notificationsUnsubscribe === "function") {
    appState.notificationsUnsubscribe();
  }

  appState.notificationsUnsubscribe = null;
}

async function startNotificationsSubscription() {
  if (!appState.currentUser?.uid) {
    stopNotificationsSubscription();
    normalizeNotificationList([]);
    return;
  }

  stopNotificationsSubscription();

  try {
    const initialNotifications = await getUserNotifications(appState.currentUser.uid, {
      limitCount: 20,
      includeRead: true
    });
    normalizeNotificationList(initialNotifications);
    renderNotificationPanel();
  } catch (error) {
    appState.notificationsError = formatAppError(error, "Unable to load notifications.");
  }

  appState.notificationsUnsubscribe = subscribeToUserNotifications(
    appState.currentUser.uid,
    (notifications) => {
      normalizeNotificationList(notifications);
      appState.notificationsError = null;
      renderNotificationPanel();
    },
    (error) => {
      appState.notificationsError = formatAppError(error, "Unable to subscribe to notifications.");
      renderNotificationPanel();
    }
  );
}

function renderCrowdReportPanel() {
  const reportContainer = appState.activeParkActionModal === "crowd"
    ? document.getElementById("park-action-modal-content")
    : getDashboardTargetContainer("crowd-report-container", "crowd-report-modal-container");
  if (!reportContainer) {
    return;
  }

  if (!isAuthenticated() || !appState.selectedPark || appState.activeParkActionModal !== "crowd") {
    reportContainer.innerHTML = "";
    return;
  }

  const park = appState.selectedPark;
  const busyLevel = park.busyLevel || {};
  const reportCount = park.crowdReporting?.reportCountLastHour || 0;
  const lastReportedAt = park.crowdReporting?.lastReportedAt || null;
  const selectedLevel = appState.crowdReportLevel || "1";

  reportContainer.innerHTML = `
    <section class="crowd-report-panel">
      <div class="crowd-report-header">
        <h3>Report Crowd Level</h3>
        <div class="crowd-report-busy-summary">
          ${renderBusyLevelBadge(busyLevel)}
          <p class="crowd-report-meta">${reportCount} report(s) in the last 2.5 hrs</p>
          <p class="crowd-report-meta">Last update: ${escapeHtml(formatDisplayDateTime(lastReportedAt))}</p>
        </div>
      </div>

      ${appState.crowdReportError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.crowdReportError)}</p>` : ""}
      ${appState.crowdReportSuccess ? `<p class="crowd-report-message crowd-report-success">${escapeHtml(appState.crowdReportSuccess)}</p>` : ""}

      <form class="crowd-report-form" onsubmit="event.preventDefault(); window.appControllerExports.submitCrowdReportFromSelection();">
        <div class="form-group">
          <label for="crowd-report-level">Current Crowd Level</label>
          <select id="crowd-report-level" onchange="window.appControllerExports.updateCrowdReportLevel(this.value)">
            <option value="1" ${selectedLevel === "1" ? "selected" : ""}>1 - Low</option>
            <option value="2" ${selectedLevel === "2" ? "selected" : ""}>2 - Moderate</option>
            <option value="3" ${selectedLevel === "3" ? "selected" : ""}>3 - Busy</option>
            <option value="4" ${selectedLevel === "4" ? "selected" : ""}>4 - Very Busy</option>
          </select>
        </div>

        <div class="crowd-report-actions">
          <button type="submit" class="btn btn-primary" ${appState.crowdReportSubmitting ? "disabled" : ""}>
            ${appState.crowdReportSubmitting ? "Submitting..." : "Submit Crowd Report"}
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.appControllerExports.clearCrowdReportSelection()" ${appState.crowdReportSubmitting ? "disabled" : ""}>
            Clear Report
          </button>
        </div>
      </form>
    </section>
  `;
}

function ensureParkActionModalMountedToBody() {
  if (appState.currentView !== "dashboard") {
    return;
  }

  const modal = document.getElementById("park-action-modal");
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
}

function setParkActionModal(actionName = null) {
  appState.activeParkActionModal = actionName;

  if (appState.currentView !== "dashboard") {
    return;
  }

  ensureParkActionModalMountedToBody();
  const modal = document.getElementById("park-action-modal");
  const modalContent = document.getElementById("park-action-modal-content");
  const isOpen = Boolean(actionName);

  if (modal) {
    modal.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }

  document.body.classList.toggle("park-action-modal-open", isOpen);

  if (!isOpen && modalContent) {
    modalContent.innerHTML = "";
  }

  if (!isOpen) {
    return;
  }

  if (modalContent) {
    modalContent.scrollTop = 0;
  }

  if (actionName === "crowd") {
    renderCrowdReportPanel();
  }

  if (actionName === "equipment") {
    renderEquipmentPanel();
  }

  if (actionName === "review") {
    renderReviewActionPanel();
  }

  if (actionName === "edit") {
    renderParkForm();
  }

  if (actionName === "delete") {
    renderDeleteParkModal();
  }
}

function openParkActionModal(actionName) {
  if (!appState.selectedPark) {
    return;
  }

  setParkActionModal(actionName);
}

function closeParkActionModal() {
  setParkActionModal(null);
}

/**
 * Caches the last known auth state so the next page load can paint the nav
 * correctly on its first frame.
 *
 * Firebase restores sessions asynchronously, so any JS-driven label necessarily
 * arrives after first paint. Writing the outcome here lets the inline <head>
 * script on the next navigation read it synchronously and render the right
 * button immediately, eliminating the flash entirely.
 *
 * This is a rendering hint ONLY. It is client-writable and must never be treated
 * as proof of identity or permission; real enforcement stays in firestore.rules
 * and the route guards, which continue to run against the verified token.
 */
function persistAuthHint(firebaseUser, role) {
  try {
    if (!firebaseUser) {
      window.localStorage.removeItem(AUTH_HINT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(AUTH_HINT_STORAGE_KEY, JSON.stringify({
      signedIn: true,
      isAdmin: role === USER_ROLES.PARK_ADMIN || role === USER_ROLES.SITE_ADMIN
    }));
  } catch (error) {
    // Private browsing or a full quota. The nav still resolves normally once
    // auth completes; only the first-paint optimization is lost.
  }
}

function updateAuthNavButton() {
  const existingButton = document.getElementById("logout-btn");
  if (!existingButton) {
    return;
  }

  const replacementButton = existingButton.cloneNode(true);
  existingButton.replaceWith(replacementButton);

  // Until Firebase restores the session we genuinely do not know whether this is
  // a Login or a Logout button, so keep it invisible rather than guessing. The
  // markup ships with `data-auth-pending`, which reserves the button's space but
  // hides it; committing to a label here is what caused the Login -> Logout flash.
  if (!appState.authReady) {
    return;
  }

  replacementButton.removeAttribute("data-auth-pending");

  if (isAuthenticated()) {
    replacementButton.textContent = "Logout";
    replacementButton.addEventListener("click", handleLogout);
    return;
  }

  replacementButton.textContent = "Login";
  replacementButton.addEventListener("click", () => {
    window.location.href = "./login.html";
  });
}

function ensureDashboardModalMountedToBody() {
  if (appState.currentView !== "dashboard") {
    return;
  }

  const modal = document.getElementById("dashboard-park-modal");
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
}

function setDashboardParkModalOpen(isOpen) {
  appState.dashboardParkModalOpen = Boolean(isOpen);

  if (appState.currentView !== "dashboard") {
    return;
  }

  ensureDashboardModalMountedToBody();

  const modal = document.getElementById("dashboard-park-modal");
  if (modal) {
    modal.setAttribute("aria-hidden", appState.dashboardParkModalOpen ? "false" : "true");

    if (appState.dashboardParkModalOpen) {
      modal.scrollTop = 0;
      const modalContent = modal.querySelector(".dashboard-park-modal-content");
      if (modalContent instanceof HTMLElement) {
        modalContent.scrollTop = 0;
      }
    }
  }

  document.body.classList.toggle("dashboard-park-modal-open", appState.dashboardParkModalOpen);
}

function getDashboardTargetContainer(defaultContainerId, modalContainerId) {
  const defaultContainer = document.getElementById(defaultContainerId);
  const modalContainer = document.getElementById(modalContainerId);
  const shouldUseModal = appState.currentView === "dashboard" && appState.dashboardParkModalOpen && Boolean(modalContainer);

  if (shouldUseModal) {
    if (defaultContainer) {
      defaultContainer.innerHTML = "";
    }
    return modalContainer;
  }

  if (modalContainer) {
    modalContainer.innerHTML = "";
  }

  return defaultContainer;
}

function isEventInsideDashboardModalContent(event) {
  if (event && typeof event.composedPath === "function") {
    const eventPath = event.composedPath();
    const hasModalContentInPath = eventPath.some((node) =>
      node instanceof Element && node.classList.contains("dashboard-park-modal-content")
    );

    if (hasModalContentInPath) {
      return true;
    }
  }

  const rawTarget = event?.target;
  const targetElement = rawTarget instanceof Element
    ? rawTarget
    : (rawTarget instanceof Node ? rawTarget.parentElement : null);

  return Boolean(targetElement?.closest(".dashboard-park-modal-content"));
}

function renderNotificationPanel() {
  const toggleButton = document.getElementById("admin-notifications-toggle-btn");
  const unreadBadge = document.getElementById("admin-notification-unread-count");
  const adminNavBadge = document.getElementById("admin-notification-count");
  const panelContainer = document.getElementById("notification-panel-container");
  const isParentAccount = appState.userRole === USER_ROLES.PARENT;
  const isDashboardView = appState.currentView === "dashboard";

  const canShowNotifications = isAuthenticated() && !isParentAccount && appState.currentView === "admin";

  if (toggleButton) {
    toggleButton.style.display = canShowNotifications ? "inline-flex" : "none";
  }

  if (unreadBadge) {
    const hasUnread = appState.unreadNotificationCount > 0;
    unreadBadge.style.display = hasUnread ? "inline-block" : "none";
    unreadBadge.textContent = String(appState.unreadNotificationCount);
  }

  if (adminNavBadge) {
    const hasUnread = appState.unreadNotificationCount > 0;
    adminNavBadge.style.display = hasUnread ? "inline-block" : "none";
    adminNavBadge.textContent = String(appState.unreadNotificationCount);
  }

  if (adminNavBadge && isDashboardView) {
    adminNavBadge.style.display = "none";
    adminNavBadge.textContent = "0";
  }

  if (!panelContainer || !canShowNotifications || isDashboardView) {
    if (panelContainer) {
      panelContainer.innerHTML = "";
    }
    return;
  }

  if (!appState.notificationsPanelOpen) {
    panelContainer.innerHTML = "";
    return;
  }

  panelContainer.innerHTML = `
    <section class="notification-panel card">
      <h3>Notifications</h3>
      ${appState.notificationsError ? `<p class="crowd-report-error crowd-report-message">${escapeHtml(appState.notificationsError)}</p>` : ""}
      ${appState.notifications.length === 0 ? "<p>No notifications yet.</p>" : ""}
      <ul class="notification-list">
        ${appState.notifications.map((notification) => `
          <li class="notification-item ${notification.isRead ? "read" : ""}">
            <p><strong>${escapeHtml(formatNotificationTitle(notification))}</strong></p>
            <p>${escapeHtml(formatNotificationMessage(notification))}</p>
            ${notification.payload?.parkName ? `<p class="crowd-report-meta">Park: ${escapeHtml(notification.payload.parkName)}</p>` : ""}
            <p class="crowd-report-meta">${escapeHtml(formatDisplayDateTime(notification.createdAt))}</p>
            ${notification.isRead ? "" : `<button class="btn btn-secondary" onclick="window.appControllerExports.markNotificationRead('${notification.id}')">Mark as read</button>`}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderSafetyReportPanel() {
  const container = document.getElementById("safety-report-container");
  if (!container) {
    return;
  }

  if (!isAuthenticated() || !appState.selectedPark) {
    container.innerHTML = "";
    return;
  }

  const canManage = canManageSafetyReports();
  const canDelete = canDeleteSafetyReports();

  container.innerHTML = `
    <section class="safety-report-panel card">
      <h3>Safety Reports</h3>
      ${appState.safetyReportError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.safetyReportError)}</p>` : ""}
      ${appState.safetyReportSuccess ? `<p class="crowd-report-message crowd-report-success">${escapeHtml(appState.safetyReportSuccess)}</p>` : ""}

      <form class="safety-report-form" onsubmit="event.preventDefault(); window.appControllerExports.submitSafetyReport();">
        <div class="form-group">
          <label for="safety-report-type">Report Type</label>
          <select id="safety-report-type" onchange="window.appControllerExports.updateSafetyReportType(this.value)">
            <option value="hazard" ${appState.safetyReportType === "hazard" ? "selected" : ""}>Hazard</option>
            <option value="injury" ${appState.safetyReportType === "injury" ? "selected" : ""}>Injury</option>
            <option value="concern" ${appState.safetyReportType === "concern" ? "selected" : ""}>General Concern</option>
            <option value="safety" ${appState.safetyReportType === "safety" ? "selected" : ""}>Safety</option>
            <option value="maintenance" ${appState.safetyReportType === "maintenance" ? "selected" : ""}>Maintenance</option>
          </select>
        </div>
        <div class="form-group">
          <label for="safety-report-description">Description</label>
          <textarea id="safety-report-description" rows="3" oninput="window.appControllerExports.updateSafetyReportDescription(this.value)" placeholder="Describe what you observed...">${escapeHtml(appState.safetyReportDescription)}</textarea>
        </div>
        <button type="submit" class="btn btn-primary" ${appState.safetyReportSubmitting ? "disabled" : ""}>
          ${appState.safetyReportSubmitting ? "Submitting..." : "Submit Safety Report"}
        </button>
      </form>

      <div class="status-action-row" style="margin-top: 1rem;">
        <label for="safety-report-status-filter"><strong>Filter:</strong></label>
        <select id="safety-report-status-filter" onchange="window.appControllerExports.updateSafetyReportFilter(this.value)">
          <option value="" ${appState.safetyReportStatusFilter === "" ? "selected" : ""}>All statuses</option>
          <option value="open" ${appState.safetyReportStatusFilter === "open" ? "selected" : ""}>Open</option>
          <option value="in_review" ${appState.safetyReportStatusFilter === "in_review" ? "selected" : ""}>In Review</option>
          <option value="resolved" ${appState.safetyReportStatusFilter === "resolved" ? "selected" : ""}>Resolved</option>
          <option value="closed" ${appState.safetyReportStatusFilter === "closed" ? "selected" : ""}>Closed</option>
        </select>
      </div>

      <div class="safety-report-grid" style="margin-top: 1rem;">
        ${appState.safetyReportsLoading ? "<p>Loading safety reports...</p>" : ""}
        ${!appState.safetyReportsLoading && appState.safetyReports.length === 0 ? "<p>No safety reports yet for this park.</p>" : ""}
        ${appState.safetyReports.map((report) => {
          const transitionOptions = SAFETY_REPORT_TRANSITIONS[report.status] || [];
          return `
            <article class="safety-report-item">
              <div class="safety-report-item-header">
                <strong>${escapeHtml(formatSafetyReportType(report.type || report.reportType))}</strong>
                <span class="badge ${getSafetyReportBadgeClass(report.status)}">${escapeHtml(report.status || "unknown")}</span>
              </div>
              <p>${escapeHtml(report.description || "No description provided.")}</p>
              <p class="crowd-report-meta">Reported: ${escapeHtml(formatDisplayDateTime(report.createdAt))}</p>
              ${canManage && transitionOptions.length > 0 ? `
                <div class="status-action-row">
                  ${transitionOptions.map((status) => `
                    <button type="button" onclick="window.appControllerExports.transitionSafetyReport('${report.id}', '${status}')">
                      Mark ${escapeHtml(status)}
                    </button>
                  `).join("")}
                  ${canDelete ? `<button type="button" onclick="window.appControllerExports.deleteSafetyReport('${report.id}')">Delete Report</button>` : ""}
                </div>
              ` : (canDelete ? `
                <div class="status-action-row">
                  <button type="button" onclick="window.appControllerExports.deleteSafetyReport('${report.id}')">Delete Report</button>
                </div>
              ` : "")}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderEquipmentPanel() {
  const container = appState.activeParkActionModal === "equipment"
    ? document.getElementById("park-action-modal-content")
    : getDashboardTargetContainer("equipment-panel-container", "equipment-panel-modal-container");
  if (!container) {
    return;
  }

  if (!isAuthenticated() || !appState.selectedPark || appState.activeParkActionModal !== "equipment") {
    container.innerHTML = "";
    return;
  }

  const canManage = canManageEquipment();
  const canDelete = canDeleteEquipmentRecords();

  container.innerHTML = `
    <section class="equipment-panel card">
      <h3>Equipment Status</h3>
      ${appState.equipmentError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.equipmentError)}</p>` : ""}
      ${appState.equipmentSuccess ? `<p class="crowd-report-message crowd-report-success">${escapeHtml(appState.equipmentSuccess)}</p>` : ""}

      ${canManage ? `
        <form class="equipment-form" onsubmit="event.preventDefault(); window.appControllerExports.submitEquipment();">
          <div class="form-group">
            <label for="equipment-name">Equipment Name</label>
            <input id="equipment-name" type="text" value="${escapeHtml(appState.equipmentNameInput)}" oninput="window.appControllerExports.updateEquipmentName(this.value)" placeholder="e.g., Swing Set" />
          </div>
          <div class="form-group">
            <label for="equipment-type">Type</label>
            <select id="equipment-type" onchange="window.appControllerExports.updateEquipmentType(this.value)">
              <option value="playground" ${appState.equipmentTypeInput === "playground" ? "selected" : ""}>Playground</option>
              <option value="surface" ${appState.equipmentTypeInput === "surface" ? "selected" : ""}>Surface</option>
              <option value="facility" ${appState.equipmentTypeInput === "facility" ? "selected" : ""}>Facility</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" ${appState.equipmentSubmitting ? "disabled" : ""}>
            ${appState.equipmentSubmitting ? "Saving..." : "Add Equipment"}
          </button>
        </form>
      ` : ""}

      <div class="equipment-grid" style="margin-top: 1rem;">
        ${appState.equipmentLoading ? "<p>Loading equipment...</p>" : ""}
        ${!appState.equipmentLoading && appState.equipmentItems.length === 0 ? "<p>No equipment records available.</p>" : ""}
        ${appState.equipmentItems.map((equipment) => `
          <article class="equipment-item">
            <div class="equipment-item-header">
              <strong>${escapeHtml(equipment.name || "Unnamed Equipment")}</strong>
              <span class="badge ${getEquipmentBadgeClass(equipment.status)}">${escapeHtml(EQUIPMENT_STATUS_LABELS[equipment.status] || equipment.status || "Unknown")}</span>
            </div>
            <p class="crowd-report-meta">Type: ${escapeHtml(formatEquipmentType(equipment.type || equipment.equipmentType))}</p>
            ${canManage || canDelete ? `
              <div class="status-action-row">
                ${Object.values(EQUIPMENT_STATUSES).map((status) => `
                  <button type="button" onclick="window.appControllerExports.transitionEquipmentStatus('${equipment.id}', '${status}')">${escapeHtml(EQUIPMENT_STATUS_LABELS[status] || status)}</button>
                `).join("")}
                ${canDelete ? `<button type="button" onclick="window.appControllerExports.deleteEquipment('${equipment.id}')">Delete Equipment</button>` : ""}
              </div>
            ` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCrowdHistoryPanel() {
  const container = getDashboardTargetContainer("crowd-history-container", "crowd-history-modal-container");
  if (!container) {
    return;
  }

  if (!appState.selectedPark) {
    container.innerHTML = "";
    return;
  }

  // Auto-refresh if the date range no longer includes today (UTC).
  const todayUTC = new Date().toISOString().slice(0, 10);
  const hasTodayInRange = appState.crowdHistory.some((day) => day?.date === todayUTC);
  const rangeIsStale = appState.crowdHistory.length > 0 && !hasTodayInRange;

  if (rangeIsStale && !appState.crowdHistoryStaleRefreshPending) {
    appState.crowdHistoryStaleRefreshPending = true;
    loadCrowdHistoryForSelectedPark()
      .then(() => {
        appState.crowdHistoryStaleRefreshPending = false;
        renderCrowdHistoryPanel();
      })
      .catch(() => {
        appState.crowdHistoryStaleRefreshPending = false;
      });
    // Fall through to render current (stale) state while refresh is in flight.
  }

  const maxCount = appState.crowdHistory.reduce((max, item) => Math.max(max, Number(item.reportCount || 0)), 0);

  container.innerHTML = `
    <section class="crowd-history-panel card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
        <h3 style="margin: 0;">7-Day Crowd Trend</h3>
        <button class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.25rem 0.7rem;"
          onclick="window.appControllerExports.refreshCrowdHistory()"
          ${appState.crowdHistoryStaleRefreshPending ? "disabled" : ""}>
          ${appState.crowdHistoryStaleRefreshPending ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      ${appState.crowdHistoryError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.crowdHistoryError)}</p>` : ""}
      ${appState.crowdHistory.length === 0 ? "<p>No crowd history is available yet for this park.</p>" : `
        <div class="crowd-history-bars">
          ${appState.crowdHistory.map((day) => {
            const count = Number(day.reportCount || 0);
            const percent = maxCount > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 8;
            const barColor = count > 0 ? getBusyLevelMapColor(day.label) : "#cdd8e3";
            const labelText = count > 0 ? day.label : "No data";
            return `
              <div class="crowd-history-day">
                <div class="crowd-history-bar-wrap">
                  <div class="crowd-history-bar" style="height: ${percent}%; background-color: ${barColor};" title="${count} report(s) — ${labelText}"></div>
                </div>
                <strong>${count}</strong>
                <span class="crowd-history-date">${escapeHtml(formatShortDate(day.date))}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div style="margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.6rem; font-size: 0.8rem;">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#2e7d32;margin-right:4px;"></span>Low</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f57f17;margin-right:4px;"></span>Moderate</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#e65100;margin-right:4px;"></span>Busy</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#c62828;margin-right:4px;"></span>Very Busy</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#cdd8e3;margin-right:4px;"></span>No data</span>
        </div>
      `}
    </section>
  `;
}

function renderMapPanel() {
  const DEFAULT_LIVONIA_CENTER = [42.3684, -83.3527];
  const DEFAULT_LIVONIA_ZOOM = 11;

  const container = document.getElementById("park-map-container");
  if (!container) {
    return;
  }

  const toggleButton = document.getElementById("toggle-map-view-btn");
  if (toggleButton) {
    const shouldShowToggle = appState.currentView === "dashboard";
    toggleButton.style.display = shouldShowToggle ? "inline-flex" : "none";
    toggleButton.textContent = appState.mapMode ? "Hide Map" : "Map View";
  }

  if (!appState.mapMode || appState.currentView !== "dashboard") {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  if (!container.querySelector("#leaflet-map-canvas")) {
    container.innerHTML = `
      <section class="card">
        <h3>Park Map View</h3>
        <div id="leaflet-map-canvas" class="park-map-view"></div>
      </section>
    `;
  }

  if (!window.L) {
    container.innerHTML += "<p class='crowd-report-message crowd-report-error'>Map library failed to load.</p>";
    return;
  }

  const mapElement = document.getElementById("leaflet-map-canvas");
  if (!mapElement) {
    return;
  }

  if (appState.mapInstance && appState.mapInstance.getContainer() !== mapElement) {
    appState.mapInstance.remove();
    appState.mapInstance = null;
    appState.mapMarkersLayer = null;
  }

  if (!appState.mapInstance) {
    appState.mapInstance = window.L.map(mapElement).setView(DEFAULT_LIVONIA_CENTER, DEFAULT_LIVONIA_ZOOM);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(appState.mapInstance);
    appState.mapMarkersLayer = window.L.layerGroup().addTo(appState.mapInstance);
  }

  appState.mapInstance.invalidateSize();

  if (appState.mapMarkersLayer) {
    appState.mapMarkersLayer.clearLayers();
  }

  const parksWithCoordinates = appState.parkResults
    .map((park) => ({ park, coordinates: getParkCoordinates(park) }))
    .filter((item) => Array.isArray(item.coordinates));

  const hasSearchTerm = Boolean((appState.searchTerm || "").trim());
  const hasFilters = Object.values(appState.filterCriteria || {}).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== null && value !== "";
  });

  if (parksWithCoordinates.length === 0) {
    appState.mapInstance.setView(DEFAULT_LIVONIA_CENTER, DEFAULT_LIVONIA_ZOOM);
    return;
  }

  const bounds = [];
  parksWithCoordinates.forEach(({ park, coordinates }) => {
    const busyLabel = park.busyLevel?.label || "Unknown";
    const marker = window.L.circleMarker(coordinates, {
      radius: 8,
      color: getBusyLevelMapColor(busyLabel),
      fillColor: getBusyLevelMapColor(busyLabel),
      fillOpacity: 0.8,
      weight: 2
    });

    marker.bindPopup(`
      <strong>${escapeHtml(park.name || "Park")}</strong><br />
      ${escapeHtml(park.location || "")}
      <div class="map-marker-badge ${getBusyLevelMapClass(busyLabel)}">${escapeHtml(busyLabel)}</div>
      <div style="margin-top: 0.5rem;">
        <button type="button" onclick="window.appControllerExports.selectParkForDetail('${park.id}')">Open Detail</button>
      </div>
    `);

    marker.on("click", () => {
      selectParkForDetail(park.id).catch((error) => {
        console.error("Map pin selection failed:", error);
      });
    });

    marker.addTo(appState.mapMarkersLayer);
    bounds.push(coordinates);
  });

  if (bounds.length > 0 && (hasSearchTerm || hasFilters)) {
    appState.mapInstance.fitBounds(bounds, { padding: [25, 25] });
    return;
  }

  appState.mapInstance.setView(DEFAULT_LIVONIA_CENTER, DEFAULT_LIVONIA_ZOOM);
}

function renderAdminPanels() {
  const safetyPanel = document.getElementById("admin-safety-panel");
  const equipmentPanel = document.getElementById("admin-equipment-panel");

  if (!safetyPanel || !equipmentPanel) {
    return;
  }

  // Admin console actions are scoped to the park selected in this view, not the
  // dashboard's selectedPark.
  const adminParkId = appState.adminSelectedParkId || "";
  const canDeleteSafety = canDeleteSafetyReports();
  const canDeleteEquipmentItems = canDeleteEquipmentRecords(adminParkId);

  if (!canManageSafetyReports(adminParkId) && !canManageEquipment(adminParkId)) {
    safetyPanel.innerHTML = "<h3>Safety Reports</h3><p>You do not have permission to manage safety reports.</p>";
    equipmentPanel.innerHTML = "<h3>Equipment Status</h3><p>You do not have permission to manage equipment records.</p>";
    return;
  }

  const selectedParkId = adminParkId;

  safetyPanel.innerHTML = `
    <h3>Safety Report Queue</h3>
    ${appState.safetyReportError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.safetyReportError)}</p>` : ""}
    <div class="form-group">
      <label for="admin-park-selector">Selected Park</label>
      <select id="admin-park-selector" onchange="window.appControllerExports.selectAdminPark(this.value)">
        ${appState.adminParks.map((park) => `
          <option value="${escapeHtml(park.id)}" ${park.id === selectedParkId ? "selected" : ""}>${escapeHtml(park.name)}</option>
        `).join("")}
      </select>
    </div>
    <div class="safety-report-grid">
      ${appState.safetyReports.map((report) => `
        <article class="safety-report-item">
          <div class="safety-report-item-header">
            <strong>${escapeHtml(formatSafetyReportType(report.type || report.reportType))}</strong>
            <span class="badge ${getSafetyReportBadgeClass(report.status)}">${escapeHtml(report.status || "unknown")}</span>
          </div>
          <p>${escapeHtml(report.description || "")}</p>
          <p class="crowd-report-meta">${escapeHtml(formatDisplayDateTime(report.createdAt))}</p>
          <div class="status-action-row">
            ${(SAFETY_REPORT_TRANSITIONS[report.status] || []).map((status) => `
              <button type="button" onclick="window.appControllerExports.transitionSafetyReport('${report.id}', '${status}')">${escapeHtml(status)}</button>
            `).join("")}
            ${canDeleteSafety ? `<button type="button" onclick="window.appControllerExports.deleteSafetyReport('${report.id}')">Delete Report</button>` : ""}
          </div>
        </article>
      `).join("")}
      ${appState.safetyReports.length === 0 ? "<p>No safety reports found for this park.</p>" : ""}
    </div>
  `;

  equipmentPanel.innerHTML = `
    <h3>Equipment Status Queue</h3>
    ${appState.equipmentError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.equipmentError)}</p>` : ""}
    <div class="equipment-grid">
      ${appState.equipmentItems.map((equipment) => `
        <article class="equipment-item">
          <div class="equipment-item-header">
            <strong>${escapeHtml(equipment.name || "Unnamed")}</strong>
            <span class="badge ${getEquipmentBadgeClass(equipment.status)}">${escapeHtml(EQUIPMENT_STATUS_LABELS[equipment.status] || equipment.status || "Unknown")}</span>
          </div>
          <p class="crowd-report-meta">Type: ${escapeHtml(formatEquipmentType(equipment.type || equipment.equipmentType))}</p>
          <div class="status-action-row">
            ${Object.values(EQUIPMENT_STATUSES).map((status) => `
              <button type="button" onclick="window.appControllerExports.transitionEquipmentStatus('${equipment.id}', '${status}')">${escapeHtml(EQUIPMENT_STATUS_LABELS[status] || status)}</button>
            `).join("")}
            ${canDeleteEquipmentItems ? `<button type="button" onclick="window.appControllerExports.deleteEquipment('${equipment.id}')">Delete Equipment</button>` : ""}
          </div>
        </article>
      `).join("")}
      ${appState.equipmentItems.length === 0 ? "<p>No equipment records found for this park.</p>" : ""}
    </div>
  `;
}

async function submitCrowdReportFromSelection() {
  try {
    if (!isAuthenticated()) {
      throw new Error("Please sign in to submit a crowd report.");
    }

    if (!appState.selectedPark?.id) {
      throw new Error("Select a park before submitting a crowd report.");
    }

    appState.crowdReportSubmitting = true;
    appState.crowdReportError = null;
    appState.crowdReportSuccess = null;
    renderCrowdReportPanel();

    const crowdLevel = Number(appState.crowdReportLevel || "1");
    const result = await submitCrowdReport(appState.selectedPark.id, appState.currentUser.uid, crowdLevel);

    if (result.isDuplicate) {
      appState.crowdReportError = result.message;
      appState.crowdReportSubmitting = false;
      renderCrowdReportPanel();
      return;
    }

    appState.crowdReportSuccess = result.message;
    const refreshedPark = await loadCrowdReportStateForPark(appState.selectedPark.id);
    appState.selectedPark = await persistCrowdReportParkState(refreshedPark);
    syncParkResultsWithSelectedPark(appState.selectedPark);
    appState.crowdReportSubmitting = false;
    renderParkDetail();
    renderCrowdReportPanel();
    renderParkResults();
  } catch (error) {
    appState.crowdReportSubmitting = false;
    appState.crowdReportError = formatAppError(error, "Failed to submit crowd report.");
    renderCrowdReportPanel();
  }
}

function clearCrowdReportSelection() {
  clearCrowdReportState();
  renderCrowdReportPanel();
}

function setAdminActionMessage(message, isError = false) {
  appState.admin.actionMessage = message;
  appState.admin.actionError = isError;

  const actionContainer = document.getElementById("admin-action-message");
  if (!actionContainer) {
    return;
  }

  if (!message) {
    actionContainer.style.display = "none";
    actionContainer.textContent = "";
    actionContainer.className = "";
    return;
  }

  actionContainer.style.display = "block";
  actionContainer.textContent = message;
  actionContainer.className = isError ? "error-message show" : "park-form-success";
}

// Write feedback directly to a section-level element, keeping it contextual.
function setAdminSectionMessage(message, isError = false, targetId) {
  const container = document.getElementById(targetId);
  if (!container) {
    return;
  }

  if (!message) {
    container.textContent = "";
    container.className = "";
    return;
  }

  container.textContent = message;
  container.className = isError ? "error-message show" : "park-form-success";
}

function setAdminInviteResult(result = null) {
  const resultContainer = document.getElementById("admin-invite-result");
  if (!resultContainer) {
    return;
  }

  if (!result || !result.passwordSetupLink) {
    resultContainer.style.display = "none";
    resultContainer.innerHTML = "";
    return;
  }

  resultContainer.style.display = "block";
  resultContainer.innerHTML = `
    <p><strong>${escapeHtml(result.role)}</strong> invite prepared for <strong>${escapeHtml(result.email)}</strong>.</p>
    <p>Expires: ${escapeHtml(formatDisplayDateTime(result.expiresAt))}</p>
    <label class="admin-link-label" for="admin-invite-link-output">Password setup link</label>
    <textarea id="admin-invite-link-output" class="admin-link-box" readonly>${escapeHtml(result.passwordSetupLink)}</textarea>
  `;
}

function renderAdminRoleVisibility() {
  const roleValue = document.getElementById("admin-role-value");
  if (roleValue) {
    roleValue.textContent = appState.userRole || "Unknown";
  }

  const accessMessage = document.getElementById("admin-access-message");
  const invitePanel = document.getElementById("admin-invite-panel");
  const assignmentPanel = document.getElementById("admin-assignment-panel");
  const moderationPanel = document.getElementById("admin-moderation-panel");
  const userModerationSection = document.getElementById("admin-user-moderation-section");
  const auditPanel = document.getElementById("admin-audit-panel");

  if (!canAccessAdminView()) {
    if (accessMessage) {
      accessMessage.style.display = "block";
      accessMessage.textContent = "You do not have permission to access administration tools.";
      accessMessage.className = "error-message show";
    }

    if (invitePanel) invitePanel.style.display = "none";
    if (assignmentPanel) assignmentPanel.style.display = "none";
    if (moderationPanel) moderationPanel.style.display = "none";
    if (auditPanel) auditPanel.style.display = "none";
    return;
  }

  if (accessMessage) {
    accessMessage.style.display = "none";
    accessMessage.textContent = "";
  }

  if (getCurrentUserRole() === USER_ROLES.SITE_ADMIN) {
    if (invitePanel) invitePanel.style.display = "block";
    if (assignmentPanel) assignmentPanel.style.display = "block";
    if (moderationPanel) moderationPanel.style.display = "block";
    if (userModerationSection) userModerationSection.style.display = "block";
    if (auditPanel) auditPanel.style.display = "block";
    const lookupPanel = document.getElementById("admin-lookup-panel");
    if (lookupPanel) lookupPanel.style.display = "block";
    return;
  }

  if (invitePanel) invitePanel.style.display = "none";
  if (assignmentPanel) assignmentPanel.style.display = "none";
  if (moderationPanel) moderationPanel.style.display = "block";
  if (userModerationSection) userModerationSection.style.display = "none";
  if (auditPanel) auditPanel.style.display = "none";
  const lookupPanel = document.getElementById("admin-lookup-panel");
  if (lookupPanel) lookupPanel.style.display = "none";
}

function renderAuditLogResults() {
  const resultsContainer = document.getElementById("admin-audit-results");
  if (!resultsContainer) {
    return;
  }

  if (appState.admin.isLoadingAudit) {
    resultsContainer.innerHTML = "<p>Loading audit log...</p>";
    return;
  }

  if (appState.admin.auditError) {
    resultsContainer.innerHTML = `<p class="error-message show">${escapeHtml(appState.admin.auditError)}</p>`;
    return;
  }

  if (!Array.isArray(appState.admin.auditEntries) || appState.admin.auditEntries.length === 0) {
    resultsContainer.innerHTML = "<p>No audit log entries found for the current filter.</p>";
    return;
  }

  resultsContainer.innerHTML = appState.admin.auditEntries.map((entry) => {
    const eventType = escapeHtml(entry.eventType || "unknown");
    const actorId = escapeHtml(entry.actorId || "unknown");
    const targetId = escapeHtml(entry.targetId || "unknown");
    const parkId = escapeHtml(entry.parkId || "-");
    const timestamp = escapeHtml(formatDisplayDateTime(entry.timestamp));

    return `
      <article class="card audit-log-item">
        <p><strong>${eventType}</strong></p>
        <p>Actor: ${actorId}</p>
        <p>Target: ${targetId}</p>
        <p>Park: ${parkId}</p>
        <p>Time: ${timestamp}</p>
      </article>
    `;
  }).join("");
}

async function handleAssignParkAdminFromForm(event) {
  event.preventDefault();

  try {
    const parkId = (document.getElementById("admin-assignment-park-id")?.value || "").trim();
    const targetUserId = (document.getElementById("admin-assignment-user-id")?.value || "").trim();

    appState.admin.isSubmitting = true;
    setAdminSectionMessage(null, false, "admin-assignment-message");

    await assignParkAdmin(parkId, targetUserId, appState.currentUser?.uid);
    setAdminSectionMessage("Park Admin assignment saved.", false, "admin-assignment-message");
  } catch (error) {
    setAdminSectionMessage(formatAppError(error, "Failed to assign Park Admin."), true, "admin-assignment-message");
  } finally {
    appState.admin.isSubmitting = false;
  }
}

function parseInviteParkIds(value = "") {
  return Array.from(new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
}

async function handleInviteAdminFromForm(event) {
  event.preventDefault();

  try {
    const email = (document.getElementById("admin-invite-email")?.value || "").trim();
    const displayName = (document.getElementById("admin-invite-display-name")?.value || "").trim();
    const role = document.getElementById("admin-invite-role")?.value || USER_ROLES.PARK_ADMIN;
    const assignedParks = parseInviteParkIds(document.getElementById("admin-invite-park-ids")?.value || "");

    appState.admin.isSubmitting = true;
    setAdminSectionMessage(null, false, "admin-invite-message");
    setAdminInviteResult(null);

    const result = await inviteAdminAccount({
      email,
      displayName,
      role,
      assignedParks
    });

    setAdminSectionMessage("Secure invite generated. Share the password setup link with the invitee.", false, "admin-invite-message");
    setAdminInviteResult(result);
  } catch (error) {
    setAdminSectionMessage(formatAppError(error, "Failed to create invite."), true, "admin-invite-message");
    setAdminInviteResult(null);
  } finally {
    appState.admin.isSubmitting = false;
  }
}

async function handleRemoveParkAdminFromForm(event) {
  event.preventDefault();

  try {
    const parkId = (document.getElementById("admin-assignment-park-id")?.value || "").trim();
    const targetUserId = (document.getElementById("admin-assignment-user-id")?.value || "").trim();

    appState.admin.isSubmitting = true;
    setAdminSectionMessage(null, false, "admin-assignment-message");

    await removeParkAdmin(parkId, targetUserId, appState.currentUser?.uid);
    setAdminSectionMessage("Park Admin assignment removed.", false, "admin-assignment-message");
  } catch (error) {
    setAdminSectionMessage(formatAppError(error, "Failed to remove Park Admin assignment."), true, "admin-assignment-message");
  } finally {
    appState.admin.isSubmitting = false;
  }
}

async function handleModerateReviewFromForm(event) {
  event.preventDefault();

  try {
    const reviewId = (document.getElementById("admin-review-id")?.value || "").trim();
    const action = document.getElementById("admin-review-action")?.value || "hide";

    appState.admin.isSubmitting = true;
    setAdminSectionMessage(null, false, "admin-moderation-message");

    await moderateReview(reviewId, action, appState.currentUser?.uid);
    setAdminSectionMessage("Review moderation action saved.", false, "admin-moderation-message");
    await loadCommunityFeaturesForSelectedPark();
    renderAdminPanels();
  } catch (error) {
    setAdminSectionMessage(formatAppError(error, "Failed to moderate review."), true, "admin-moderation-message");
  } finally {
    appState.admin.isSubmitting = false;
  }
}

async function handleModerateUserFromForm(event) {
  event.preventDefault();

  try {
    const targetUserId = (document.getElementById("admin-target-user-id")?.value || "").trim();
    const action = document.getElementById("admin-user-action")?.value || "disable";

    appState.admin.isSubmitting = true;
    setAdminSectionMessage(null, false, "admin-moderation-message");

    await moderateUser(targetUserId, action, appState.currentUser?.uid);
    setAdminSectionMessage("User moderation action saved.", false, "admin-moderation-message");
  } catch (error) {
    setAdminSectionMessage(formatAppError(error, "Failed to moderate user."), true, "admin-moderation-message");
  } finally {
    appState.admin.isSubmitting = false;
  }
}

async function handleLoadAuditLogFromForm(event) {
  event.preventDefault();

  try {
    const parkId = (document.getElementById("admin-audit-park-id")?.value || "").trim();
    const actorId = (document.getElementById("admin-audit-actor-id")?.value || "").trim();
    const eventType = (document.getElementById("admin-audit-event-type")?.value || "").trim();

    appState.admin.isLoadingAudit = true;
    appState.admin.auditError = null;
    renderAuditLogResults();

    const filters = {
      requestedByUserId: appState.currentUser?.uid,
      limit: 50
    };

    if (parkId) filters.parkId = parkId;
    if (actorId) filters.actorId = actorId;
    if (eventType) filters.eventType = eventType;

    appState.admin.auditEntries = await getAuditLog(filters);
    // Must clear the loading flag BEFORE rendering. renderAuditLogResults()
    // checks isLoadingAudit first and short-circuits to the spinner, so
    // rendering while it is still true leaves "Loading audit log..." on screen
    // permanently and the empty/results states are never reached.
    appState.admin.isLoadingAudit = false;
    renderAuditLogResults();
  } catch (error) {
    appState.admin.isLoadingAudit = false;
    appState.admin.auditEntries = [];
    appState.admin.auditError = formatAppError(error, "Failed to load audit log.");
    renderAuditLogResults();
  } finally {
    appState.admin.isLoadingAudit = false;
  }
}

async function handleAdminLookupFromForm(event) {
  event.preventDefault();

  const collectionName = (document.getElementById("admin-lookup-type")?.value || "parks").trim();
  const searchTerm = (document.getElementById("admin-lookup-search")?.value || "").toLowerCase().trim();
  const resultContainer = document.getElementById("admin-lookup-result");

  if (!resultContainer) {
    return;
  }

  resultContainer.innerHTML = `<p>Loading ${escapeHtml(collectionName)}...</p>`;

  try {
    // Firestore rules for the users collection require the role custom claim in the
    // auth token. Force-refresh the token if the claim is missing before querying.
    if (collectionName === "users" && appState.currentUser) {
      const tokenResult = await appState.currentUser.getIdTokenResult();
      if (!tokenResult?.claims?.role) {
        await appState.currentUser.getIdToken(true);
      }
    }

    let records = await readRecords(collectionName, {});

    // Client-side filter by human-readable fields.
    if (searchTerm) {
      records = records.filter((record) => {
        if (collectionName === "parks") {
          return (record.name || "").toLowerCase().includes(searchTerm) ||
                 (record.location || "").toLowerCase().includes(searchTerm);
        }

        if (collectionName === "users") {
          return (record.displayName || "").toLowerCase().includes(searchTerm) ||
                 (record.email || "").toLowerCase().includes(searchTerm) ||
                 (record.role || "").toLowerCase().includes(searchTerm);
        }

        if (collectionName === "reviews") {
          return (record.body || "").toLowerCase().includes(searchTerm) ||
                 (record.parkId || "").toLowerCase().includes(searchTerm) ||
                 String(record.rating || "").includes(searchTerm);
        }

        return true;
      });
    }

    if (records.length === 0) {
      resultContainer.innerHTML = `<p>No ${escapeHtml(collectionName)} records found${searchTerm ? ` matching "${escapeHtml(searchTerm)}"` : ""}.</p>`;
      return;
    }

    let tableHTML = "";

    if (collectionName === "parks") {
      tableHTML = `
        <table class="admin-lookup-table">
          <thead>
            <tr>
              <th>Park Name</th>
              <th>Location</th>
              <th>Status</th>
              <th>Park ID</th>
            </tr>
          </thead>
          <tbody>
            ${records.map((r) => `
              <tr>
                <td><strong>${escapeHtml(r.name || "—")}</strong></td>
                <td>${escapeHtml(r.location || "—")}</td>
                <td>${escapeHtml(r.maintenanceStatus || "unknown")}</td>
                <td><span class="admin-lookup-id" title="Click to select">${escapeHtml(r.id)}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    } else if (collectionName === "users") {
      tableHTML = `
        <table class="admin-lookup-table">
          <thead>
            <tr>
              <th>Display Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>User ID</th>
            </tr>
          </thead>
          <tbody>
            ${records.map((r) => `
              <tr>
                <td><strong>${escapeHtml(r.displayName || "—")}</strong></td>
                <td>${escapeHtml(r.email || "—")}</td>
                <td>${escapeHtml(r.role || "—")}</td>
                <td><span class="admin-lookup-id" title="Click to select">${escapeHtml(r.id)}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    } else if (collectionName === "reviews") {
      tableHTML = `
        <table class="admin-lookup-table">
          <thead>
            <tr>
              <th>Rating</th>
              <th>Comment</th>
              <th>Park ID</th>
              <th>Reviewer ID</th>
              <th>Review ID</th>
            </tr>
          </thead>
          <tbody>
            ${records.map((r) => `
              <tr>
                <td>${escapeHtml(String(r.rating || "—"))}★</td>
                <td>${escapeHtml((r.body || "").slice(0, 60))}${(r.body || "").length > 60 ? "…" : ""}</td>
                <td><span class="admin-lookup-id" title="Click to select">${escapeHtml(r.parkId || "—")}</span></td>
                <td><span class="admin-lookup-id" title="Click to select">${escapeHtml(r.userId || "—")}</span></td>
                <td><span class="admin-lookup-id" title="Click to select">${escapeHtml(r.id)}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    resultContainer.innerHTML = `
      <p style="font-size: 0.88rem; color: #555; margin-bottom: 0.5rem;">
        ${records.length} record(s) found. IDs are highlighted in blue — click to select for copying.
      </p>
      ${tableHTML}
    `;
  } catch (error) {
    resultContainer.innerHTML = `<p class="crowd-report-error">${escapeHtml(formatAppError(error, "Browse failed."))}</p>`;
  }
}

function initializeAdminHandlers() {
  const inviteForm = document.getElementById("admin-invite-form");
  const assignForm = document.getElementById("admin-assignment-form");
  const removeButton = document.getElementById("admin-remove-assignment-btn");
  const reviewForm = document.getElementById("admin-review-moderation-form");
  const userForm = document.getElementById("admin-user-moderation-form");
  const auditForm = document.getElementById("admin-audit-filter-form");
  const lookupForm = document.getElementById("admin-lookup-form");

  if (inviteForm) {
    inviteForm.addEventListener("submit", handleInviteAdminFromForm);
  }

  if (assignForm) {
    assignForm.addEventListener("submit", handleAssignParkAdminFromForm);
  }

  if (removeButton) {
    removeButton.addEventListener("click", async (event) => {
      await handleRemoveParkAdminFromForm(event);
    });
  }

  if (reviewForm) {
    reviewForm.addEventListener("submit", handleModerateReviewFromForm);
  }

  if (userForm) {
    userForm.addEventListener("submit", handleModerateUserFromForm);
  }

  if (auditForm) {
    auditForm.addEventListener("submit", handleLoadAuditLogFromForm);
  }

  if (lookupForm) {
    lookupForm.addEventListener("submit", handleAdminLookupFromForm);
  }
}
function renderSprint3Panels() {
  renderNotificationPanel();
  renderSafetyReportPanel();
  renderEquipmentPanel();
  renderCrowdHistoryPanel();
  renderMapPanel();

  if (appState.currentView === "admin") {
    renderAdminPanels();
  }
}

function toggleNotificationPanel() {
  appState.notificationsPanelOpen = !appState.notificationsPanelOpen;
  renderNotificationPanel();
}

async function markNotificationReadHandler(notificationId) {
  if (!notificationId || !appState.currentUser?.uid) {
    return;
  }

  try {
    await markNotificationRead(notificationId);
    appState.notifications = appState.notifications.map((notification) => {
      if (notification.id !== notificationId) {
        return notification;
      }

      return {
        ...notification,
        isRead: true
      };
    });

    normalizeNotificationList(appState.notifications);
    renderNotificationPanel();
  } catch (error) {
    appState.notificationsError = formatAppError(error, "Unable to mark notification as read.");
    renderNotificationPanel();
  }
}

function updateSafetyReportDescription(value) {
  appState.safetyReportDescription = String(value || "");
}

function updateSafetyReportType(value) {
  appState.safetyReportType = String(value || "hazard");
}

async function updateSafetyReportFilter(value) {
  appState.safetyReportStatusFilter = String(value || "");
  await loadSafetyReportsForSelectedPark();
  renderSafetyReportPanel();
}

async function submitSafetyReportHandler() {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to submit a safety report.");
    }

    if (!appState.selectedPark?.id) {
      throw new Error("Select a park before submitting a safety report.");
    }

    const description = appState.safetyReportDescription.trim();
    if (!description) {
      throw new Error("Safety report description is required.");
    }

    appState.safetyReportSubmitting = true;
    appState.safetyReportError = null;
    appState.safetyReportSuccess = null;
    renderSafetyReportPanel();

    await createSafetyReport(appState.selectedPark.id, appState.currentUser.uid, {
      type: appState.safetyReportType,
      description
    });

    appState.safetyReportDescription = "";
    appState.safetyReportType = "hazard";
    appState.safetyReportSubmitting = false;
    appState.safetyReportSuccess = "Safety report submitted.";

    await loadSafetyReportsForSelectedPark();
    renderSafetyReportPanel();
  } catch (error) {
    appState.safetyReportSubmitting = false;
    appState.safetyReportError = formatAppError(error, "Failed to submit safety report.");
    renderSafetyReportPanel();
  }
}

async function transitionSafetyReport(reportId, targetStatus) {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to update safety reports.");
    }

    if (!appState.selectedPark?.id && !appState.adminSelectedParkId) {
      throw new Error("Select a park before changing report status.");
    }

    await updateSafetyReportStatus(
      reportId,
      targetStatus,
      appState.currentUser.uid,
      getCurrentUserRole()
    );

    await loadSafetyReportsForSelectedPark();
    renderSafetyReportPanel();
    renderAdminPanels();
  } catch (error) {
    appState.safetyReportError = formatAppError(error, "Unable to update safety report status.");
    renderSafetyReportPanel();
    renderAdminPanels();
  }
}

async function deleteSafetyReportHandler(reportId) {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to delete safety reports.");
    }

    if (!window.confirm("Delete this safety report? This action cannot be undone.")) {
      return;
    }

    await deleteSafetyReport(reportId, appState.currentUser.uid, getCurrentUserRole());
    appState.safetyReportSuccess = "Safety report deleted.";
    appState.safetyReportError = null;
    await loadSafetyReportsForSelectedPark();
    renderSafetyReportPanel();
    renderAdminPanels();
  } catch (error) {
    appState.safetyReportError = formatAppError(error, "Unable to delete safety report.");
    renderSafetyReportPanel();
    renderAdminPanels();
  }
}

function updateEquipmentName(value) {
  appState.equipmentNameInput = String(value || "");
}

function updateEquipmentType(value) {
  appState.equipmentTypeInput = String(value || "playground");
}

async function submitEquipmentHandler() {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to create an equipment record.");
    }

    if (!appState.selectedPark?.id) {
      throw new Error("Select a park before adding equipment.");
    }

    if (!appState.equipmentNameInput.trim()) {
      throw new Error("Equipment name is required.");
    }

    appState.equipmentSubmitting = true;
    appState.equipmentError = null;
    appState.equipmentSuccess = null;
    renderEquipmentPanel();

    await createEquipment(appState.selectedPark.id, {
      name: appState.equipmentNameInput.trim(),
      type: appState.equipmentTypeInput,
      status: EQUIPMENT_STATUSES.OPERATIONAL
    });

    appState.equipmentNameInput = "";
    appState.equipmentTypeInput = "playground";
    appState.equipmentSubmitting = false;
    appState.equipmentSuccess = "Equipment record added.";

    await loadEquipmentForSelectedPark();
    renderEquipmentPanel();
  } catch (error) {
    appState.equipmentSubmitting = false;
    appState.equipmentError = formatAppError(error, "Unable to add equipment.");
    renderEquipmentPanel();
  }
}

async function transitionEquipmentStatus(equipmentId, status) {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to update equipment status.");
    }

    if (!appState.selectedPark?.id && !appState.adminSelectedParkId) {
      throw new Error("Select a park before changing equipment status.");
    }

    await updateEquipmentStatus(
      equipmentId,
      status,
      appState.currentUser.uid,
      getCurrentUserRole()
    );

    await loadEquipmentForSelectedPark();
    renderEquipmentPanel();
    renderAdminPanels();
  } catch (error) {
    appState.equipmentError = formatAppError(error, "Unable to update equipment status.");
    renderEquipmentPanel();
    renderAdminPanels();
  }
}

async function deleteEquipmentHandler(equipmentId) {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to delete equipment.");
    }

    if (!window.confirm("Delete this equipment record? This action cannot be undone.")) {
      return;
    }

    await deleteEquipment(equipmentId, appState.currentUser.uid, getCurrentUserRole());
    appState.equipmentSuccess = "Equipment record deleted.";
    appState.equipmentError = null;
    await loadEquipmentForSelectedPark();
    renderEquipmentPanel();
    renderAdminPanels();
  } catch (error) {
    appState.equipmentError = formatAppError(error, "Unable to delete equipment.");
    renderEquipmentPanel();
    renderAdminPanels();
  }
}

function toggleMapView() {
  appState.mapMode = !appState.mapMode;
  renderMapPanel();
}

async function refreshCrowdHistory() {
  if (!appState.selectedPark?.id || appState.crowdHistoryStaleRefreshPending) {
    return;
  }

  appState.crowdHistoryStaleRefreshPending = true;
  appState.crowdHistoryError = null;
  renderCrowdHistoryPanel();

  try {
    await loadCrowdHistoryForSelectedPark();
  } finally {
    appState.crowdHistoryStaleRefreshPending = false;
    renderCrowdHistoryPanel();
  }
}

async function selectAdminPark(parkId) {
  appState.adminSelectedParkId = parkId;
  appState.selectedPark = parkId ? await loadCrowdReportStateForPark(parkId) : null;
  await loadSprint3DetailData();
  await loadCommunityFeaturesForSelectedPark();
  renderAdminPanels();
}
/**
 * Resolve the signed-in user's role.
 *
 * The authoritative source is the `role` custom claim on the Auth token, which
 * only Cloud Functions can set and which Firestore security rules enforce against.
 * The users/{uid} document is read only as a display fallback.
 *
 * Accounts created before custom claims existed have no claim yet; for those we
 * call syncOwnRoleClaim() once, then force a token refresh so the new claim is
 * available to security rules on the very next request.
 *
 * NOTE: reads users/{uid} by document ID, not by collection query. Security rules
 * permit a user to read their own document but deny collection-wide queries, so a
 * where("uid","==",...) lookup here would be rejected for non-admins.
 */
async function loadUserRole(uid) {
  try {
    const firebaseUser = appState.currentUser;
    let tokenResult = firebaseUser ? await firebaseUser.getIdTokenResult() : null;

    // The profile document is still needed for assignedParks, which is not carried
    // in the token. Reading it is permitted by the rules (own document, by ID).
    let userRecord = null;
    try {
      userRecord = await getRecordById("users", uid);
    } catch (recordError) {
      console.warn("Unable to load user profile record:", recordError);
    }

    // Sync when the claim is missing OR when it disagrees with the profile role.
    // The stale case matters most: the onCreate trigger stamps every new account
    // 'Parent', so an admin provisioned by seeding or a direct Firestore edit
    // keeps a Parent claim forever. The UI would read the profile and render
    // admin controls while security rules read the claim and deny every write,
    // surfacing as "You do not have permission to complete this request."
    const claimRole = tokenResult?.claims?.role || null;
    const profileRole = userRecord?.role || null;

    if (firebaseUser && profileRole && claimRole !== profileRole) {
      try {
        await syncOwnRoleClaim();
        // Force-refresh so the reconciled claim is in the token immediately
        // rather than after the default ~1 hour expiry.
        tokenResult = await firebaseUser.getIdTokenResult(true);
      } catch (syncError) {
        console.warn("Role claim sync unavailable; falling back to profile role:", syncError);
      }
    }

    appState.userRole = tokenResult?.claims?.role || userRecord?.role || null;
    appState.assignedParks = Array.isArray(userRecord?.assignedParks)
      ? userRecord.assignedParks
      : [];
  } catch (error) {
    console.error("Failed to load user role:", error);
    appState.userRole = null;
    appState.assignedParks = [];
  }
}

function redirectIfNotAuthenticated(currentView, user = appState.currentUser) {
  if (isProtectedView(currentView) && !user) {
    window.location.replace("./login.html");
  }
}

function redirectIfAuthenticatedOnLoginView(currentView, user = appState.currentUser) {
  if (currentView === "login" && user) {
    window.location.replace("./dashboard.html");
    return true;
  }

  return false;
}

function applyRouteAccessRules(firebaseUser) {
  if (isProtectedView(appState.currentView) && !firebaseUser) {
    redirectIfNotAuthenticated(appState.currentView, firebaseUser);
    return true;
  }

  if (appState.currentView === "admin" && firebaseUser && !canAccessAdminView()) {
    window.location.replace("./dashboard.html");
    return true;
  }

  if (redirectIfAuthenticatedOnLoginView(appState.currentView, firebaseUser)) {
    return true;
  }

  return false;
}

// ============================================================
// Auth State Handler
// ============================================================

async function handleAuthStateChanged(firebaseUser) {
  appState.authReady = false;
  appState.currentUser = firebaseUser;
  appState.authStatusMessage = firebaseUser ? null : "Signed out";

  // Persist the resolved state immediately, before the awaits below. The inline
  // script in each page's <head> reads this synchronously on the next navigation
  // to paint the correct auth button on the very first frame.
  persistAuthHint(firebaseUser, appState.userRole);

  // Phase 2: Load user role from Firestore when user logs in
  if (firebaseUser) {
    await loadUserRole(firebaseUser.uid);
    await startNotificationsSubscription();
  } else {
    stopNotificationsSubscription();
    normalizeNotificationList([]);
    appState.userRole = null;
    appState.assignedParks = [];
  }

  appState.authReady = true;

  // Re-persist now that the role is known, so the Admin link can also be painted
  // correctly on first frame rather than appearing a moment later.
  persistAuthHint(firebaseUser, appState.userRole);

  // Route decisions must happen only after auth state is resolved.
  if (applyRouteAccessRules(firebaseUser)) {
    return;
  }

  revealProtectedViewAfterAuthReady();
  updateAuthNavButton();
  // Must run on EVERY view. The Admin link exists in the nav of several pages,
  // so gating it only inside the dashboard branch below left it visible to
  // Parents on Profile and About.
  updateAdminNavVisibility();

  if (appState.currentView === "dashboard") {
    renderParkForm();
    updateDashboardManagementControls();
    renderCrowdReportPanel();
    renderSprint3Panels();

    // Show one-time welcome popup after fresh login/register.
    if (firebaseUser && sessionStorage.getItem("showWelcome") === "1") {
      sessionStorage.removeItem("showWelcome");
      showWelcomePopup(firebaseUser);
    }
  }

  if (appState.currentView === "admin") {
    await loadAdminParkOptions();
    if (appState.adminSelectedParkId) {
      appState.selectedPark = await loadCrowdReportStateForPark(appState.adminSelectedParkId);
      await loadSprint3DetailData();
    }
    renderAdminPanels();
    renderNotificationPanel();
  }

  if (appState.currentView === "admin") {
    renderAdminRoleVisibility();
    renderAuditLogResults();
  }

  if (appState.currentView === "profile") {
    renderProfileFavorites();
  }
}

// ============================================================
// Phase 3: Park Search and Filter Functions
// ============================================================

/**
 * Update search term and re-run search/filter
 */
async function updateSearchTerm(term) {
  appState.searchTerm = term;
  await executeSearchAndFilter();
}

/**
 * Update filter criteria and re-run search/filter
 */
async function updateFilterCriteria(criteria) {
  appState.filterCriteria = { ...appState.filterCriteria, ...criteria };
  await executeSearchAndFilter();
}

/**
 * Clear all filters and search
 */
async function clearSearchAndFilters() {
  appState.searchTerm = "";
  appState.filterCriteria = {
    ageGroups: [],
    fencedArea: null,
    restrooms: null,
    shadeAvailable: null,
    maintenanceStatus: null
  };
  appState.parkQuery = {
    pageSize: PARK_SEARCH_DEFAULTS.pageSize,
    hasMore: false,
    lastDocument: null
  };
  appState.parkResults = [];
  appState.parksError = null;
  
  // Reset form inputs
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";
  
  ["toddler", "kid", "teen"].forEach((group) => {
    const checkbox = document.getElementById(`filter-age-${group}`);
    if (checkbox) checkbox.checked = false;
  });
  
  ["filter-fenced", "filter-restrooms", "filter-shade"].forEach((id) => {
    const checkbox = document.getElementById(id);
    if (checkbox) checkbox.checked = false;
  });
  
  const maintenanceSelect = document.getElementById("filter-maintenance");
  if (maintenanceSelect) maintenanceSelect.value = "";

  await executeSearchAndFilter();
}

/**
 * Execute combined search and filter query
 */
async function executeSearchAndFilter() {
  try {
    appState.isLoadingParks = true;
    appState.parksError = null;
    appState.parkQuery.lastDocument = null;
    appState.parkQuery.hasMore = false;
    renderParkResults();

    const hasSearchTerm = appState.searchTerm && appState.searchTerm.trim().length > 0;
    const hasFilters = Object.values(appState.filterCriteria).some(
      (value) => value !== null && (Array.isArray(value) ? value.length > 0 : true)
    );

    const response = await searchAndFilterParks(appState.searchTerm, appState.filterCriteria, {
      pageSize: appState.parkQuery.pageSize
    });

    appState.parkResults = response.results;
    appState.parkQuery.lastDocument = response.lastDocument;
    appState.parkQuery.hasMore = response.hasMore;
    appState.isLoadingParks = false;
    renderParkResults();
    renderMapPanel();
  } catch (error) {
    console.error("Search and filter error:", error);
    appState.isLoadingParks = false;
    appState.parksError = error.message;
    renderParkResults();
    renderMapPanel();
  }
}

/**
 * Select a park for detail view
 */
async function selectParkForDetail(parkId) {
  try {
    appState.selectedPark = await loadCrowdReportStateForPark(parkId);
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    appState.crowdReportError = null;
    appState.crowdReportSuccess = null;
    clearCommunityFeedback();
    appState.adminPanelError = null;
    await loadSprint3DetailData();
    await loadCommunityFeaturesForSelectedPark();
    setDashboardParkModalOpen(true);
    syncParkResultsWithSelectedPark(appState.selectedPark);
    renderParkResults();
    renderParkDetail();
    renderCrowdReportPanel();
    renderSafetyReportPanel();
    renderEquipmentPanel();
    renderCrowdHistoryPanel();
  } catch (error) {
    console.error("Failed to load park detail:", error);
    appState.parksError = formatAppError(error, "Failed to load park detail.");
    renderParkResults();
  }
}

/**
 * Clear selected park (back to list)
 */
function clearParkDetail() {
  closeParkActionModal();
  setDashboardParkModalOpen(false);
  appState.selectedPark = null;
  appState.reviews = [];
  appState.favoriteParks = [];
  appState.safetyReports = [];
  appState.equipmentItems = [];
  appState.crowdHistory = [];
  clearCrowdReportState();
  clearCommunityFeedback();
  renderParkDetail();
  renderCrowdReportPanel();
  renderSafetyReportPanel();
  renderEquipmentPanel();
  renderCrowdHistoryPanel();
}

/**
 * Shows the Admin nav link only to Park Admins and Site Admins.
 *
 * Lives on its own (rather than inside updateDashboardManagementControls) because
 * the link appears in the nav on multiple pages, so visibility has to be resolved
 * on every view once auth state is known. Defaults to hidden in the markup so the
 * link never flashes for Parents before this runs.
 */
function updateAdminNavVisibility() {
  const adminNavLink = document.getElementById("nav-admin-link");

  if (!adminNavLink) {
    return;
  }

  // Drop the first-paint hint so the CSS fallback stops applying and the verified
  // role below becomes the single source of truth.
  adminNavLink.removeAttribute("data-auth-pending");

  // Role-only check: the Admin link is about reaching the console at all, not
  // about any one park. Park scoping is applied to the actions inside it.
  adminNavLink.style.display = canAccessAdminView() ? "inline-flex" : "none";
}

function updateDashboardManagementControls() {
  const createButton = document.getElementById("create-park-btn");
  const mapToggleButton = document.getElementById("toggle-map-view-btn");

  if (!createButton && !mapToggleButton) {
    return;
  }

  if (createButton && canCreateParkRecord()) {
    createButton.style.display = "inline-flex";
    createButton.disabled = false;
  } else if (createButton) {
    createButton.style.display = "none";
    createButton.disabled = true;
  }

  if (mapToggleButton) {
    mapToggleButton.style.display = appState.currentView === "dashboard" ? "inline-flex" : "none";
  }
}

function clearParkFormState() {
  appState.parkFormMode = null;
  appState.parkFormRecordId = null;
  appState.parkFormError = null;
  appState.parkFormSuccess = null;
  appState.isSubmittingParkForm = false;
}

function getParkFormDataFromDom() {
  return {
    name: (document.getElementById("park-form-name")?.value || "").trim(),
    location: (document.getElementById("park-form-location")?.value || "").trim(),
    latitude: parseFloat(document.getElementById("park-form-latitude")?.value || "") || null,
    longitude: parseFloat(document.getElementById("park-form-longitude")?.value || "") || null,
    maintenanceStatus: document.getElementById("park-form-maintenance")?.value || "unknown",
    safetyNotes: (document.getElementById("park-form-safety-notes")?.value || "").trim(),
    amenitiesNotes: (document.getElementById("park-form-amenities-notes")?.value || "").trim(),
    ageGroups: {
      toddler: Boolean(document.getElementById("park-form-age-toddler")?.checked),
      kid: Boolean(document.getElementById("park-form-age-kid")?.checked),
      teen: Boolean(document.getElementById("park-form-age-teen")?.checked)
    },
    fencedArea: Boolean(document.getElementById("park-form-fenced")?.checked),
    restrooms: Boolean(document.getElementById("park-form-restrooms")?.checked),
    shadeAvailable: Boolean(document.getElementById("park-form-shade")?.checked)
  };
}

function validateParkFormData(parkData) {
  if (!parkData.name) {
    throw new Error("Park name is required.");
  }

  if (!parkData.location) {
    throw new Error("Park location is required.");
  }
}

async function refreshParkResultsAfterMutation() {
  const hasSearchTerm = appState.searchTerm && appState.searchTerm.trim().length > 0;
  const hasFilters = Object.values(appState.filterCriteria).some(
    (value) => value !== null && (Array.isArray(value) ? value.length > 0 : true)
  );

  if (hasSearchTerm || hasFilters) {
    await executeSearchAndFilter();
    return;
  }

  appState.isLoadingParks = true;
  renderParkResults();
  appState.parkResults = await readRecords("parks", {});
  appState.isLoadingParks = false;
  renderParkResults();
}

async function loadMoreParkResults() {
  if (!appState.parkQuery.hasMore || appState.isLoadingParks) {
    return;
  }

  try {
    appState.isLoadingParks = true;
    appState.parksError = null;
    renderParkResults();

    const response = await searchAndFilterParks(appState.searchTerm, appState.filterCriteria, {
      pageSize: appState.parkQuery.pageSize,
      startAfter: appState.parkQuery.lastDocument
    });

    appState.parkResults = appState.parkResults.concat(response.results);
    appState.parkQuery.lastDocument = response.lastDocument;
    appState.parkQuery.hasMore = response.hasMore;
  } catch (error) {
    console.error("Load more parks failed:", error);
    appState.parksError = error.message;
  } finally {
    appState.isLoadingParks = false;
    renderParkResults();
    renderMapPanel();
  }
}

function openCreateParkForm() {
  try {
    enforceRoleOrThrow([USER_ROLES.SITE_ADMIN]);
    appState.parkFormMode = "create";
    appState.parkFormRecordId = null;
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    renderParkForm();
  } catch (error) {
    appState.parkFormError = formatAppError(error, "Only Site Admin users can create parks.");
    renderParkForm();
  }
}

function openEditParkForm() {
  try {
    if (!appState.selectedPark?.id) {
      throw new Error("Select a park before editing.");
    }

    if (!canEditParkRecord(appState.selectedPark.id)) {
      throw new Error("You don't have permission to edit this park.");
    }

    appState.parkFormMode = "edit";
    appState.parkFormRecordId = appState.selectedPark.id;
    appState.parkFormError = null;
    appState.parkFormSuccess = null;

    if (appState.currentView === "dashboard") {
      setDashboardParkModalOpen(true);
      setParkActionModal("edit");
    }

    renderParkForm();
  } catch (error) {
    appState.parkFormError = formatAppError(error, "You are not allowed to edit this park.");
    renderParkForm();
  }
}

function cancelParkForm() {
  clearParkFormState();

  if (appState.activeParkActionModal === "edit") {
    closeParkActionModal();
  }

  renderParkForm();
}

function updateDeleteParkConfirmInput(value) {
  appState.deleteParkConfirmInput = String(value || "");
  // Update only the button to avoid destroying the focused input on every keystroke.
  const confirmBtn = document.getElementById("delete-park-confirm-btn");
  if (confirmBtn) {
    confirmBtn.disabled = appState.deleteParkConfirmInput !== "DELETE" || appState.isDeletingPark;
  }
}

function openDeleteParkModal() {
  if (!appState.selectedPark) {
    return;
  }

  if (!canDeleteParkRecord()) {
    return;
  }

  appState.deleteParkConfirmInput = "";
  appState.deleteParkError = null;
  setParkActionModal("delete");
}

function closeDeleteParkModal() {
  appState.deleteParkConfirmInput = "";
  appState.deleteParkError = null;
  closeParkActionModal();
}

async function deleteParkHandler() {
  try {
    if (!appState.currentUser?.uid) {
      throw new Error("Sign in to delete a park.");
    }

    if (!appState.selectedPark?.id) {
      throw new Error("No park selected.");
    }

    if (appState.deleteParkConfirmInput !== "DELETE") {
      throw new Error('Type DELETE to confirm.');
    }

    appState.isDeletingPark = true;
    appState.deleteParkError = null;
    renderDeleteParkModal();

    await deleteParkRecord(appState.selectedPark.id, appState.currentUser.uid, getCurrentUserRole());

    appState.isDeletingPark = false;
    appState.selectedPark = null;
    appState.deleteParkConfirmInput = "";
    closeParkActionModal();

    renderParkDetail();
    await refreshParkResultsAfterMutation();
  } catch (error) {
    appState.isDeletingPark = false;
    appState.deleteParkError = formatAppError(error, "Unable to delete park.");
    renderDeleteParkModal();
  }
}

function renderDeleteParkModal() {
  const modalContainer = appState.activeParkActionModal === "delete"
    ? document.getElementById("park-action-modal-content")
    : null;

  if (!modalContainer) {
    return;
  }

  if (!appState.selectedPark) {
    modalContainer.innerHTML = "";
    return;
  }

  const parkName = escapeHtml(appState.selectedPark.name || "this park");
  const confirmReady = appState.deleteParkConfirmInput === "DELETE";

  modalContainer.innerHTML = `
    <section class="detail-section card">
      <h3 style="margin-top: 0;">Delete Park</h3>
      <p><strong>You are about to permanently delete "${parkName}".</strong> This action cannot be undone.</p>
      <p>To confirm, type <strong>DELETE</strong> in the field below.</p>
      ${appState.deleteParkError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.deleteParkError)}</p>` : ""}
      <div class="form-group">
        <label for="delete-park-confirm-input">Confirmation</label>
        <input
          id="delete-park-confirm-input"
          type="text"
          placeholder="Type DELETE"
          value="${escapeHtml(appState.deleteParkConfirmInput)}"
          oninput="window.appControllerExports.updateDeleteParkConfirmInput(this.value)"
          autocomplete="off"
        />
      </div>
      <div class="park-form-actions">
        <button
          id="delete-park-confirm-btn"
          type="button"
          class="btn btn-primary"
          onclick="window.appControllerExports.deletePark()"
          ${!confirmReady || appState.isDeletingPark ? "disabled" : ""}
        >
          ${appState.isDeletingPark ? "Deleting..." : "Confirm Delete"}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          onclick="window.appControllerExports.closeDeleteParkModal()"
          ${appState.isDeletingPark ? "disabled" : ""}
        >
          Cancel
        </button>
      </div>
    </section>
  `;
}

async function submitParkForm() {
  try {
    if (!appState.parkFormMode) {
      throw new Error("No park form is active.");
    }

    // Creating a park is Site Admin only; editing is allowed for the Park Admins
    // assigned to that park. Both mirror firestore.rules.
    if (appState.parkFormMode === "create") {
      enforceRoleOrThrow([USER_ROLES.SITE_ADMIN]);
    } else if (!canEditParkRecord(appState.parkFormRecordId)) {
      throw new Error("You don't have permission to edit this park.");
    }

    // Capture current form input values before any state-driven re-render.
    const parkData = getParkFormDataFromDom();
    validateParkFormData(parkData);

    appState.isSubmittingParkForm = true;
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    renderParkForm();

    let savedPark = null;
    let successMessage = "";
    if (appState.parkFormMode === "create") {
      savedPark = await createParkRecord(parkData);
      successMessage = "Park created successfully.";
    } else {
      savedPark = await editParkRecord(appState.parkFormRecordId, parkData);
      successMessage = "Park updated successfully.";
    }

    appState.selectedPark = savedPark;
    appState.isSubmittingParkForm = false;
    clearParkFormState();
    appState.parkFormSuccess = successMessage;

    if (appState.activeParkActionModal === "edit") {
      closeParkActionModal();
    }

    renderParkDetail();
    renderParkForm();
    await refreshParkResultsAfterMutation();
  } catch (error) {
    appState.isSubmittingParkForm = false;
    appState.parkFormError = formatAppError(error, "Failed to save park.");
    renderParkForm();
  }
}

/**
 * Render park results list
 */
function renderParkResults() {
  const resultsContainer = document.getElementById("park-results-container");
  if (!resultsContainer) return;

  resultsContainer.innerHTML = "";

  // Loading state
  if (appState.isLoadingParks && appState.parkResults.length === 0) {
    resultsContainer.innerHTML = `
      <div class="state-loading">
        <div class="spinner"></div>
        <p>Loading parks...</p>
      </div>
    `;
    return;
  }

  // Error state
  if (appState.parksError && appState.parkResults.length === 0) {
    resultsContainer.innerHTML = `
      <div class="state-error">
        <p class="error-message show">${escapeHtml(appState.parksError)}</p>
        <button class="btn btn-secondary" onclick="window.location.reload()">Retry</button>
      </div>
    `;
    return;
  }

  // Empty state
  if (appState.parkResults.length === 0) {
    resultsContainer.innerHTML = `
      <div class="state-empty">
        <p>No parks found. Try adjusting your search or filters.</p>
      </div>
    `;
    return;
  }

  // Results state
  const resultsHTML = appState.parkResults.map((park) => `
    <div class="park-card" onclick="window.appControllerExports.selectParkForDetail('${park.id}')">
      <h3>${escapeHtml(park.name)}</h3>
      <p class="park-location">${escapeHtml(park.location)}</p>
      <div class="park-busy-level">
        ${renderBusyLevelBadge(park.busyLevel || {})}
      </div>
      <div class="park-amenities">
        ${park.ageGroups?.toddler ? '<span class="amenity-tag">Toddler</span>' : ''}
        ${park.ageGroups?.kid ? '<span class="amenity-tag">Kid</span>' : ''}
        ${park.ageGroups?.teen ? '<span class="amenity-tag">Teen</span>' : ''}
        ${park.fencedArea ? '<span class="amenity-tag">Fenced</span>' : ''}
        ${park.restrooms ? '<span class="amenity-tag">Restrooms</span>' : ''}
        ${park.shadeAvailable ? '<span class="amenity-tag">Shade</span>' : ''}
      </div>
      <p class="park-status">Status: <strong>${escapeHtml(park.maintenanceStatus || 'Unknown')}</strong></p>
    </div>
  `).join("");

  const loadMoreButton = appState.parkQuery.hasMore ? `
      <div class="search-pagination">
        <button class="btn btn-primary" onclick="window.appControllerExports.loadMoreParkResults()" ${appState.isLoadingParks ? 'disabled' : ''}>
          ${appState.isLoadingParks ? 'Loading...' : 'Load more parks'}
        </button>
      </div>
    ` : `
      <div class="search-pagination">
        <p class="end-of-results">${appState.parkResults.length > 0 ? 'End of results.' : ''}</p>
      </div>
    `;

  resultsContainer.innerHTML = `
    <div class="results-header">
      <p><strong>${appState.parkResults.length}</strong> park(s) found</p>
    </div>
    <div class="park-results-list">
      ${resultsHTML}
    </div>
    ${loadMoreButton}
  `;
}

/**
 * Render park detail view
 */
function renderParkDetail() {
  const detailContainer = getDashboardTargetContainer("park-detail-container", "park-detail-modal-container");
  if (!detailContainer) return;

  if (!appState.selectedPark) {
    detailContainer.innerHTML = "";
    return;
  }

  const park = appState.selectedPark;
  const canEdit = canEditParkRecord();
  const favoriteIsActive = appState.favoriteParks.some((favorite) => favorite.parkId === park.id);
  const reviewCount = appState.reviews.length;
  const avgRating = park.reviewAggregate?.averageRating != null ? Number(park.reviewAggregate.averageRating).toFixed(1) : "No ratings yet";
  const photoGallery = Array.isArray(park.photos) && park.photos.length > 0
    ? `<div class="photo-gallery">${park.photos.map((photo) => `<img src="${escapeHtml(photo)}" alt="Park photo" />`).join("")}</div>`
    : `<p class="muted">No photos uploaded yet.</p>`;

  detailContainer.innerHTML = `
    <div class="park-detail">
      <button class="btn btn-secondary" onclick="window.appControllerExports.clearParkDetail()">← Back to List</button>
      <h2>${escapeHtml(park.name)}</h2>
      <p class="detail-location"><strong>Location:</strong> ${escapeHtml(park.location)}</p>
      
      <section class="detail-section">
        <h3>Safety & Amenities</h3>
        <p><strong>Safety Notes:</strong> ${escapeHtml(park.safetyNotes || 'No safety notes available.')}</p>
        <p><strong>Amenities:</strong> ${escapeHtml(park.amenitiesNotes || 'No amenity details available.')}</p>
        <p><strong>Maintenance Status:</strong> ${escapeHtml(park.maintenanceStatus || 'Unknown')}</p>
      </section>

      <section class="detail-section crowd-report-summary">
        <h3>Crowd Level</h3>
        <div class="crowd-report-summary-row">
          ${renderBusyLevelBadge(park.busyLevel || {})}
          <p>${park.crowdReporting?.reportCountLastHour || 0} report(s) in the last 2.5 hrs</p>
        </div>
        <p class="crowd-report-meta">Last update: ${escapeHtml(formatDisplayDateTime(park.crowdReporting?.lastReportedAt || null))}</p>
      </section>
      
      <section class="detail-section">
        <h3>Age Groups & Features</h3>
        <ul>
          <li>Toddler: ${park.ageGroups?.toddler ? '✓ Yes' : '✗ No'}</li>
          <li>Kid: ${park.ageGroups?.kid ? '✓ Yes' : '✗ No'}</li>
          <li>Teen: ${park.ageGroups?.teen ? '✓ Yes' : '✗ No'}</li>
          <li>Fenced Area: ${park.fencedArea ? '✓ Yes' : '✗ No'}</li>
          <li>Restrooms: ${park.restrooms ? '✓ Yes' : '✗ No'}</li>
          <li>Shade Available: ${park.shadeAvailable ? '✓ Yes' : '✗ No'}</li>
        </ul>
      </section>

      <section class="detail-section card">
        <div class="detail-section-header">
          <h3>Community</h3>
          ${isAuthenticated() ? `<button class="favorites-toggle ${favoriteIsActive ? "active" : ""}" onclick="window.appControllerExports.toggleFavorite('${park.id}')" title="Save this park">♡</button>` : ""}
        </div>
        <p class="muted">Average rating: ${escapeHtml(avgRating)} • ${reviewCount} review(s)</p>
        ${photoGallery}
      </section>

      <div id="crowd-history-modal-container" class="crowd-history-container"></div>
      
      ${canEdit ? `
        <section class="detail-section">
          <h3>Actions</h3>
          <button class="btn btn-primary" onclick="window.appControllerExports.openEditParkForm()">Edit Park</button>
          ${canDeleteParkRecord() ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openDeleteParkModal()">Delete Park</button>` : ""}
          ${isAuthenticated() ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('crowd')">Submit Crowd Report</button>` : ""}
          ${isAuthenticated() ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('review')">Submit Review</button>` : ""}
          ${(canManageEquipment() || canDeleteEquipmentRecords()) ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('equipment')">Add Equipment</button>` : ""}
        </section>
      ` : ''}

      ${!canEdit ? `
        <section class="detail-section">
          <h3>Actions</h3>
          ${isAuthenticated() ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('crowd')">Submit Crowd Report</button>` : ""}
          ${isAuthenticated() ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('review')">Submit Review</button>` : ""}
          ${(canManageEquipment() || canDeleteEquipmentRecords()) ? `<button class="btn btn-secondary" onclick="window.appControllerExports.openParkActionModal('equipment')">Add Equipment</button>` : ""}
        </section>
      ` : ""}
    </div>
  `;

  renderCrowdHistoryPanel();
}

function renderReviewActionPanel() {
  const modalContainer = document.getElementById("park-action-modal-content");
  if (!modalContainer) {
    return;
  }

  if (appState.activeParkActionModal !== "review" || !appState.selectedPark) {
    modalContainer.innerHTML = "";
    return;
  }

  modalContainer.innerHTML = `
    <section class="detail-section card">
      <h3 style="margin-top: 0;">Review and Photos</h3>
      ${renderReviewSection(appState.selectedPark)}
      ${renderPhotoSection(appState.selectedPark)}
    </section>
  `;
}

function renderParkForm() {
  const formContainer = appState.activeParkActionModal === "edit"
    ? document.getElementById("park-action-modal-content")
    : getDashboardTargetContainer("park-form-container", "park-form-modal-container");
  if (!formContainer) {
    return;
  }

  const isEditing = appState.parkFormMode === "edit";
  const sourcePark = isEditing ? appState.selectedPark : null;
  // Editing is park-scoped (Park Admins on assigned parks); creating is Site Admin
  // only. Gating both on canCreateParkRecord() would hide the edit form from the
  // Park Admins who are allowed to use it.
  const canManage = isEditing
    ? canEditParkRecord(appState.parkFormRecordId)
    : canCreateParkRecord();

  if (!canManage) {
    formContainer.innerHTML = "";
    return;
  }

  if (!appState.parkFormMode) {
    formContainer.innerHTML = appState.parkFormSuccess
      ? `<p class="park-form-success">${escapeHtml(appState.parkFormSuccess)}</p>`
      : "";
    return;
  }

  formContainer.innerHTML = `
    <section class="park-form-panel">
      <h3>${isEditing ? "Edit Park" : "Create Park"}</h3>
      ${appState.parkFormError ? `<p class="park-form-error">${escapeHtml(appState.parkFormError)}</p>` : ""}
      <form id="park-form" class="park-form" onsubmit="event.preventDefault(); window.appControllerExports.submitParkForm();">
        <div class="form-group">
          <label for="park-form-name">Park Name</label>
          <input id="park-form-name" type="text" value="${escapeHtml(sourcePark?.name || "")}" required />
        </div>
        <div class="form-group">
          <label for="park-form-location">Location</label>
          <input id="park-form-location" type="text" value="${escapeHtml(sourcePark?.location || "")}" required />
          <div class="crowd-report-actions" style="margin-top: 0.5rem;">
            <button id="park-form-lookup-btn" type="button" class="btn btn-secondary" onclick="window.appControllerExports.lookupParkCoordinatesFromAddress()" ${appState.isSubmittingParkForm ? "disabled" : ""}>Look Up Address Coordinates</button>
          </div>
          <p id="park-form-lookup-message" class="crowd-report-meta" aria-live="polite"></p>
        </div>
        <div class="form-group form-group-inline">
          <div>
            <label for="park-form-latitude">Latitude (for map pin)</label>
            <input id="park-form-latitude" type="number" step="any" value="${escapeHtml(String(sourcePark?.latitude ?? sourcePark?.coordinates?.lat ?? ""))}" placeholder="e.g. 42.3314" />
          </div>
          <div>
            <label for="park-form-longitude">Longitude (for map pin)</label>
            <input id="park-form-longitude" type="number" step="any" value="${escapeHtml(String(sourcePark?.longitude ?? sourcePark?.coordinates?.lng ?? ""))}" placeholder="e.g. -83.0458" />
          </div>
        </div>
        <div class="form-group">
          <label for="park-form-maintenance">Maintenance Status</label>
          <select id="park-form-maintenance">
            <option value="good" ${(sourcePark?.maintenanceStatus || "") === "good" ? "selected" : ""}>Good</option>
            <option value="needs_attention" ${(sourcePark?.maintenanceStatus || "") === "needs_attention" ? "selected" : ""}>Needs Attention</option>
            <option value="closed" ${(sourcePark?.maintenanceStatus || "") === "closed" ? "selected" : ""}>Closed</option>
            <option value="unknown" ${(sourcePark?.maintenanceStatus || "unknown") === "unknown" ? "selected" : ""}>Unknown</option>
          </select>
        </div>
        <div class="form-group">
          <label for="park-form-safety-notes">Safety Notes</label>
          <textarea id="park-form-safety-notes" rows="3">${escapeHtml(sourcePark?.safetyNotes || "")}</textarea>
        </div>
        <div class="form-group">
          <label for="park-form-amenities-notes">Amenities Notes</label>
          <textarea id="park-form-amenities-notes" rows="3">${escapeHtml(sourcePark?.amenitiesNotes || "")}</textarea>
        </div>

        <fieldset class="park-form-features">
          <legend>Age Groups</legend>
          <label><input id="park-form-age-toddler" type="checkbox" ${sourcePark?.ageGroups?.toddler ? "checked" : ""} /> Toddler</label>
          <label><input id="park-form-age-kid" type="checkbox" ${sourcePark?.ageGroups?.kid ? "checked" : ""} /> Kid</label>
          <label><input id="park-form-age-teen" type="checkbox" ${sourcePark?.ageGroups?.teen ? "checked" : ""} /> Teen</label>
        </fieldset>

        <fieldset class="park-form-features">
          <legend>Amenities</legend>
          <label><input id="park-form-fenced" type="checkbox" ${sourcePark?.fencedArea ? "checked" : ""} /> Fenced Area</label>
          <label><input id="park-form-restrooms" type="checkbox" ${sourcePark?.restrooms ? "checked" : ""} /> Restrooms</label>
          <label><input id="park-form-shade" type="checkbox" ${sourcePark?.shadeAvailable ? "checked" : ""} /> Shade Available</label>
        </fieldset>

        <div class="park-form-actions">
          <button type="submit" class="btn btn-primary" ${appState.isSubmittingParkForm ? "disabled" : ""}>
            ${appState.isSubmittingParkForm ? "Saving..." : (isEditing ? "Save Changes" : "Create Park")}
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.appControllerExports.cancelParkForm()" ${appState.isSubmittingParkForm ? "disabled" : ""}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  `;
}

function setLookupFeedback(text, statusClass) {
  const messageElement = document.getElementById("park-form-lookup-message");
  if (messageElement) {
    messageElement.textContent = text;
    messageElement.className = statusClass;
  }
}

// Fetch JSON with a hard timeout so lookups never hang without feedback.
async function fetchJsonWithTimeout(endpoint, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Snap a geocoded coordinate to the nearest OSM park so pins land on the park itself, not an adjacent business or golf course.
async function findNearestParkCenter(latitude, longitude, radiusDegrees = 0.012) {
  const bbox = `${latitude - radiusDegrees},${longitude - radiusDegrees},${latitude + radiusDegrees},${longitude + radiusDegrees}`;
  const query = `[out:json][timeout:12];(way[leisure=park](${bbox});relation[leisure=park](${bbox});node[leisure=park](${bbox}););out center tags;`;
  const endpoint = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const payload = await fetchJsonWithTimeout(endpoint, 9000);
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];

  let nearest = null;
  let nearestDistance = Infinity;
  for (const element of elements) {
    const elementLat = Number(element.center?.lat ?? element.lat);
    const elementLon = Number(element.center?.lon ?? element.lon);
    if (!Number.isFinite(elementLat) || !Number.isFinite(elementLon)) {
      continue;
    }

    const dLat = elementLat - latitude;
    const dLon = elementLon - longitude;
    const distance = Math.sqrt(dLat * dLat + dLon * dLon);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { lat: elementLat, lon: elementLon, name: element.tags?.name || "" };
    }
  }

  return nearest;
}

async function lookupParkCoordinatesFromAddress() {
  const locationInput = document.getElementById("park-form-location");
  const latitudeInput = document.getElementById("park-form-latitude");
  const longitudeInput = document.getElementById("park-form-longitude");
  const lookupButton = document.getElementById("park-form-lookup-btn");

  if (!locationInput || !latitudeInput || !longitudeInput) {
    setLookupFeedback("Park location inputs are not available.", "crowd-report-message crowd-report-error");
    return;
  }

  const sanitizedAddress = (locationInput.value || "")
    .replace(/[*]+/g, " ")
    .replace(/[\u2018\u2019\u201C\u201D]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitizedAddress) {
    setLookupFeedback("Enter a location or address before lookup.", "crowd-report-message crowd-report-error");
    return;
  }

  // Immediate feedback + prevent duplicate concurrent lookups.
  const originalButtonText = lookupButton ? lookupButton.textContent : "";
  if (lookupButton) {
    lookupButton.disabled = true;
    lookupButton.textContent = "Searching…";
  }
  setLookupFeedback("Searching for address…", "crowd-report-meta");

  try {
    const normalizeTokens = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s,]/g, " ")
      .split(/[\s,]+/)
      .filter(Boolean);

    const inputTokens = normalizeTokens(sanitizedAddress);
    const inputHouseNumber = (sanitizedAddress.match(/^\s*(\d{1,6})\b/) || [])[1] || "";
    // Commercial POIs often share a street address with the location we actually want (e.g. a park).
    const commercialTypes = new Set(["pub", "bar", "restaurant", "cafe", "fast_food", "nightclub", "shop"]);

    const scoreCandidate = (candidate) => {
      const candidateTokens = normalizeTokens([
        candidate.display_name,
        candidate.name,
        candidate.address?.road,
        candidate.address?.city,
        candidate.address?.state,
        candidate.address?.country
      ].join(" "));

      const tokenSet = new Set(candidateTokens);
      const overlapCount = inputTokens.filter((token) => tokenSet.has(token)).length;
      let score = overlapCount * 4;

      // Exact street number is the single strongest signal of a precise match.
      if (inputHouseNumber && String(candidate.address?.house_number || "") === inputHouseNumber) {
        score += 8;
      }

      const category = String(candidate.class || "").toLowerCase();
      const type = String(candidate.type || "").toLowerCase();
      if (category === "leisure" || category === "boundary" || category === "landuse" && type !== "retail") {
        score += 4;
      } else if (category === "place" || category === "building" || category === "highway") {
        score += 2;
      }
      if (commercialTypes.has(type) || category === "shop" || type === "retail") {
        score -= 5;
      }

      const cityText = `${candidate.address?.city || ""} ${candidate.address?.town || ""} ${candidate.address?.village || ""}`.toLowerCase();
      if (cityText.includes("livonia")) {
        score += 3;
      }

      if (String(candidate.address?.state || "").toLowerCase().includes("michigan")) {
        score += 2;
      }

      return score;
    };

    // Two focused variants: exact input, and a version without the ZIP (which often blocks house-number matches).
    const withoutZip = sanitizedAddress.replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/\s+/g, " ").trim();
    const queryVariants = [sanitizedAddress, withoutZip]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const fetchPhoton = async (queryText) => {
      const params = new URLSearchParams({ q: queryText, limit: "10", lang: "en", lat: "42.3684", lon: "-83.3527" });
      const payload = await fetchJsonWithTimeout(`https://photon.komoot.io/api/?${params.toString()}`);
      const features = Array.isArray(payload?.features) ? payload.features : [];

      return features
        .map((feature) => {
          const coordinates = feature?.geometry?.coordinates;
          const longitude = Array.isArray(coordinates) ? Number(coordinates[0]) : Number.NaN;
          const latitude = Array.isArray(coordinates) ? Number(coordinates[1]) : Number.NaN;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
          }

          const properties = feature?.properties || {};
          const houseNumber = properties.housenumber ? `${properties.housenumber} ` : "";
          const locality = [properties.city, properties.state, properties.country].filter(Boolean).join(", ");

          return {
            lat: String(latitude),
            lon: String(longitude),
            display_name: [`${houseNumber}${properties.street || properties.name || ""}`.trim(), locality].filter(Boolean).join(", "),
            name: properties.name || properties.street || "",
            class: properties.osm_key || "",
            type: properties.osm_value || "",
            address: {
              house_number: properties.housenumber || "",
              road: properties.street || "",
              city: properties.city || properties.locality || "",
              state: properties.state || "",
              country: properties.country || ""
            }
          };
        })
        .filter((item) => item !== null);
    };

    const fetchNominatim = async (queryText) => {
      const params = new URLSearchParams({
        format: "jsonv2",
        addressdetails: "1",
        countrycodes: "us",
        limit: "10",
        q: queryText
      });
      const results = await fetchJsonWithTimeout(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      return (Array.isArray(results) ? results : []).map((result) => ({
        ...result,
        class: result.class || result.category || ""
      }));
    };

    // Query both providers in parallel per variant and merge so scoring can pick the most precise match.
    let candidates = [];
    for (const queryText of queryVariants) {
      const [photonResults, nominatimResults] = await Promise.all([
        fetchPhoton(queryText),
        fetchNominatim(queryText)
      ]);
      candidates = [...photonResults, ...nominatimResults];
      if (candidates.length > 0) {
        break;
      }
    }

    const topResult = candidates
      .filter((candidate) => Number.isFinite(Number(candidate?.lat)) && Number.isFinite(Number(candidate?.lon)))
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
      .sort((left, right) => right.score - left.score)[0]?.candidate || null;

    if (!topResult?.lat || !topResult?.lon) {
      throw new Error("No matching location was found. Try adding or removing the ZIP code, or simplifying the address.");
    }

    latitudeInput.value = String(topResult.lat);
    longitudeInput.value = String(topResult.lon);
    setLookupFeedback(`Coordinates loaded: ${topResult.display_name || "best match"}.`, "crowd-report-meta crowd-report-success");
  } catch (error) {
    setLookupFeedback(formatAppError(error, "Unable to look up the address."), "crowd-report-message crowd-report-error");
  } finally {
    if (lookupButton) {
      lookupButton.disabled = false;
      lookupButton.textContent = originalButtonText || "Look Up Address Coordinates";
    }
  }
}

function initializeViewController() {
  if (appState.currentView === "login" || appState.currentView === "profile" || appState.currentView === "admin") {
    initializeAuthController();
  }

  if (appState.currentView === "profile") {
    const profileModal = document.getElementById("profile-favorite-park-modal");
    if (profileModal) {
      profileModal.addEventListener("click", (event) => {
        if (!appState.profileFavoriteModalOpen) {
          return;
        }

        const targetElement = event.target instanceof Element ? event.target : null;
        const clickedInsideContent = targetElement?.closest(".profile-favorite-modal-content");
        if (!clickedInsideContent) {
          closeProfileFavoriteDetail();
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && appState.profileFavoriteModalOpen) {
        closeProfileFavoriteDetail();
      }
    });
  }

  // Phase 3: Initialize search and filter handlers for dashboard
  if (appState.currentView === "dashboard") {
    ensureDashboardModalMountedToBody();
    ensureParkActionModalMountedToBody();
    const notificationToggleButton = document.getElementById("admin-notifications-toggle-btn");
    if (notificationToggleButton) {
      notificationToggleButton.addEventListener("click", toggleNotificationPanel);
    }
    const dashboardModal = document.getElementById("dashboard-park-modal");
    if (dashboardModal) {
      dashboardModal.addEventListener("click", (event) => {
        if (!appState.dashboardParkModalOpen) {
          return;
        }

        if (appState.activeParkActionModal) {
          return;
        }

        if (!isEventInsideDashboardModalContent(event)) {
          clearParkDetail();
        }
      });
    }
    document.addEventListener("mousedown", (event) => {
      if (!appState.dashboardParkModalOpen) {
        return;
      }

      if (appState.activeParkActionModal) {
        return;
      }

      if (!isEventInsideDashboardModalContent(event)) {
        clearParkDetail();
      }
    }, true);
    initializeParkSearchAndFilter();
    applyInitialDashboardSearchFromUrl();
    renderCrowdReportPanel();
    renderSafetyReportPanel();
    renderEquipmentPanel();
    renderCrowdHistoryPanel();
    renderMapPanel();
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && appState.activeParkActionModal) {
        closeParkActionModal();
        return;
      }

      if (event.key === "Escape" && appState.dashboardParkModalOpen) {
        clearParkDetail();
      }
    });
  }

  if (appState.currentView === "admin") {
    const notificationToggleButton = document.getElementById("admin-notifications-toggle-btn");
    if (notificationToggleButton) {
      notificationToggleButton.addEventListener("click", toggleNotificationPanel);
    }

    renderAdminPanels();
    renderNotificationPanel();
  }

  if (appState.currentView === "admin") {
    initializeAdminHandlers();
  }
}

async function renderProfileFavorites() {
  const favoritesContainer = document.getElementById("profile-favorites-container");
  const favoritesCount = document.getElementById("profile-favorites-count");
  if (!favoritesContainer) {
    return;
  }

  if (!isAuthenticated()) {
    if (favoritesCount) {
      favoritesCount.textContent = "Sign in to see your favorite parks count.";
    }
    favoritesContainer.innerHTML = '<p class="muted">Sign in to see your saved parks.</p>';
    return;
  }

  try {
    appState.favoriteLoading = true;
    if (favoritesCount) {
      favoritesCount.textContent = "Loading favorites count...";
    }
    favoritesContainer.innerHTML = '<p class="muted">Loading favorites...</p>';
    const favorites = await getFavorites(appState.currentUser.uid);
    appState.favoriteParks = favorites;

    if (favoritesCount) {
      favoritesCount.textContent = `You have ${favorites.length} favorite park${favorites.length === 1 ? "" : "s"}.`;
    }

    if (!favorites.length) {
      favoritesContainer.innerHTML = '<p class="muted">No saved favorites yet.</p>';
      return;
    }

    const enrichedFavorites = await Promise.all(
      favorites.map(async (favorite) => {
        try {
          const park = await getParkById(favorite.parkId);
          return { ...favorite, parkName: park.name || favorite.parkId };
        } catch {
          return { ...favorite, parkName: favorite.parkId };
        }
      })
    );

    favoritesContainer.innerHTML = `
      <ul class="review-list">
        ${enrichedFavorites.map((favorite) => `
          <li class="review-item">
            <button type="button" class="profile-favorite-link" onclick="window.appControllerExports.openProfileFavoriteDetail(decodeURIComponent('${encodeURIComponent(favorite.parkId)}'))"><strong>${escapeHtml(favorite.parkName)}</strong></button>
            <p class="muted">Saved on ${escapeHtml(formatDisplayDateTime(favorite.createdAt))}</p>
          </li>
        `).join("")}
      </ul>
    `;
  } catch (error) {
    if (favoritesCount) {
      favoritesCount.textContent = "Unable to load favorites count.";
    }
    favoritesContainer.innerHTML = `<p class="crowd-report-error">${escapeHtml(formatAppError(error, "Unable to load favorites."))}</p>`;
  } finally {
    appState.favoriteLoading = false;
  }
}

function setProfileFavoriteModalOpen(isOpen) {
  appState.profileFavoriteModalOpen = Boolean(isOpen);
  const modal = document.getElementById("profile-favorite-park-modal");

  if (modal) {
    modal.setAttribute("aria-hidden", appState.profileFavoriteModalOpen ? "false" : "true");
  }

  document.body.classList.toggle("profile-favorite-modal-open", appState.profileFavoriteModalOpen);
}

function renderProfileFavoriteModalBody({ park = null, loading = false, errorMessage = "" } = {}) {
  const container = document.getElementById("profile-favorite-park-modal-body");
  if (!container) {
    return;
  }

  if (loading) {
    container.innerHTML = '<p class="muted">Loading park details...</p>';
    return;
  }

  if (errorMessage) {
    container.innerHTML = `<p class="crowd-report-error">${escapeHtml(errorMessage)}</p>`;
    return;
  }

  if (!park) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <section class="detail-section">
      <h3>${escapeHtml(park.name || "Park Details")}</h3>
      <p><strong>Location:</strong> ${escapeHtml(park.location || "Unknown")}</p>
      <p><strong>Maintenance Status:</strong> ${escapeHtml(park.maintenanceStatus || "Unknown")}</p>
      <p><strong>Safety Notes:</strong> ${escapeHtml(park.safetyNotes || "No safety notes available.")}</p>
      <p><strong>Amenities:</strong> ${escapeHtml(park.amenitiesNotes || "No amenity details available.")}</p>
    </section>
    <section class="detail-section">
      <h3>Age Groups & Features</h3>
      <ul>
        <li>Toddler: ${park.ageGroups?.toddler ? "Yes" : "No"}</li>
        <li>Kid: ${park.ageGroups?.kid ? "Yes" : "No"}</li>
        <li>Teen: ${park.ageGroups?.teen ? "Yes" : "No"}</li>
        <li>Fenced Area: ${park.fencedArea ? "Yes" : "No"}</li>
        <li>Restrooms: ${park.restrooms ? "Yes" : "No"}</li>
        <li>Shade Available: ${park.shadeAvailable ? "Yes" : "No"}</li>
      </ul>
    </section>
    <section class="detail-section">
      <a class="btn btn-primary" href="./dashboard.html?parkId=${encodeURIComponent(park.id || "")}">Review More Details In Dashboard</a>
    </section>
  `;
}

async function openProfileFavoriteDetail(parkId) {
  if (!parkId || appState.currentView !== "profile") {
    return;
  }

  setProfileFavoriteModalOpen(true);
  renderProfileFavoriteModalBody({ loading: true });

  try {
    const parkRecord = await getParkById(parkId);
    const park = {
      id: parkId,
      ...parkRecord
    };
    renderProfileFavoriteModalBody({ park });
  } catch (error) {
    renderProfileFavoriteModalBody({ errorMessage: formatAppError(error, "Unable to load park details.") });
  }
}

function closeProfileFavoriteDetail() {
  setProfileFavoriteModalOpen(false);
  renderProfileFavoriteModalBody();
}

async function loadCommunityFeaturesForSelectedPark() {
  if (!appState.selectedPark?.id) {
    return;
  }

  try {
    appState.reviews = await getReviews(appState.selectedPark.id);
    if (isAuthenticated()) {
      appState.favoriteLoading = true;
      appState.favoriteParks = await getFavorites(appState.currentUser.uid);
      appState.favoriteLoading = false;
    }
  } catch (error) {
    appState.reviewError = formatAppError(error, "Unable to load community features.");
  }
}

function renderReviewSection(park) {
  if (!isAuthenticated()) {
    return `
      <div class="review-section">
        <h4>Reviews</h4>
        <p class="muted">Sign in to leave a review.</p>
        ${renderReviewList()}
      </div>
    `;
  }

  return `
    <div class="review-section">
      <h4>Reviews</h4>
      ${appState.reviewError ? `<p class="crowd-report-error">${escapeHtml(appState.reviewError)}</p>` : ""}
      ${appState.reviewSuccess ? `<p class="crowd-report-success">${escapeHtml(appState.reviewSuccess)}</p>` : ""}
      <form class="review-form" onsubmit="event.preventDefault(); window.appControllerExports.submitReview('${park.id}');">
        <div class="form-group">
          <label for="review-rating">Rating</label>
          <select id="review-rating" onchange="window.appControllerExports.updateReviewRating(this.value)">
            <option value="5" ${appState.reviewForm.rating === 5 ? "selected" : ""}>5 Stars</option>
            <option value="4" ${appState.reviewForm.rating === 4 ? "selected" : ""}>4 Stars</option>
            <option value="3" ${appState.reviewForm.rating === 3 ? "selected" : ""}>3 Stars</option>
            <option value="2" ${appState.reviewForm.rating === 2 ? "selected" : ""}>2 Stars</option>
            <option value="1" ${appState.reviewForm.rating === 1 ? "selected" : ""}>1 Star</option>
          </select>
        </div>
        <div class="form-group">
          <label for="review-body">Comments</label>
          <textarea id="review-body" rows="3" placeholder="Share your experience..." oninput="window.appControllerExports.updateReviewBody(this.value)">${escapeHtml(appState.reviewForm.body || "")}</textarea>
        </div>
        <button class="btn btn-primary" type="submit" ${appState.reviewSubmitting ? "disabled" : ""}>${appState.reviewSubmitting ? "Submitting..." : "Submit Review"}</button>
      </form>
      ${renderReviewList()}
    </div>
  `;
}

function renderReviewList() {
  if (!appState.reviews.length) {
    return '<p class="muted">No reviews yet.</p>';
  }

  return `<ul class="review-list">${appState.reviews.map((review) => `
    <li class="review-item">
      <strong>${escapeHtml(review.userId || "Guest")}</strong>
      <span class="badge badge-open">${escapeHtml(String(review.rating || 0))}★</span>
      <p>${escapeHtml(review.body || "")}</p>
    </li>
  `).join("")}</ul>`;
}

function renderPhotoSection(park) {
  return `
    <div class="photo-upload-area">
      <h4>Photos</h4>
      ${appState.photoError ? `<p class="crowd-report-error">${escapeHtml(appState.photoError)}</p>` : ""}
      ${appState.photoSuccess ? `<p class="crowd-report-success">${escapeHtml(appState.photoSuccess)}</p>` : ""}
      ${isAuthenticated() ? `
        <form class="photo-form" onsubmit="event.preventDefault(); window.appControllerExports.submitPhoto('${park.id}');">
          <div class="form-group">
            <label for="park-photo-input">Upload a photo</label>
            <input id="park-photo-input" type="file" accept="image/jpeg,image/png,image/webp" />
          </div>
          <button class="btn btn-secondary" type="submit" ${appState.photoSubmitting ? "disabled" : ""}>${appState.photoSubmitting ? "Uploading..." : "Upload Photo"}</button>
        </form>
      ` : '<p class="muted">Sign in to upload a photo.</p>'}
      ${Array.isArray(park.photos) && park.photos.length > 0 ? `<div class="photo-gallery">${park.photos.map((photo) => `<img src="${escapeHtml(photo)}" alt="Park photo" />`).join("")}</div>` : '<p class="muted">No photos uploaded yet.</p>'}
    </div>
  `;
}

function updateReviewRating(value) {
  appState.reviewForm.rating = Number(value || 5);
  appState.reviewError = null;
  appState.reviewSuccess = null;
}

function updateReviewBody(value) {
  appState.reviewForm.body = value || "";
  appState.reviewError = null;
  appState.reviewSuccess = null;
}

async function submitReview(parkId) {
  try {
    if (!isAuthenticated()) {
      throw new Error("Please sign in to submit a review.");
    }

    appState.reviewSubmitting = true;
    appState.reviewError = null;
    appState.reviewSuccess = null;
    renderParkDetail();
    renderReviewActionPanel();

    const createdReview = await createReview(parkId, appState.currentUser.uid, {
      rating: appState.reviewForm.rating,
      body: appState.reviewForm.body
    });

    appState.reviewSuccess = "Review submitted successfully.";
    appState.reviewForm = { rating: 5, body: "" };
    appState.reviews = [createdReview, ...appState.reviews];
    try {
      const refreshedPark = await getParkById(parkId);
      appState.selectedPark = {
        ...appState.selectedPark,
        reviewAggregate: refreshedPark.reviewAggregate || { averageRating: null, reviewCount: 0 }
      };
    } catch {
      // Keep the existing park state if the refresh fails; aggregate will sync on next detail load.
    }
    appState.reviewSubmitting = false;
    renderParkDetail();
    renderReviewActionPanel();
  } catch (error) {
    appState.reviewSubmitting = false;
    appState.reviewError = formatAppError(error, "Unable to submit review.");
    renderParkDetail();
    renderReviewActionPanel();
  }

}

async function submitPhoto(parkId) {
  try {
    const fileInput = document.getElementById("park-photo-input");
    const file = fileInput?.files?.[0];

    if (!file) {
      throw new Error("Select a photo before uploading.");
    }

    appState.photoSubmitting = true;
    appState.photoError = null;
    appState.photoSuccess = null;
    renderParkDetail();
    renderReviewActionPanel();

    const result = await submitParkPhoto(parkId, appState.currentUser.uid, file);
    appState.photoSuccess = "Photo uploaded successfully.";
    appState.selectedPark = {
      ...appState.selectedPark,
      photos: result.photos || []
    };
    appState.photoSubmitting = false;
    renderParkDetail();
    renderReviewActionPanel();
  } catch (error) {
    appState.photoSubmitting = false;
    appState.photoError = formatAppError(error, "Unable to upload photo.");
    renderParkDetail();
    renderReviewActionPanel();
  }
}

async function toggleFavorite(parkId) {
  try {
    if (!isAuthenticated()) {
      throw new Error("Please sign in to save favorites.");
    }

    appState.favoriteLoading = true;
    appState.favoriteError = null;
    renderParkDetail();

    const favoriteExists = appState.favoriteParks.some((favorite) => favorite.parkId === parkId);
    if (favoriteExists) {
      await removeFavorite(appState.currentUser.uid, parkId);
      appState.favoriteParks = appState.favoriteParks.filter((favorite) => favorite.parkId !== parkId);
    } else {
      const response = await addFavorite(appState.currentUser.uid, parkId);
      if (response.added) {
        appState.favoriteParks = [...appState.favoriteParks, response.favorite];
      }
    }

    appState.favoriteLoading = false;
    renderParkDetail();
  } catch (error) {
    appState.favoriteLoading = false;
    appState.favoriteError = formatAppError(error, "Unable to update favorites.");
    renderParkDetail();
  }
}

/**
 * Apply initial dashboard state passed from URL redirect params.
 * Supports:
 * - ?q=... (search term)
 * - ?parkId=... (open park detail)
 */
function applyInitialDashboardSearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const initialSearchTerm = (params.get("q") || "").trim();
  const initialParkId = (params.get("parkId") || "").trim();

  if (initialSearchTerm) {
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.value = initialSearchTerm;
    }

    updateSearchTerm(initialSearchTerm);
  }

  if (initialParkId) {
    selectParkForDetail(initialParkId).catch((error) => {
      console.error("Unable to open park detail from URL parameter:", error);
    });
  }
}

/**
 * Initialize search and filter event listeners on dashboard
 */
function initializeParkSearchAndFilter() {
  // Search input listener
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      updateSearchTerm(e.target.value);
    });
  }

  // Age group checkboxes
  ["toddler", "kid", "teen"].forEach((group) => {
    const checkbox = document.getElementById(`filter-age-${group}`);
    if (checkbox) {
      checkbox.addEventListener("change", (e) => {
        const ageGroups = appState.filterCriteria.ageGroups || [];
        if (e.target.checked) {
          if (!ageGroups.includes(group)) {
            ageGroups.push(group);
          }
        } else {
          const index = ageGroups.indexOf(group);
          if (index > -1) {
            ageGroups.splice(index, 1);
          }
        }
        updateFilterCriteria({ ageGroups });
      });
    }
  });

  // Boolean filters
  const filterAmenities = {
    "filter-fenced": "fencedArea",
    "filter-restrooms": "restrooms",
    "filter-shade": "shadeAvailable"
  };

  Object.entries(filterAmenities).forEach(([elementId, criteriaKey]) => {
    const checkbox = document.getElementById(elementId);
    if (checkbox) {
      checkbox.addEventListener("change", (e) => {
        updateFilterCriteria({ [criteriaKey]: e.target.checked || null });
      });
    }
  });

  // Maintenance status dropdown
  const maintenanceSelect = document.getElementById("filter-maintenance");
  if (maintenanceSelect) {
    maintenanceSelect.addEventListener("change", (e) => {
      updateFilterCriteria({ maintenanceStatus: e.target.value || null });
    });
  }

  // Clear filters button
  const clearBtn = document.getElementById("clear-filters-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearSearchAndFilters);
  }

  const createParkButton = document.getElementById("create-park-btn");
  if (createParkButton) {
    createParkButton.addEventListener("click", openCreateParkForm);
  }

  const mapToggleButton = document.getElementById("toggle-map-view-btn");
  if (mapToggleButton) {
    mapToggleButton.addEventListener("click", toggleMapView);
  }

  executeSearchAndFilter();

}

function initializeApp() {
  try {
    initializeFirebaseServices();
    const { auth } = getFirebaseServices();

    appState.currentView = getCurrentView();
    hideProtectedViewUntilAuthReady();

    onAuthStateChanged(auth, handleAuthStateChanged);

    // Route protection now happens in handleAuthStateChanged after auth state is ready
    initializeViewController();
    appState.isInitialized = true;
    
    // Export functions for use in HTML onclick handlers
    window.appControllerExports = {
      selectParkForDetail,
      clearParkDetail,
      closeDashboardParkModal: clearParkDetail,
      openParkActionModal,
      closeParkActionModal,
      openProfileFavoriteDetail,
      closeProfileFavoriteDetail,
      updateSearchTerm,
      updateFilterCriteria,
      clearSearchAndFilters,
      loadMoreParkResults,
      openCreateParkForm,
      openEditParkForm,
      cancelParkForm,
      submitParkForm,
      lookupParkCoordinatesFromAddress,
      updateCrowdReportLevel,
      submitCrowdReportFromSelection,
      clearCrowdReportSelection,
      updateReviewRating,
      updateReviewBody,
      submitReview,
      submitPhoto,
      toggleFavorite,
      toggleNotificationPanel,
      markNotificationRead: markNotificationReadHandler,
      updateSafetyReportDescription,
      updateSafetyReportType,
      updateSafetyReportFilter,
      submitSafetyReport: submitSafetyReportHandler,
      transitionSafetyReport,
      deleteSafetyReport: deleteSafetyReportHandler,
      updateEquipmentName,
      updateEquipmentType,
      submitEquipment: submitEquipmentHandler,
      transitionEquipmentStatus,
      deleteEquipment: deleteEquipmentHandler,
      toggleMapView,
      selectAdminPark,
      refreshCrowdHistory,
      updateDeleteParkConfirmInput,
      openDeleteParkModal,
      closeDeleteParkModal,
      deletePark: deleteParkHandler
    };
    
    return appState;
  } catch (error) {
    appState.isInitialized = false;
    throw new Error(`App initialization failed: ${error.message}`);
  }
}

export {
  appState,
  initializeApp,
  isAuthenticated,
  getCurrentUserRole,
  canCreateParkRecord,
  canEditParkRecord,
  canDeleteParkRecord,
  enforceRoleOrThrow,
  updateSearchTerm,
  updateFilterCriteria,
  clearSearchAndFilters,
  selectParkForDetail,
  clearParkDetail
};