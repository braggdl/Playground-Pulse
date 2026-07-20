/*
  Review Model
  Purpose: Define the structure for park review and rating records.

  API Contract:
  - createReviewModel(partialReview) → review object
    Input:  partial object with any subset of review fields
    Output: fully-shaped review object with all fields populated to defaults
    Errors: none thrown; invalid rating values fall back to null

  Collection: reviews
  Fields:
    id        (string, required)  — Firestore document ID; empty string on creation
    parkId    (string, required)  — ID of the park being reviewed
    userId    (string, required)  — ID of the user submitting the review
    rating    (number, required)  — integer 1–5; null if not provided or invalid
    body      (string, optional)  — free-text review body; empty string default
    hidden    (boolean, required) — true when moderated/hidden by admin; defaults to false
    createdAt (string, required)  — ISO 8601 timestamp

  Constraints:
  - One review per user per park; enforced at the service layer, not the model
  - Rating must be an integer between 1 and 5 inclusive
  - hidden defaults to false; set to true by Park Admin or Site Admin moderation actions
*/

const MIN_RATING = 1;
const MAX_RATING = 5;

function isValidRating(rating) {
  const parsed = Number(rating);
  return Number.isInteger(parsed) && parsed >= MIN_RATING && parsed <= MAX_RATING;
}

function createReviewModel(partialReview = {}) {
  const now = new Date().toISOString();
  const rating = partialReview.rating !== undefined ? partialReview.rating : null;

  return {
    id: partialReview.id || "",
    parkId: partialReview.parkId || "",
    userId: partialReview.userId || "",
    rating: isValidRating(rating) ? Number(rating) : null,
    body: partialReview.body || "",
    hidden: Boolean(partialReview.hidden),
    createdAt: partialReview.createdAt || now
  };
}

export { MIN_RATING, MAX_RATING, isValidRating, createReviewModel };
