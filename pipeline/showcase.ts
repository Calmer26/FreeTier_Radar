/**
 * Image model showcase: every free image model draws the same three test pictures, so
 * visitors can see quality differences that a price or a rating doesn't show.
 *
 * Each prompt targets a weakness that separates strong models from cheap ones:
 * legible text, hands, and following precise instructions. Images are made once per
 * model (and when a new model appears), never on a schedule, and spread over days
 * under a Neuron budget so the daily tests and the owner's own use keep working.
 *
 * Pure planning here; generation lives in run-showcase.ts.
 */

export interface ShowcasePrompt {
  id: string;
  title: string;
  prompt: string;
  /** What to look at when comparing, shown with the images. */
  look_for: string;
}

export const SHOWCASE_PROMPTS: ShowcasePrompt[] = [
  {
    id: "text",
    title: "Text in the image",
    prompt:
      "A cozy bookshop storefront at dusk. Above the door, a hand-painted wooden sign reads FREE TIER RADAR in large gold letters. Warm light in the windows, wet cobblestone street reflecting the light.",
    look_for: "Is the sign spelled exactly FREE TIER RADAR? Cheaper models often produce garbled or extra letters.",
  },
  {
    id: "hands",
    title: "Hands and realism",
    prompt:
      "Close-up photograph of an elderly woman's hands knitting a red wool scarf with wooden needles, soft natural window light, shallow depth of field.",
    look_for: "Count the fingers and check how the needles are held. Extra, fused or melted fingers are the classic failure.",
  },
  {
    id: "layout",
    title: "Following instructions",
    prompt:
      "Top-down photo of a light wooden table with exactly three red apples on the left, two green pears on the right, and one blue ceramic cup in the middle. Plain background, even lighting.",
    look_for: "Exactly 3 red apples left, 2 green pears right, one blue cup in the middle? Counts, colours and positions often go wrong.",
  },
];

/** Neurons the showcase may spend per day (of the free 10,000), leaving room for tests and other use. */
export const SHOWCASE_DAILY_BUDGET = 3_500;

export interface ShowcaseImage {
  file: string;
  generated_on: string;
  /** Estimated Neurons for this image, from the model's price. */
  neurons: number | null;
  ms: number;
}

export interface ShowcaseFile {
  /** "<resource id>|<prompt id>" → image. */
  images: Record<string, ShowcaseImage>;
}

export const showcaseKey = (resourceId: string, promptId: string) => `${resourceId}|${promptId}`;

export interface PlannedImage {
  resourceId: string;
  promptId: string;
  neurons: number;
}

/**
 * Which images to make today: missing ones, prompt by prompt (so a whole comparison
 * row completes before the next starts), cheapest model first, within the budget.
 * A model whose single image costs more than the budget still gets one, alone, on a
 * day when nothing else was planned; otherwise it would never be shown. Pure.
 */
export function planShowcase(
  models: Array<{ id: string; neurons: number | null }>,
  existing: ShowcaseFile,
  budget = SHOWCASE_DAILY_BUDGET,
): PlannedImage[] {
  const plan: PlannedImage[] = [];
  let spent = 0;
  const byCost = [...models].sort((a, b) => (a.neurons ?? 0) - (b.neurons ?? 0));
  for (const p of SHOWCASE_PROMPTS) {
    for (const m of byCost) {
      if (existing.images[showcaseKey(m.id, p.id)]) continue;
      const cost = m.neurons ?? 0;
      if (spent + cost > budget && !(plan.length === 0 && cost > budget)) continue;
      plan.push({ resourceId: m.id, promptId: p.id, neurons: cost });
      spent += cost;
      if (spent >= budget) return plan;
    }
  }
  return plan;
}
