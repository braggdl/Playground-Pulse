# Identified Functions

This file lists the functions previously identified from the project for testing and review.

## Authentication helpers
- getPasswordValidationErrors(password)
- validatePasswordStrength(password)
- extractAuthErrorCode(error)
- getFriendlyAuthMessage(error, fallbackMessage)
- canPerformAction(role, action)

## Reporting helpers
- normalizeCrowdLevel(level)
- getReportWindowStart(dateInput)
- getReportWindowKey(dateInput)
- getBusyLevelScoreFromCrowdLevel(level)
- getBusyLevelLabel(score)
- canTransition(currentStatus, targetStatus, role)

## Search helpers
- normalizeParkSearchPageSize(requestedPageSize)

## Database helpers
- sortParksByName(parks)
