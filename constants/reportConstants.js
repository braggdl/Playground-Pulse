/*
  Reporting Constants
  Purpose: Define shared contracts for crowd-report throttling and busy-level display.
*/

const CROWD_REPORT_POLICY = {
  collectionName: "crowdReports",
  windowMinutes: 60,
  reportsPerWindow: 1,
  validCrowdLevels: [1, 2, 3, 4]
};

const BUSY_LEVEL_LABELS = {
  UNKNOWN: "Unknown",
  LOW: "Low",
  MODERATE: "Moderate",
  BUSY: "Busy",
  VERY_BUSY: "Very Busy"
};

const BUSY_LEVEL_THRESHOLDS = {
  LOW_MAX: 24,
  MODERATE_MAX: 49,
  BUSY_MAX: 74
};

function normalizeCrowdLevel(level) {
  const parsedLevel = Number(level);

  if (!Number.isFinite(parsedLevel)) {
    return null;
  }

  if (!CROWD_REPORT_POLICY.validCrowdLevels.includes(parsedLevel)) {
    return null;
  }

  return parsedLevel;
}

function getReportWindowStart(dateInput = new Date()) {
  const date = new Date(dateInput);
  date.setMinutes(0, 0, 0);
  return date;
}

function getReportWindowKey(dateInput = new Date()) {
  return getReportWindowStart(dateInput).toISOString();
}

function getBusyLevelScoreFromCrowdLevel(level) {
  const normalizedLevel = normalizeCrowdLevel(level);

  if (normalizedLevel === null) {
    return null;
  }

  return normalizedLevel * 25;
}

function getBusyLevelLabel(score) {
  if (!Number.isFinite(score)) {
    return BUSY_LEVEL_LABELS.UNKNOWN;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.LOW_MAX) {
    return BUSY_LEVEL_LABELS.LOW;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.MODERATE_MAX) {
    return BUSY_LEVEL_LABELS.MODERATE;
  }

  if (score <= BUSY_LEVEL_THRESHOLDS.BUSY_MAX) {
    return BUSY_LEVEL_LABELS.BUSY;
  }

  return BUSY_LEVEL_LABELS.VERY_BUSY;
}

export {
  CROWD_REPORT_POLICY,
  BUSY_LEVEL_LABELS,
  BUSY_LEVEL_THRESHOLDS,
  normalizeCrowdLevel,
  getReportWindowStart,
  getReportWindowKey,
  getBusyLevelScoreFromCrowdLevel,
  getBusyLevelLabel
};