/*
  Park Model
  Purpose: Define the structure for playground/park data records.
  Add validation and transformation helpers for park data here.
*/

const MAINTENANCE_STATUS = {
  GOOD: "good",
  NEEDS_ATTENTION: "needs_attention",
  CLOSED: "closed",
  UNKNOWN: "unknown"
};

const ALLOWED_MAINTENANCE_STATUS = Object.values(MAINTENANCE_STATUS);

function isValidMaintenanceStatus(status) {
  return ALLOWED_MAINTENANCE_STATUS.includes(status);
}

function createParkModel(partialPark = {}) {
  const maintenanceStatus = partialPark.maintenanceStatus || MAINTENANCE_STATUS.UNKNOWN;

  return {
    id: partialPark.id || "",
    name: partialPark.name || "",
    location: partialPark.location || "",
    ageGroups: {
      toddler: Boolean(partialPark.ageGroups?.toddler),
      kid: Boolean(partialPark.ageGroups?.kid),
      teen: Boolean(partialPark.ageGroups?.teen)
    },
    fencedArea: Boolean(partialPark.fencedArea),
    restrooms: Boolean(partialPark.restrooms),
    shadeAvailable: Boolean(partialPark.shadeAvailable),
    maintenanceStatus: isValidMaintenanceStatus(maintenanceStatus)
      ? maintenanceStatus
      : MAINTENANCE_STATUS.UNKNOWN,
    safetyNotes: partialPark.safetyNotes || "",
    amenitiesNotes: partialPark.amenitiesNotes || "",
    createdAt: partialPark.createdAt || new Date().toISOString(),
    updatedAt: partialPark.updatedAt || new Date().toISOString()
  };
}

export {
  MAINTENANCE_STATUS,
  ALLOWED_MAINTENANCE_STATUS,
  isValidMaintenanceStatus,
  createParkModel
};
