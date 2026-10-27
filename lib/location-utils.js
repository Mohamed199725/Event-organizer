import { State, City } from "country-state-city";

/**
 * Parse and validate location slug (format: city-state)
 * @param {string} slug - The URL slug (e.g., "gurugram-haryana" or "delhi")
 * @returns {Object} - { city, state, isValid }
 */
export function parseLocationSlug(slug) {
  if (!slug || typeof slug !== "string") {
    return { city: null, state: null, isValid: false };
  }

  const parts = slug.split("-");

  // Must have at least 1 part (city-only like "delhi")
  if (parts.length < 1) {
    return { city: null, state: null, isValid: false };
  }

  // Parse city (first part)
  const cityName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

  // Parse state (remaining parts joined)
  const stateName = parts.length > 1
    ? parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
    : null;

  return { city: cityName, state: stateName, isValid: true };
}

/**
 * Create location slug from city and state
 * @param {string} city - City name
 * @param {string} state - State name (optional)
 * @returns {string} - URL slug (e.g., "gurugram-haryana" or "delhi")
 */
export function createLocationSlug(city, state) {
  if (!city) return "";

  const citySlug = city.toLowerCase().replace(/\s+/g, "-");
  const stateSlug = state ? state.toLowerCase().replace(/\s+/g, "-") : "";

  return stateSlug ? `${citySlug}-${stateSlug}` : citySlug;
}
