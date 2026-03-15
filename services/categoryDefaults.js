/**
 * Category-aware default services for new businesses.
 * When a business signs up, they get services relevant to their industry.
 * Businesses can always customize these later via the dashboard.
 */

export const CATEGORY_DEFAULTS = {
  // ── Health & Medical ──────────────────────────────────
  dental: {
    categoryName: "Dental Clinic",
    services: [
      { serviceId: "dental-cleaning-60", name: "Dental Cleaning", durationMinutes: 60 },
      { serviceId: "dental-consultation-30", name: "Consultation", durationMinutes: 30 },
      { serviceId: "dental-checkup-45", name: "Check-up & Exam", durationMinutes: 45 }
    ]
  },
  clinic: {
    categoryName: "Medical Clinic",
    services: [
      { serviceId: "consultation-30", name: "Consultation", durationMinutes: 30 },
      { serviceId: "follow-up-15", name: "Follow-up Appointment", durationMinutes: 15 },
      { serviceId: "physical-exam-45", name: "Physical Exam", durationMinutes: 45 }
    ]
  },
  therapy: {
    categoryName: "Therapy / Counseling",
    services: [
      { serviceId: "therapy-session-50", name: "Therapy Session", durationMinutes: 50 },
      { serviceId: "intake-session-60", name: "Initial Intake Session", durationMinutes: 60 },
      { serviceId: "couples-session-60", name: "Couples Session", durationMinutes: 60 }
    ]
  },
  physiotherapy: {
    categoryName: "Physiotherapy",
    services: [
      { serviceId: "physio-assessment-45", name: "Initial Assessment", durationMinutes: 45 },
      { serviceId: "physio-treatment-30", name: "Treatment Session", durationMinutes: 30 },
      { serviceId: "physio-follow-up-30", name: "Follow-up Session", durationMinutes: 30 }
    ]
  },
  chiropractic: {
    categoryName: "Chiropractic",
    services: [
      { serviceId: "chiro-adjustment-30", name: "Adjustment", durationMinutes: 30 },
      { serviceId: "chiro-consultation-45", name: "Initial Consultation", durationMinutes: 45 }
    ]
  },
  optometry: {
    categoryName: "Optometry",
    services: [
      { serviceId: "eye-exam-30", name: "Eye Exam", durationMinutes: 30 },
      { serviceId: "contact-fitting-30", name: "Contact Lens Fitting", durationMinutes: 30 }
    ]
  },
  veterinary: {
    categoryName: "Veterinary Clinic",
    services: [
      { serviceId: "vet-checkup-30", name: "Pet Check-up", durationMinutes: 30 },
      { serviceId: "vet-vaccination-20", name: "Vaccination", durationMinutes: 20 },
      { serviceId: "vet-consultation-30", name: "Consultation", durationMinutes: 30 }
    ]
  },
  medspa: {
    categoryName: "Med Spa",
    services: [
      { serviceId: "botox-30", name: "Botox Treatment", durationMinutes: 30 },
      { serviceId: "facial-60", name: "Facial Treatment", durationMinutes: 60 },
      { serviceId: "medspa-consultation-30", name: "Consultation", durationMinutes: 30 }
    ]
  },

  // ── Beauty & Personal Care ────────────────────────────
  salon: {
    categoryName: "Hair Salon",
    services: [
      { serviceId: "haircut-45", name: "Haircut", durationMinutes: 45 },
      { serviceId: "color-treatment-120", name: "Color Treatment", durationMinutes: 120 },
      { serviceId: "blowout-30", name: "Blowout", durationMinutes: 30 }
    ]
  },
  barber: {
    categoryName: "Barber Shop",
    services: [
      { serviceId: "mens-haircut-30", name: "Men's Haircut", durationMinutes: 30 },
      { serviceId: "fade-beard-45", name: "Fade + Beard Trim", durationMinutes: 45 },
      { serviceId: "hot-towel-shave-30", name: "Hot Towel Shave", durationMinutes: 30 }
    ]
  },
  nails: {
    categoryName: "Nail Salon",
    services: [
      { serviceId: "manicure-30", name: "Manicure", durationMinutes: 30 },
      { serviceId: "pedicure-45", name: "Pedicure", durationMinutes: 45 },
      { serviceId: "gel-nails-60", name: "Gel Nails", durationMinutes: 60 }
    ]
  },
  lash_brow: {
    categoryName: "Lash & Brow Studio",
    services: [
      { serviceId: "lash-extensions-90", name: "Lash Extensions", durationMinutes: 90 },
      { serviceId: "lash-fill-60", name: "Lash Fill", durationMinutes: 60 },
      { serviceId: "brow-shaping-30", name: "Brow Shaping", durationMinutes: 30 }
    ]
  },
  tattoo: {
    categoryName: "Tattoo Studio",
    services: [
      { serviceId: "tattoo-consultation-30", name: "Consultation", durationMinutes: 30 },
      { serviceId: "tattoo-session-120", name: "Tattoo Session", durationMinutes: 120 },
      { serviceId: "touch-up-60", name: "Touch-up", durationMinutes: 60 }
    ]
  },
  spa: {
    categoryName: "Spa",
    services: [
      { serviceId: "massage-60", name: "Massage", durationMinutes: 60 },
      { serviceId: "facial-60", name: "Facial", durationMinutes: 60 },
      { serviceId: "body-treatment-90", name: "Body Treatment", durationMinutes: 90 }
    ]
  },

  // ── Fitness & Sports ──────────────────────────────────
  fitness: {
    categoryName: "Fitness / Personal Training",
    services: [
      { serviceId: "personal-training-60", name: "Personal Training Session", durationMinutes: 60 },
      { serviceId: "intro-session-30", name: "Intro Session", durationMinutes: 30 },
      { serviceId: "group-class-45", name: "Group Class", durationMinutes: 45 }
    ]
  },
  yoga: {
    categoryName: "Yoga Studio",
    services: [
      { serviceId: "yoga-class-60", name: "Yoga Class", durationMinutes: 60 },
      { serviceId: "private-yoga-60", name: "Private Yoga Session", durationMinutes: 60 },
      { serviceId: "intro-yoga-30", name: "Intro to Yoga", durationMinutes: 30 }
    ]
  },
  martial_arts: {
    categoryName: "Martial Arts",
    services: [
      { serviceId: "trial-class-60", name: "Trial Class", durationMinutes: 60 },
      { serviceId: "private-lesson-60", name: "Private Lesson", durationMinutes: 60 },
      { serviceId: "group-class-60", name: "Group Class", durationMinutes: 60 }
    ]
  },
  dance: {
    categoryName: "Dance Studio",
    services: [
      { serviceId: "dance-class-60", name: "Dance Class", durationMinutes: 60 },
      { serviceId: "private-dance-45", name: "Private Lesson", durationMinutes: 45 },
      { serviceId: "trial-class-30", name: "Trial Class", durationMinutes: 30 }
    ]
  },

  // ── Automotive ────────────────────────────────────────
  car_wash: {
    categoryName: "Car Wash / Detailing",
    services: [
      { serviceId: "exterior-wash-30", name: "Exterior Wash", durationMinutes: 30 },
      { serviceId: "full-detail-120", name: "Full Detail", durationMinutes: 120 },
      { serviceId: "interior-clean-60", name: "Interior Cleaning", durationMinutes: 60 }
    ]
  },
  auto_repair: {
    categoryName: "Auto Repair",
    services: [
      { serviceId: "diagnostic-30", name: "Diagnostic Check", durationMinutes: 30 },
      { serviceId: "oil-change-30", name: "Oil Change", durationMinutes: 30 },
      { serviceId: "repair-estimate-30", name: "Repair Estimate", durationMinutes: 30 }
    ]
  },
  auto_body: {
    categoryName: "Auto Body Shop",
    services: [
      { serviceId: "body-estimate-30", name: "Damage Estimate", durationMinutes: 30 },
      { serviceId: "paint-consultation-30", name: "Paint Consultation", durationMinutes: 30 }
    ]
  },

  // ── Home Services ─────────────────────────────────────
  home_services: {
    categoryName: "Home Services",
    services: [
      { serviceId: "service-call-60", name: "Service Call", durationMinutes: 60 },
      { serviceId: "estimate-30", name: "Free Estimate", durationMinutes: 30 },
      { serviceId: "consultation-30", name: "Consultation", durationMinutes: 30 }
    ]
  },
  plumbing: {
    categoryName: "Plumbing",
    services: [
      { serviceId: "plumbing-call-60", name: "Service Call", durationMinutes: 60 },
      { serviceId: "plumbing-estimate-30", name: "Free Estimate", durationMinutes: 30 },
      { serviceId: "drain-cleaning-45", name: "Drain Cleaning", durationMinutes: 45 }
    ]
  },
  hvac: {
    categoryName: "HVAC",
    services: [
      { serviceId: "hvac-service-60", name: "Service Call", durationMinutes: 60 },
      { serviceId: "hvac-maintenance-60", name: "Maintenance Check", durationMinutes: 60 },
      { serviceId: "hvac-estimate-30", name: "Free Estimate", durationMinutes: 30 }
    ]
  },
  electrician: {
    categoryName: "Electrician",
    services: [
      { serviceId: "electrical-call-60", name: "Service Call", durationMinutes: 60 },
      { serviceId: "electrical-estimate-30", name: "Free Estimate", durationMinutes: 30 }
    ]
  },
  cleaning: {
    categoryName: "Cleaning Service",
    services: [
      { serviceId: "standard-clean-120", name: "Standard Cleaning", durationMinutes: 120 },
      { serviceId: "deep-clean-180", name: "Deep Cleaning", durationMinutes: 180 },
      { serviceId: "estimate-30", name: "Free Estimate", durationMinutes: 30 }
    ]
  },
  landscaping: {
    categoryName: "Landscaping",
    services: [
      { serviceId: "lawn-care-60", name: "Lawn Care", durationMinutes: 60 },
      { serviceId: "landscape-consultation-30", name: "Design Consultation", durationMinutes: 30 },
      { serviceId: "landscape-estimate-30", name: "Free Estimate", durationMinutes: 30 }
    ]
  },

  // ── Professional Services ─────────────────────────────
  legal: {
    categoryName: "Law Firm / Legal",
    services: [
      { serviceId: "legal-consultation-30", name: "Legal Consultation", durationMinutes: 30 },
      { serviceId: "case-review-60", name: "Case Review", durationMinutes: 60 },
      { serviceId: "follow-up-30", name: "Follow-up Meeting", durationMinutes: 30 }
    ]
  },
  accounting: {
    categoryName: "Accounting / Tax",
    services: [
      { serviceId: "tax-consultation-30", name: "Tax Consultation", durationMinutes: 30 },
      { serviceId: "tax-prep-60", name: "Tax Preparation", durationMinutes: 60 },
      { serviceId: "financial-review-45", name: "Financial Review", durationMinutes: 45 }
    ]
  },
  consulting: {
    categoryName: "Consulting",
    services: [
      { serviceId: "discovery-call-30", name: "Discovery Call", durationMinutes: 30 },
      { serviceId: "strategy-session-60", name: "Strategy Session", durationMinutes: 60 },
      { serviceId: "follow-up-30", name: "Follow-up", durationMinutes: 30 }
    ]
  },
  coaching: {
    categoryName: "Coaching",
    services: [
      { serviceId: "coaching-session-60", name: "Coaching Session", durationMinutes: 60 },
      { serviceId: "intro-call-30", name: "Intro Call", durationMinutes: 30 },
      { serviceId: "group-session-90", name: "Group Session", durationMinutes: 90 }
    ]
  },
  real_estate: {
    categoryName: "Real Estate",
    services: [
      { serviceId: "property-viewing-30", name: "Property Viewing", durationMinutes: 30 },
      { serviceId: "buyer-consultation-60", name: "Buyer Consultation", durationMinutes: 60 },
      { serviceId: "listing-consultation-60", name: "Listing Consultation", durationMinutes: 60 }
    ]
  },
  insurance: {
    categoryName: "Insurance",
    services: [
      { serviceId: "policy-review-30", name: "Policy Review", durationMinutes: 30 },
      { serviceId: "quote-consultation-30", name: "Quote Consultation", durationMinutes: 30 }
    ]
  },

  // ── Education & Tutoring ──────────────────────────────
  tutoring: {
    categoryName: "Tutoring",
    services: [
      { serviceId: "tutoring-session-60", name: "Tutoring Session", durationMinutes: 60 },
      { serviceId: "assessment-30", name: "Assessment", durationMinutes: 30 },
      { serviceId: "trial-session-30", name: "Trial Session", durationMinutes: 30 }
    ]
  },
  music_school: {
    categoryName: "Music School",
    services: [
      { serviceId: "music-lesson-30", name: "Music Lesson", durationMinutes: 30 },
      { serviceId: "trial-lesson-30", name: "Trial Lesson", durationMinutes: 30 },
      { serviceId: "group-lesson-45", name: "Group Lesson", durationMinutes: 45 }
    ]
  },
  driving_school: {
    categoryName: "Driving School",
    services: [
      { serviceId: "driving-lesson-60", name: "Driving Lesson", durationMinutes: 60 },
      { serviceId: "road-test-prep-90", name: "Road Test Prep", durationMinutes: 90 }
    ]
  },

  // ── Pet Services ──────────────────────────────────────
  pet_grooming: {
    categoryName: "Pet Grooming",
    services: [
      { serviceId: "dog-grooming-60", name: "Dog Grooming", durationMinutes: 60 },
      { serviceId: "cat-grooming-45", name: "Cat Grooming", durationMinutes: 45 },
      { serviceId: "nail-trim-15", name: "Nail Trim", durationMinutes: 15 }
    ]
  },

  // ── Photography & Creative ────────────────────────────
  photography: {
    categoryName: "Photography Studio",
    services: [
      { serviceId: "portrait-session-60", name: "Portrait Session", durationMinutes: 60 },
      { serviceId: "headshot-session-30", name: "Headshot Session", durationMinutes: 30 },
      { serviceId: "event-consultation-30", name: "Event Consultation", durationMinutes: 30 }
    ]
  },

  // ── Fallback ──────────────────────────────────────────
  other: {
    categoryName: "General Business",
    services: [
      { serviceId: "consultation-30", name: "Consultation", durationMinutes: 30 },
      { serviceId: "appointment-60", name: "Appointment", durationMinutes: 60 }
    ]
  }
};

/**
 * Get default services for a business category.
 * Falls back to "other" if category is unknown.
 * @param {string} category
 * @returns {{ categoryName: string, services: Array<{ serviceId: string, name: string, durationMinutes: number }> }}
 */
export function getDefaultsForCategory(category) {
  if (!category || typeof category !== "string") {
    return CATEGORY_DEFAULTS.other;
  }
  const key = category.toLowerCase().trim();
  return CATEGORY_DEFAULTS[key] || CATEGORY_DEFAULTS.other;
}

/**
 * Get all supported category keys.
 * Useful for the signup form category dropdown.
 * @returns {Array<{ key: string, name: string }>}
 */
export function listCategories() {
  return Object.entries(CATEGORY_DEFAULTS).map(([key, val]) => ({
    key,
    name: val.categoryName
  }));
}
