import * as prompts from "../prompts/verticalAddenda.js";

const VERTICAL_ADDENDA = {
  barber: prompts.barber,
  barbershop: prompts.barber,

  dental: prompts.dental,
  dentist: prompts.dental,
  orthodontist: prompts.dental,

  spa: prompts.spa,
  beauty_salon: prompts.spa,
  hair_salon: prompts.spa,
  nail_salon: prompts.spa,

  fitness: prompts.fitness,
  gym: prompts.fitness,
  yoga_studio: prompts.fitness,
  pilates_studio: prompts.fitness,

  physio: prompts.physio,
  physiotherapy: prompts.physio,
  chiropractic: prompts.physio,
  chiropractor: prompts.physio,
  massage_therapy: prompts.physio
};

export function getVerticalPromptAddendum(category) {
  const key = (category != null ? String(category) : "").trim().toLowerCase();
  return VERTICAL_ADDENDA[key] || "";
}

