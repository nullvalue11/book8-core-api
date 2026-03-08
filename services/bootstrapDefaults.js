/**
 * Default service and weekly schedule applied when a new tenant is created
 * (tenant.ensure, provision, onboard) so calendar.availability works before
 * real calendar sync is configured.
 */

export const DEFAULT_SERVICE = {
  id: "intro-session-60",
  name: "Intro Session",
  duration: 60,
  price: 0,
  active: true
};

export const DEFAULT_WEEKLY_HOURS = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }]
};

/**
 * @param {string} [timezone] - IANA timezone for the schedule
 * @returns {{ timezone: string, weeklyHours: object }}
 */
export function getDefaultWeeklySchedule(timezone = "America/Toronto") {
  return {
    timezone,
    weeklyHours: { ...DEFAULT_WEEKLY_HOURS }
  };
}

/**
 * Services to use when none are provided on create.
 * @returns {Array<{ id: string, name: string, duration: number, price: number, active: boolean }>}
 */
export function getDefaultServices() {
  return [{ ...DEFAULT_SERVICE }];
}
