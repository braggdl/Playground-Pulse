/*
  Auth Controller
  Purpose: Connect login/register/logout UI actions to the authentication service.
  Add DOM event listeners and form handling logic here.
*/

import { login, logout, registerUser } from "../services/authService.js";
import { createUserRecord } from "../services/databaseService.js";
import { createUserModel } from "../models/userModel.js";

let isAuthMode = "login"; // Track whether we're in login or register mode

// ============================================================
// UI Helper Functions
// ============================================================

function showError(message) {
  const errorContainer = document.getElementById("auth-error-message");
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = "block";
  }
}

function clearError() {
  const errorContainer = document.getElementById("auth-error-message");
  if (errorContainer) {
    errorContainer.textContent = "";
    errorContainer.style.display = "none";
  }
}

function setButtonLoading(buttonId, loading) {
  const button = document.getElementById(buttonId);
  if (button) {
    button.disabled = loading;
    button.textContent = loading ? "Loading..." : button.dataset.originalText || button.textContent;
  }
}

function toggleAuthMode() {
  isAuthMode = isAuthMode === "login" ? "register" : "login";
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  if (loginForm && registerForm) {
    if (isAuthMode === "register") {
      loginForm.style.display = "none";
      registerForm.style.display = "block";
    } else {
      loginForm.style.display = "block";
      registerForm.style.display = "none";
    }
  }
  clearError();
}

// ============================================================
// Validation Functions
// ============================================================

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

function validateLoginForm() {
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");

  if (!emailInput || !passwordInput) return false;

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showError("Email and password are required");
    return false;
  }

  if (!validateEmail(email)) {
    showError("Please enter a valid email address");
    return false;
  }

  if (!validatePassword(password)) {
    showError("Password must be at least 6 characters");
    return false;
  }

  return true;
}

function validateRegisterForm() {
  const emailInput = document.getElementById("register-email");
  const passwordInput = document.getElementById("register-password");
  const confirmPasswordInput = document.getElementById("register-confirm-password");
  const displayNameInput = document.getElementById("register-display-name");

  if (!emailInput || !passwordInput || !confirmPasswordInput || !displayNameInput) {
    return false;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();
  const displayName = displayNameInput.value.trim();

  if (!email || !password || !confirmPassword || !displayName) {
    showError("All fields are required");
    return false;
  }

  if (!validateEmail(email)) {
    showError("Please enter a valid email address");
    return false;
  }

  if (!validatePassword(password)) {
    showError("Password must be at least 6 characters");
    return false;
  }

  if (password !== confirmPassword) {
    showError("Passwords do not match");
    return false;
  }

  if (displayName.length < 2) {
    showError("Display name must be at least 2 characters");
    return false;
  }

  return true;
}

// ============================================================
// Auth Handler Functions
// ============================================================

async function handleLogin() {
  clearError();

  if (!validateLoginForm()) {
    return;
  }

  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const loginButton = document.getElementById("login-btn");

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  setButtonLoading("login-btn", true);

  try {
    await login(email, password);
    // Redirect to dashboard on success
    window.location.href = "./dashboard.html";
  } catch (error) {
    setButtonLoading("login-btn", false);

    // Map Firebase error codes to user-friendly messages
    if (error.message.includes("auth/user-not-found")) {
      showError("User not found. Please check your email or register.");
    } else if (error.message.includes("auth/wrong-password")) {
      showError("Incorrect password. Please try again.");
    } else if (error.message.includes("auth/invalid-email")) {
      showError("Invalid email address.");
    } else if (error.message.includes("auth/user-disabled")) {
      showError("This account has been disabled.");
    } else {
      showError(error.message || "Login failed. Please try again.");
    }
  }
}

async function handleRegister() {
  clearError();

  if (!validateRegisterForm()) {
    return;
  }

  const emailInput = document.getElementById("register-email");
  const passwordInput = document.getElementById("register-password");
  const displayNameInput = document.getElementById("register-display-name");
  const roleSelect = document.getElementById("register-role");

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const displayName = displayNameInput.value.trim();
  const role = roleSelect ? roleSelect.value : "Parent";

  setButtonLoading("register-btn", true);

  try {
    // Call authService to create Firebase user
    const firebaseUser = await registerUser(email, password);

    // Create user record in Firestore
    const userRecord = createUserModel({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: displayName,
      role: role
    });

    await createUserRecord(firebaseUser.uid, userRecord);

    // Redirect to dashboard on success
    window.location.href = "./dashboard.html";
  } catch (error) {
    setButtonLoading("register-btn", false);

    // Map Firebase error codes to user-friendly messages
    if (error.message.includes("auth/email-already-in-use")) {
      showError("Email already registered. Please log in or use a different email.");
    } else if (error.message.includes("auth/weak-password")) {
      showError("Password is too weak. Please use a stronger password.");
    } else if (error.message.includes("auth/invalid-email")) {
      showError("Invalid email address.");
    } else if (error.message.includes("Create user record failed")) {
      showError("Account was created, but profile setup failed. Please contact support or retry.");
    } else {
      showError(error.message || "Registration failed. Please try again.");
    }
  }
}

async function handleLogout() {
  try {
    await logout();
    // Redirect to login page on success
    window.location.href = "./login.html";
  } catch (error) {
    console.error("Logout failed:", error);
    showError(error.message || "Logout failed. Please try again.");
  }
}

// ============================================================
// Initialization
// ============================================================

function initializeAuthController() {
  // Login form handlers
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) {
    loginBtn.dataset.originalText = loginBtn.textContent;
    loginBtn.addEventListener("click", handleLogin);
  }

  // Register form handlers
  const registerBtn = document.getElementById("register-btn");
  if (registerBtn) {
    registerBtn.dataset.originalText = registerBtn.textContent;
    registerBtn.addEventListener("click", handleRegister);
  }

  // Toggle between login and register
  const toggleLinks = [
    document.getElementById("toggle-auth-mode-login"),
    document.getElementById("toggle-auth-mode-register")
  ].filter(Boolean);

  toggleLinks.forEach((toggleLink) => {
    toggleLink.addEventListener("click", (e) => {
      e.preventDefault();
      toggleAuthMode();
    });
  });

  // Logout handlers (if buttons exist on this page)
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  // Enter key support for login/register
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const registerEmail = document.getElementById("register-email");
  const registerPassword = document.getElementById("register-password");

  if (loginEmail && loginPassword) {
    [loginEmail, loginPassword].forEach((input) => {
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          handleLogin();
        }
      });
    });
  }

  if (registerEmail && registerPassword) {
    [registerEmail, registerPassword].forEach((input) => {
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          handleRegister();
        }
      });
    });
  }
}

export { initializeAuthController, handleLogout };
