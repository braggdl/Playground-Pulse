/**
 * First-paint auth hint.
 *
 * Loaded synchronously from <head> (no defer/module) so it runs BEFORE the browser
 * paints the header. Firebase restores sessions asynchronously, so without this the
 * auth button can only be labelled after first paint, which is what produced the
 * visible Login -> Logout flash.
 *
 * This reads the cached outcome of the previous auth resolution and stamps it onto
 * <html> as data attributes. CSS then selects the correct label immediately, with
 * no JavaScript involved in the initial render.
 *
 * SECURITY: this is a rendering hint only. It lives in localStorage and is trivially
 * client-writable, so it must never gate access to anything. Real enforcement stays
 * in firestore.rules and the route guards, both of which validate the signed token.
 * The worst a forged value can do is briefly show a nav link that stops working the
 * moment the genuine auth state resolves a few milliseconds later.
 */
(function applyAuthPaintHint() {
  var root = document.documentElement;

  // Default to the signed-out presentation so a first-time visitor with no cached
  // hint still gets a definite, correct paint rather than a blank button.
  var signedIn = false;
  var isAdmin = false;

  try {
    var raw = window.localStorage.getItem("pp.authHint");

    if (raw) {
      var hint = JSON.parse(raw);
      signedIn = hint.signedIn === true;
      isAdmin = hint.isAdmin === true;
    }
  } catch (error) {
    // Corrupt JSON, disabled storage, or private browsing. Fall through to the
    // signed-out default; the real state is applied once auth resolves.
  }

  root.setAttribute("data-auth-hint", signedIn ? "in" : "out");
  root.setAttribute("data-admin-hint", isAdmin ? "yes" : "no");
})();
