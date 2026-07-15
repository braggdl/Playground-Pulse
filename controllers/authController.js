/*
  Auth Controller
  Purpose: Connect login/register/logout UI actions to the authentication service.
  Add DOM event listeners and form handling logic here.
*/

import { PASSWORD_POLICY, validatePasswordStrength } from "../constants/authConstants.js";
import { 
  login, 
  logout, 
  registerUser, 
  resetPassword,
  updateAuthDisplayName,
  updateUserPassword
} from "../services/authService.js";
import { createUserRecord, updateRecord } from "../services/databaseService.js";
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
// Forgot Password Helper Functions (Task 2)
// ============================================================

function showForgotPasswordMessage(message, isError = false) {
  const messageContainer = document.getElementById("forgot-password-message");
  if (messageContainer) {
    messageContainer.textContent = message;
    messageContainer.style.display = "block";
    messageContainer.className = isError ? "error-message show" : "success-message";
  }
}

function clearForgotPasswordMessage() {
  const messageContainer = document.getElementById("forgot-password-message");
  if (messageContainer) {
    messageContainer.textContent = "";
    messageContainer.style.display = "none";
  }
}

function showForgotPasswordModal() {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const modal = document.getElementById("forgot-password-modal");
  
  if (loginForm) loginForm.style.display = "none";
  if (registerForm) registerForm.style.display = "none";
  if (modal) {
    modal.style.display = "flex";
    setTimeout(() => {
      const emailInput = document.getElementById("forgot-email");
      if (emailInput) emailInput.focus();
    }, 0);
  }
  clearForgotPasswordMessage();
}

function hideForgotPasswordModal() {
  const loginForm = document.getElementById("login-form");
  const modal = document.getElementById("forgot-password-modal");
  
  if (modal) modal.style.display = "none";
  if (loginForm) loginForm.style.display = "block";
  
  const emailInput = document.getElementById("forgot-email");
  if (emailInput) emailInput.value = "";
  clearForgotPasswordMessage();
}

// ============================================================
// Profile Helper Functions (Task 3)
// ============================================================

function showProfileMessage(containerId, message, isError = false) {
  const messageContainer = document.getElementById(containerId);
  if (messageContainer) {
    messageContainer.textContent = message;
    messageContainer.style.display = "block";
    messageContainer.className = isError ? "profile-error-message" : "profile-success-message";
  }
}

function clearProfileMessage(containerId) {
  const messageContainer = document.getElementById(containerId);
  if (messageContainer) {
    messageContainer.textContent = "";
    messageContainer.style.display = "none";
  }
}

function validateDisplayName(name) {
  const trimmedName = (name || "").trim();
  
  if (!trimmedName) {
    return { isValid: false, error: "Display name is required" };
  }
  
  if (trimmedName.length < 2) {
    return { isValid: false, error: "Display name must be at least 2 characters" };
  }
  
  return { isValid: true, error: null };
}

function validatePasswordForChange(currentPassword, newPassword, confirmPassword) {
  const errors = [];
  
  if (!currentPassword) {
    errors.push("Current password is required");
  }
  
  const newPasswordValidation = validatePasswordStrength(newPassword);
  if (!newPasswordValidation.isValid) {
    errors.push(...newPasswordValidation.errors);
  }
  
  if (newPassword && currentPassword && newPassword === currentPassword) {
    errors.push("New password cannot be the same as current password");
  }
  
  if (newPassword !== confirmPassword) {
    errors.push("Passwords do not match");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function displayPasswordPolicyFeedback(password) {
  const feedbackContainer = document.getElementById("password-policy-feedback");
  if (!feedbackContainer) return;
  
  const validation = validatePasswordStrength(password);
  const requirements = [
    { text: "At least 8 characters", met: password.length >= 8 },
    { text: "At least 1 uppercase letter", met: /[A-Z]/.test(password) },
    { text: "At least 1 lowercase letter", met: /[a-z]/.test(password) },
    { text: "At least 1 number", met: /[0-9]/.test(password) }
  ];
  
  const html = requirements.map(req => `
    <div class="policy-requirement ${req.met ? "met" : "unmet"}">
      <span>${req.met ? "✓" : "✗"}</span> ${req.text}
    </div>
  `).join("");
  
  feedbackContainer.innerHTML = html;
}

function openEditDisplayNameForm() {
  const form = document.getElementById("edit-display-name-form");
  const input = document.getElementById("new-display-name");
  const displayNameText = document.getElementById("profile-display-name");
  
  if (form && input && displayNameText) {
    input.value = displayNameText.textContent;
    form.style.display = "block";
    input.focus();
    clearProfileMessage("profile-display-name-message");
  }
}

function closeEditDisplayNameForm() {
  const form = document.getElementById("edit-display-name-form");
  const input = document.getElementById("new-display-name");
  
  if (form) form.style.display = "none";
  if (input) input.value = "";
  clearProfileMessage("profile-display-name-message");
}

function openChangePasswordForm() {
  const form = document.getElementById("change-password-form");
  const currentPwdInput = document.getElementById("current-password");
  
  if (form) form.style.display = "block";
  if (currentPwdInput) {
    currentPwdInput.focus();
  }
  clearProfileMessage("profile-password-change-message");
  document.getElementById("password-policy-feedback").innerHTML = "";
}

function closeChangePasswordForm() {
  const form = document.getElementById("change-password-form");
  const currentPwdInput = document.getElementById("current-password");
  const newPwdInput = document.getElementById("new-password");
  const confirmPwdInput = document.getElementById("confirm-new-password");
  
  if (form) form.style.display = "none";
  if (currentPwdInput) currentPwdInput.value = "";
  if (newPwdInput) newPwdInput.value = "";
  if (confirmPwdInput) confirmPwdInput.value = "";
  clearProfileMessage("profile-password-change-message");
  document.getElementById("password-policy-feedback").innerHTML = "";
}

// ============================================================
// Validation Functions
// ============================================================

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  return validatePasswordStrength(password).isValid;
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
    showError(validatePasswordStrength(password).errors[0]);
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
    const firebaseUser = await registerUser(email, password, { displayName });

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

    if (error.message.includes("Create user record failed")) {
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
// Forgot Password Handler (Task 2)
// ============================================================

async function handleForgotPassword() {
  const emailInput = document.getElementById("forgot-email");
  if (!emailInput) return;
  
  const email = emailInput.value.trim();
  
  if (!email) {
    showProfileMessage("forgot-password-message", "Email is required", true);
    return;
  }
  
  if (!validateEmail(email)) {
    showProfileMessage("forgot-password-message", "Please enter a valid email address", true);
    return;
  }
  
  setButtonLoading("send-reset-btn", true);
  
  try {
    await resetPassword(email);
    showProfileMessage("forgot-password-message", "If an account exists for this email, a reset link has been sent.", false);
    emailInput.value = "";
    setTimeout(() => {
      hideForgotPasswordModal();
    }, 2000);
  } catch (error) {
    setButtonLoading("send-reset-btn", false);
    showProfileMessage("forgot-password-message", error.message || "Unable to send password reset email.", true);
  }
}

// ============================================================
// Display Name Update Handler (Task 3)
// ============================================================

async function handleUpdateDisplayName() {
  const input = document.getElementById("new-display-name");
  if (!input) return;
  
  const newDisplayName = input.value.trim();
  const validation = validateDisplayName(newDisplayName);
  
  if (!validation.isValid) {
    showProfileMessage("profile-display-name-message", validation.error, true);
    return;
  }
  
  setButtonLoading("save-display-name-btn", true);
  
  try {
    // Update in Firebase Auth
    await updateAuthDisplayName(newDisplayName);
    
    // Update in Firestore user record
    const currentUser = window.appState?.currentUser;
    if (currentUser?.uid) {
      await updateRecord("users", currentUser.uid, { 
        displayName: newDisplayName,
        updatedAt: new Date().toISOString()
      });
    }
    
    // Update in DOM and appState
    const displayNameText = document.getElementById("profile-display-name");
    if (displayNameText) displayNameText.textContent = newDisplayName;
    if (window.appState?.currentUser) {
      window.appState.currentUser.displayName = newDisplayName;
    }
    
    showProfileMessage("profile-display-name-message", "Display name updated successfully.", false);
    setTimeout(() => {
      closeEditDisplayNameForm();
    }, 1500);
  } catch (error) {
    setButtonLoading("save-display-name-btn", false);
    showProfileMessage("profile-display-name-message", error.message || "Failed to update display name.", true);
  }
}

// ============================================================
// Password Change Handler (Task 3)
// ============================================================

async function handleChangePassword() {
  const currentPwdInput = document.getElementById("current-password");
  const newPwdInput = document.getElementById("new-password");
  const confirmPwdInput = document.getElementById("confirm-new-password");
  
  if (!currentPwdInput || !newPwdInput || !confirmPwdInput) return;
  
  const currentPassword = currentPwdInput.value.trim();
  const newPassword = newPwdInput.value.trim();
  const confirmPassword = confirmPwdInput.value.trim();
  
  const validation = validatePasswordForChange(currentPassword, newPassword, confirmPassword);
  
  if (!validation.isValid) {
    const errorMessage = validation.errors.join("; ");
    showProfileMessage("profile-password-change-message", errorMessage, true);
    return;
  }
  
  setButtonLoading("update-password-btn", true);
  
  try {
    await updateUserPassword(currentPassword, newPassword);
    
    showProfileMessage("profile-password-change-message", "Password updated successfully.", false);
    setTimeout(() => {
      closeChangePasswordForm();
    }, 1500);
  } catch (error) {
    setButtonLoading("update-password-btn", false);
    
    let friendlyMessage = error.message;
    if (error.message.includes("auth/wrong-password")) {
      friendlyMessage = "Current password is incorrect.";
    } else if (error.message.includes("auth/requires-recent-login")) {
      friendlyMessage = "Session expired. Please log in again.";
    }
    
    showProfileMessage("profile-password-change-message", friendlyMessage, true);
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

  // Forgot password handlers (Task 2)
  const forgotPasswordLink = document.getElementById("forgot-password-link");
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", (e) => {
      e.preventDefault();
      showForgotPasswordModal();
    });
  }

  const backToLoginLink = document.getElementById("back-to-login-link");
  if (backToLoginLink) {
    backToLoginLink.addEventListener("click", (e) => {
      e.preventDefault();
      hideForgotPasswordModal();
    });
  }

  const closeForgotModalBtn = document.getElementById("close-forgot-modal-btn");
  if (closeForgotModalBtn) {
    closeForgotModalBtn.addEventListener("click", hideForgotPasswordModal);
  }

  const sendResetBtn = document.getElementById("send-reset-btn");
  if (sendResetBtn) {
    sendResetBtn.dataset.originalText = sendResetBtn.textContent;
    sendResetBtn.addEventListener("click", handleForgotPassword);
  }

  const forgotEmail = document.getElementById("forgot-email");
  if (forgotEmail) {
    forgotEmail.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleForgotPassword();
      }
    });
  }

  // Display name edit handlers (Task 3)
  const editDisplayNameBtn = document.getElementById("edit-display-name-btn");
  if (editDisplayNameBtn) {
    editDisplayNameBtn.addEventListener("click", openEditDisplayNameForm);
  }

  const saveDisplayNameBtn = document.getElementById("save-display-name-btn");
  if (saveDisplayNameBtn) {
    saveDisplayNameBtn.addEventListener("click", handleUpdateDisplayName);
  }

  const cancelDisplayNameBtn = document.getElementById("cancel-display-name-btn");
  if (cancelDisplayNameBtn) {
    cancelDisplayNameBtn.addEventListener("click", closeEditDisplayNameForm);
  }

  // Password change handlers (Task 3)
  const changePasswordBtn = document.getElementById("change-password-btn");
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener("click", openChangePasswordForm);
  }

  const updatePasswordBtn = document.getElementById("update-password-btn");
  if (updatePasswordBtn) {
    updatePasswordBtn.dataset.originalText = updatePasswordBtn.textContent;
    updatePasswordBtn.addEventListener("click", handleChangePassword);
  }

  const cancelPasswordBtn = document.getElementById("cancel-password-btn");
  if (cancelPasswordBtn) {
    cancelPasswordBtn.addEventListener("click", closeChangePasswordForm);
  }

  const newPasswordInput = document.getElementById("new-password");
  if (newPasswordInput) {
    newPasswordInput.addEventListener("input", (e) => {
      displayPasswordPolicyFeedback(e.target.value);
    });
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

export { 
  initializeAuthController, 
  handleLogout,
  handleUpdateDisplayName,
  handleChangePassword
};
