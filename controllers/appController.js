/*
  App Controller
  Purpose: Coordinate view-level actions and call services/models as needed.
  Add route handling, event listeners, and page-specific logic in this file.
*/

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeAuthController, handleLogout } from "./authController.js";
import { USER_ROLES } from "../models/userModel.js";
import { PARK_SEARCH_DEFAULTS } from "../constants/searchConstants.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";
import {
  createParkRecord,
  editParkRecord,
  getParkById,
  readRecords,
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
  isSubmittingParkForm: false
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

  if (pathName.endsWith("home.html")) {
    return "home";
  }

  return "index";
}

function isProtectedView(viewName) {
  return ["dashboard", "profile"].includes(viewName);
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
  } else {
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
  } catch (error) {
    console.error("Search and filter error:", error);
    appState.isLoadingParks = false;
    appState.parksError = error.message;
    renderParkResults();
  }
}

/**
 * Select a park for detail view
 */
async function selectParkForDetail(parkId) {
  try {
    appState.selectedPark = await getParkById(parkId);
    appState.parkFormError = null;
    appState.parkFormSuccess = null;
    renderParkDetail();
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
  renderParkDetail();
}

function updateDashboardManagementControls() {
  const createButton = document.getElementById("create-park-btn");
  if (!createButton) {
    return;
  }

  if (canCreateParkRecord()) {
    createButton.style.display = "inline-flex";
    createButton.disabled = false;
  } else {
    createButton.style.display = "none";
    createButton.disabled = true;
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
  if (appState.currentView === "login") {
    initializeAuthController();
  }

  // Phase 3: Initialize search and filter handlers for dashboard
  if (appState.currentView === "dashboard") {
    initializeParkSearchAndFilter();
    applyInitialDashboardSearchFromUrl();
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
      submitParkForm
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