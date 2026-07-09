/*
  App Controller
  Purpose: Coordinate view-level actions and call services/models as needed.
  Add route handling, event listeners, and page-specific logic in this file.
*/

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { initializeAuthController, handleLogout } from "./authController.js";
import {
  getFirebaseServices,
  initializeFirebaseServices
} from "../services/firebase-config.js";
import { readRecords, searchAndFilterParks, getParkById } from "../services/databaseService.js";

const appState = {
  isInitialized: false,
  authReady: false,
  currentUser: null,
  userRole: null,
  currentView: "",
  // Phase 3: Search and filter state
  searchTerm: "",
  filterCriteria: {
    ageGroups: [],
    fencedArea: null,
    restrooms: null,
    shadeAvailable: null,
    maintenanceStatus: null
  },
  parkResults: [],
  isLoadingParks: false,
  parksError: null,
  selectedPark: null
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
  return role === "Park Admin" || role === "Site Admin";
}

function canEditParkRecord() {
  const role = getCurrentUserRole();
  return role === "Park Admin" || role === "Site Admin";
}

function canDeleteParkRecord() {
  const role = getCurrentUserRole();
  return role === "Site Admin";
}

function enforceRoleOrThrow(requiredRoles) {
  const currentRole = getCurrentUserRole();
  if (!requiredRoles.includes(currentRole)) {
    throw new Error(`You don't have permission to perform this action. Required role(s): ${requiredRoles.join(", ")}`);
  }
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

// ============================================================
// Auth State Handler
// ============================================================

async function handleAuthStateChanged(firebaseUser) {
  appState.currentUser = firebaseUser;
  appState.authReady = true;

  // Phase 2: Load user role from Firestore when user logs in
  if (firebaseUser) {
    await loadUserRole(firebaseUser.uid);
  } else {
    appState.userRole = null;
  }

  // Check route protection after auth state is ready
  if (isProtectedView(appState.currentView) && !firebaseUser) {
    redirectIfNotAuthenticated(appState.currentView, firebaseUser);
    return;
  }

  revealProtectedViewAfterAuthReady();
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

    const results = await searchAndFilterParks(appState.searchTerm, appState.filterCriteria);
    appState.parkResults = results;
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
    renderParkDetail();
  } catch (error) {
    console.error("Failed to load park detail:", error);
    appState.parksError = error.message;
  }
}

/**
 * Clear selected park (back to list)
 */
function clearParkDetail() {
  appState.selectedPark = null;
  renderParkDetail();
}

/**
 * Render park results list
 */
function renderParkResults() {
  const resultsContainer = document.getElementById("park-results-container");
  if (!resultsContainer) return;

  resultsContainer.innerHTML = "";

  // Loading state
  if (appState.isLoadingParks) {
    resultsContainer.innerHTML = `
      <div class="state-loading">
        <div class="spinner"></div>
        <p>Loading parks...</p>
      </div>
    `;
    return;
  }

  // Error state
  if (appState.parksError) {
    resultsContainer.innerHTML = `
      <div class="state-error">
        <p class="error-message show">${appState.parksError}</p>
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
      <h3>${park.name}</h3>
      <p class="park-location">${park.location}</p>
      <div class="park-amenities">
        ${park.ageGroups?.toddler ? '<span class="amenity-tag">Toddler</span>' : ''}
        ${park.ageGroups?.kid ? '<span class="amenity-tag">Kid</span>' : ''}
        ${park.ageGroups?.teen ? '<span class="amenity-tag">Teen</span>' : ''}
        ${park.fencedArea ? '<span class="amenity-tag">Fenced</span>' : ''}
        ${park.restrooms ? '<span class="amenity-tag">Restrooms</span>' : ''}
        ${park.shadeAvailable ? '<span class="amenity-tag">Shade</span>' : ''}
      </div>
      <p class="park-status">Status: <strong>${park.maintenanceStatus || 'Unknown'}</strong></p>
    </div>
  `).join("");

  resultsContainer.innerHTML = `
    <div class="results-header">
      <p><strong>${appState.parkResults.length}</strong> park(s) found</p>
    </div>
    <div class="park-results-list">
      ${resultsHTML}
    </div>
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
      <h2>${park.name}</h2>
      <p class="detail-location"><strong>Location:</strong> ${park.location}</p>
      
      <section class="detail-section">
        <h3>Safety & Amenities</h3>
        <p><strong>Safety Notes:</strong> ${park.safetyNotes || 'No safety notes available.'}</p>
        <p><strong>Amenities:</strong> ${park.amenitiesNotes || 'No amenity details available.'}</p>
        <p><strong>Maintenance Status:</strong> ${park.maintenanceStatus || 'Unknown'}</p>
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
          <button class="btn btn-primary">Edit Park</button>
        </section>
      ` : ''}
    </div>
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
}

function initializeApp() {
  try {
    initializeFirebaseServices();
    const { auth } = getFirebaseServices();

    appState.currentView = getCurrentView();
    hideProtectedViewUntilAuthReady();

    // Re-check protection when returning via browser history (BFCache restore).
    window.addEventListener("pageshow", () => {
      redirectIfNotAuthenticated(appState.currentView, auth.currentUser);
    });

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
      clearSearchAndFilters
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