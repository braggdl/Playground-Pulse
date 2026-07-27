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
  SAFETY_REPORT_TRANSITIONS
} from "../constants/reportConstants.js";
import {
  calculateBusyLevelFromReports,
  createEquipment,
  createSafetyReport,
  deleteEquipment,
  deleteSafetyReport,
  getCrowdHistory,
  getEquipment,
  getSafetyReports,
  getUserNotifications,
  getParkById,
  getRecentCrowdReportsForPark,
  markNotificationRead,
  submitCrowdReport
} from "../services/databaseService.js";
import { subscribeToUserNotifications } from "../services/notificationService.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";
import {
  createParkRecord,
  editParkRecord,
  readRecords,
  updateRecord,
  updateEquipmentStatus,
  updateSafetyReportStatus,
  searchAndFilterParks
} from "../services/databaseService.js";

const appState = {
  isInitialized: false,
  currentView: "",
  // Workstream A: Auth and profile state.
  authReady: false,
  currentUser: null,
  userRole: null,
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
  mapMode: false,
  mapInstance: null,
  mapMarkersLayer: null,
  // Admin view state.
  adminParks: [],
  adminSelectedParkId: "",
  adminPanelError: null
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
  return ["dashboard", "profile", "admin"].includes(viewName);
}

function hideProtectedViewUntilAuthReady() {
  if (!isProtectedView(appState.currentView)) {
    return;
  }

  document.body.style.visibility = "hidden";
}

function revealProtectedViewAfterAuthReady() {
  if (!isProtectedView(appState.currentView)) {
    return;
  }

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

function canCreateParkRecord() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.PARK_ADMIN || role === USER_ROLES.SITE_ADMIN;
}

function canEditParkRecord() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.PARK_ADMIN || role === USER_ROLES.SITE_ADMIN;
}

function canDeleteParkRecord() {
  const role = getCurrentUserRole();
  return role === USER_ROLES.SITE_ADMIN;
}

function canManageSafetyReports() {
  return canPerformAction(getCurrentUserRole(), "safetyReportTransition");
}

function canManageEquipment() {
  return canPerformAction(getCurrentUserRole(), "equipmentStatusChange");
}

function canDeleteSafetyReports() {
  return canPerformAction(getCurrentUserRole(), "safetyReportDelete");
}

function canDeleteEquipmentRecords() {
  return canPerformAction(getCurrentUserRole(), "equipmentDelete");
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

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not reported yet";
  }

  return date.toLocaleString();
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

  const date = new Date(value);
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

  const lat = Number(park.latitude ?? park.lat);
  const lng = Number(park.longitude ?? park.lng ?? park.lon);

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

  const enrichedPark = {
    ...park,
    busyLevel: {
      score: busyLevel.score ?? fallbackBusyLevel.score ?? null,
      label: busyLevel.score !== null ? busyLevel.label : (fallbackBusyLevel.label || "Unknown"),
      updatedAt: latestReport?.reportedAt || fallbackBusyLevel.updatedAt || null
    },
    crowdReporting: {
      enabled: true,
      reportCountLastHour: recentReports.length ? busyLevel.reportCount : Number(fallbackCrowdReporting.reportCountLastHour || 0),
      lastReportedAt: latestReport?.reportedAt || fallbackCrowdReporting.lastReportedAt || null,
      latestWindowKey: latestReport?.windowKey || fallbackCrowdReporting.latestWindowKey || null
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
  const reportContainer = document.getElementById("crowd-report-container");
  if (!reportContainer) {
    return;
  }

  if (!isAuthenticated() || !appState.selectedPark) {
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
          <p class="crowd-report-meta">${reportCount} report(s) in the last hour</p>
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

function renderNotificationPanel() {
  const toggleButton = document.getElementById("admin-notifications-toggle-btn");
  const unreadBadge = document.getElementById("admin-notification-unread-count");
  const adminNavBadge = document.getElementById("admin-notification-count");
  const panelContainer = document.getElementById("notification-panel-container");

  const isAdminCapable = isAuthenticated() && (canManageSafetyReports() || canManageEquipment());
  const canShowNotifications = isAdminCapable && appState.currentView === "admin";

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

  if (!panelContainer || !canShowNotifications) {
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
  const container = document.getElementById("equipment-panel-container");
  if (!container) {
    return;
  }

  if (!isAuthenticated() || !appState.selectedPark) {
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
  const container = document.getElementById("crowd-history-container");
  if (!container) {
    return;
  }

  if (!appState.selectedPark) {
    container.innerHTML = "";
    return;
  }

  const maxCount = appState.crowdHistory.reduce((max, item) => Math.max(max, Number(item.reportCount || 0)), 0);

  container.innerHTML = `
    <section class="crowd-history-panel card">
      <h3>7-Day Crowd Trend</h3>
      ${appState.crowdHistoryError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.crowdHistoryError)}</p>` : ""}
      ${appState.crowdHistory.length === 0 ? "<p>No crowd history is available yet for this park.</p>" : `
        <div class="crowd-history-bars">
          ${appState.crowdHistory.map((day) => {
            const count = Number(day.reportCount || 0);
            const percent = maxCount > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 8;
            return `
              <div class="crowd-history-day">
                <div class="crowd-history-bar-wrap">
                  <div class="crowd-history-bar" style="height: ${percent}%;" title="${count} report(s)"></div>
                </div>
                <strong>${count}</strong>
                <span class="crowd-history-date">${escapeHtml(formatShortDate(day.date))}</span>
              </div>
            `;
          }).join("")}
        </div>
      `}
    </section>
  `;
}

function renderMapPanel() {
  const container = document.getElementById("park-map-container");
  if (!container) {
    return;
  }

  const toggleButton = document.getElementById("toggle-map-view-btn");
  if (toggleButton) {
    const shouldShowToggle = isAuthenticated() && appState.currentView === "dashboard";
    toggleButton.style.display = shouldShowToggle ? "inline-flex" : "none";
    toggleButton.textContent = appState.mapMode ? "Hide Map" : "Map View";
  }

  if (!appState.mapMode || appState.currentView !== "dashboard") {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  container.innerHTML = `
    <section class="card">
      <h3>Park Map View</h3>
      <div id="leaflet-map-canvas" class="park-map-view"></div>
    </section>
  `;

  if (!window.L) {
    container.innerHTML += "<p class='crowd-report-message crowd-report-error'>Map library failed to load.</p>";
    return;
  }

  const mapElement = document.getElementById("leaflet-map-canvas");
  if (!mapElement) {
    return;
  }

  if (!appState.mapInstance) {
    appState.mapInstance = window.L.map(mapElement).setView([39.5, -98.35], 4);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(appState.mapInstance);
    appState.mapMarkersLayer = window.L.layerGroup().addTo(appState.mapInstance);
  } else {
    appState.mapInstance.invalidateSize();
  }

  if (appState.mapMarkersLayer) {
    appState.mapMarkersLayer.clearLayers();
  }

  const parksWithCoordinates = appState.parkResults
    .map((park) => ({ park, coordinates: getParkCoordinates(park) }))
    .filter((item) => Array.isArray(item.coordinates));

  if (parksWithCoordinates.length === 0) {
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

    marker.addTo(appState.mapMarkersLayer);
    bounds.push(coordinates);
  });

  if (bounds.length > 0) {
    appState.mapInstance.fitBounds(bounds, { padding: [25, 25] });
  }
}

function renderAdminPanels() {
  const safetyPanel = document.getElementById("admin-safety-panel");
  const equipmentPanel = document.getElementById("admin-equipment-panel");
  const statusPanel = document.getElementById("admin-workstream1-status");

  if (!safetyPanel || !equipmentPanel || !statusPanel) {
    return;
  }

  const canDeleteSafety = canDeleteSafetyReports();
  const canDeleteEquipmentItems = canDeleteEquipmentRecords();

  if (!canManageSafetyReports() && !canManageEquipment()) {
    safetyPanel.innerHTML = "<h3>Safety Reports</h3><p>You do not have permission to manage safety reports.</p>";
    equipmentPanel.innerHTML = "<h3>Equipment Status</h3><p>You do not have permission to manage equipment records.</p>";
    statusPanel.innerHTML = "<p>Use a Park Admin or Site Admin account for Workstream 1 management actions.</p>";
    return;
  }

  const selectedParkId = appState.adminSelectedParkId || "";

  safetyPanel.innerHTML = `
    <h3>Safety Report Queue</h3>
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

  statusPanel.innerHTML = `
    ${appState.adminPanelError ? `<p class="crowd-report-message crowd-report-error">${escapeHtml(appState.adminPanelError)}</p>` : "<p>Workstream 1 management actions are ready.</p>"}
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
    appState.adminPanelError = appState.safetyReportError;
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
    appState.adminPanelError = appState.safetyReportError;
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
    appState.adminPanelError = appState.equipmentError;
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
    appState.adminPanelError = appState.equipmentError;
    renderEquipmentPanel();
    renderAdminPanels();
  }
}

function toggleMapView() {
  appState.mapMode = !appState.mapMode;
  renderMapPanel();
}

async function selectAdminPark(parkId) {
  appState.adminSelectedParkId = parkId;
  appState.selectedPark = parkId ? await loadCrowdReportStateForPark(parkId) : null;
  await loadSprint3DetailData();
  renderAdminPanels();
}

async function loadUserRole(uid) {
  try {
    const users = await readRecords("users", { uid: uid });
    if (users && users.length > 0) {
      appState.userRole = users[0].role;
    } else {
      appState.userRole = null;
    }
  } catch (error) {
    console.error("Failed to load user role:", error);
    appState.userRole = null;
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

  // Phase 2: Load user role from Firestore when user logs in
  if (firebaseUser) {
    await loadUserRole(firebaseUser.uid);
    if (canManageSafetyReports() || canManageEquipment()) {
      await startNotificationsSubscription();
    } else {
      stopNotificationsSubscription();
      normalizeNotificationList([]);
    }
  } else {
    stopNotificationsSubscription();
    normalizeNotificationList([]);
    appState.userRole = null;
  }

  appState.authReady = true;

  // Route decisions must happen only after auth state is resolved.
  if (applyRouteAccessRules(firebaseUser)) {
    return;
  }

  revealProtectedViewAfterAuthReady();

  if (appState.currentView === "dashboard") {
    renderParkForm();
    updateDashboardManagementControls();
    renderCrowdReportPanel();
    renderSprint3Panels();
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
  
  renderParkResults();
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

    if (!hasSearchTerm && !hasFilters) {
      appState.parkResults = [];
      appState.isLoadingParks = false;
      renderParkResults();
      renderMapPanel();
      return;
    }

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
    appState.adminPanelError = null;
    await loadSprint3DetailData();
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
  appState.selectedPark = null;
  appState.safetyReports = [];
  appState.equipmentItems = [];
  appState.crowdHistory = [];
  clearCrowdReportState();
  renderParkDetail();
  renderCrowdReportPanel();
  renderSafetyReportPanel();
  renderEquipmentPanel();
  renderCrowdHistoryPanel();
}

function updateDashboardManagementControls() {
  const createButton = document.getElementById("create-park-btn");
  const mapToggleButton = document.getElementById("toggle-map-view-btn");
  const adminNavLink = document.getElementById("nav-admin-link");

  if (!createButton && !mapToggleButton && !adminNavLink) {
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
    mapToggleButton.style.display = isAuthenticated() ? "inline-flex" : "none";
  }

  if (adminNavLink) {
    const canSeeAdmin = canManageSafetyReports() || canManageEquipment();
    adminNavLink.style.display = canSeeAdmin ? "inline-flex" : "none";
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
    enforceRoleOrThrow([USER_ROLES.PARK_ADMIN, USER_ROLES.SITE_ADMIN]);
    appState.parkFormMode = "create";
    appState.parkFormRecordId = null;
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    renderParkForm();
  } catch (error) {
    appState.parkFormError = formatAppError(error, "You are not allowed to create parks.");
    renderParkForm();
  }
}

function openEditParkForm() {
  try {
    enforceRoleOrThrow([USER_ROLES.PARK_ADMIN, USER_ROLES.SITE_ADMIN]);

    if (!appState.selectedPark?.id) {
      throw new Error("Select a park before editing.");
    }

    appState.parkFormMode = "edit";
    appState.parkFormRecordId = appState.selectedPark.id;
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    renderParkForm();
  } catch (error) {
    appState.parkFormError = formatAppError(error, "You are not allowed to edit this park.");
    renderParkForm();
  }
}

function cancelParkForm() {
  clearParkFormState();
  renderParkForm();
}

async function submitParkForm() {
  try {
    enforceRoleOrThrow([USER_ROLES.PARK_ADMIN, USER_ROLES.SITE_ADMIN]);

    if (!appState.parkFormMode) {
      throw new Error("No park form is active.");
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
  const detailContainer = document.getElementById("park-detail-container");
  if (!detailContainer) return;

  if (!appState.selectedPark) {
    detailContainer.innerHTML = "";
    return;
  }

  const park = appState.selectedPark;
  const canEdit = canEditParkRecord();

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
          <p>${park.crowdReporting?.reportCountLastHour || 0} report(s) in the last hour</p>
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
      
      ${canEdit ? `
        <section class="detail-section">
          <h3>Actions</h3>
          <button class="btn btn-primary" onclick="window.appControllerExports.openEditParkForm()">Edit Park</button>
        </section>
      ` : ''}
    </div>
  `;
}

function renderParkForm() {
  const formContainer = document.getElementById("park-form-container");
  if (!formContainer) {
    return;
  }

  const canManage = canCreateParkRecord();
  const isEditing = appState.parkFormMode === "edit";
  const sourcePark = isEditing ? appState.selectedPark : null;

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

function initializeViewController() {
  if (appState.currentView === "login" || appState.currentView === "profile") {
    initializeAuthController();
  }

  // Phase 3: Initialize search and filter handlers for dashboard
  if (appState.currentView === "dashboard") {
    initializeParkSearchAndFilter();
    applyInitialDashboardSearchFromUrl();
    renderCrowdReportPanel();
    renderSafetyReportPanel();
    renderEquipmentPanel();
    renderCrowdHistoryPanel();
    renderMapPanel();
  }

  if (appState.currentView === "admin") {
    const notificationToggleButton = document.getElementById("admin-notifications-toggle-btn");
    if (notificationToggleButton) {
      notificationToggleButton.addEventListener("click", toggleNotificationPanel);
    }

    renderAdminPanels();
    renderNotificationPanel();
  }
}

/**
 * Apply initial search term passed from home page redirect (?q=...)
 */
function applyInitialDashboardSearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const initialSearchTerm = (params.get("q") || "").trim();

  if (!initialSearchTerm) {
    return;
  }

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.value = initialSearchTerm;
  }

  updateSearchTerm(initialSearchTerm);
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
      updateSearchTerm,
      updateFilterCriteria,
      clearSearchAndFilters,
      loadMoreParkResults,
      openCreateParkForm,
      openEditParkForm,
      cancelParkForm,
      submitParkForm,
      updateCrowdReportLevel,
      submitCrowdReportFromSelection,
      clearCrowdReportSelection,
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
      selectAdminPark
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