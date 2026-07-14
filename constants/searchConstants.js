/*
  Search Constants
  Purpose: Reserve shared query defaults for Sprint 2 search work.
*/

const PARK_SEARCH_DEFAULTS = {
  pageSize: 20,
  maxPageSize: 50
};

function normalizeParkSearchPageSize(requestedPageSize) {
  const parsedPageSize = Number(requestedPageSize);

  if (!Number.isFinite(parsedPageSize) || parsedPageSize <= 0) {
    return PARK_SEARCH_DEFAULTS.pageSize;
  }

  return Math.min(parsedPageSize, PARK_SEARCH_DEFAULTS.maxPageSize);
}

export { PARK_SEARCH_DEFAULTS, normalizeParkSearchPageSize };