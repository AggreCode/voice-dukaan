/**
 * One spelling per unit, and the arithmetic between units that measure the same thing.
 *
 * GENERATED from backend/app/services/units.py, which is the authority: the server converts again when
 * a bill is saved, so this copy only has to show the shopkeeper the right total before they press Save.
 * To change a unit, edit the Python file and run backend/scripts/gen_units_ts.py.
 *
 * Why it exists: "500 gram" of a product stocked per kilo was billed at the per-kilo price, 500 x ₹120.
 */
const SIZES: Record<string, [string, number]> = {"g": ["mass", 1.0], "kg": ["mass", 1000.0], "quintal": ["mass", 100000.0], "ml": ["volume", 1.0], "litre": ["volume", 1000.0], "piece": ["count", 1.0], "dozen": ["count", 12.0]};
const SYNONYMS: Record<string, string[]> = {"g": ["g", "gm", "gms", "gram", "grams", "gramme", "grammes", "gr", "grm", "grms", "ग्राम", "ଗ୍ରାମ", "ଗ୍ରାମ୍"], "kg": ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kejee", "keji", "kg.", "किलो", "किलोग्राम", "କିଲୋ", "କେଜି", "କିଲୋଗ୍ରାମ"], "quintal": ["quintal", "quintals", "qtl", "qntl", "क्विंटल", "କ୍ୱିଣ୍ଟାଲ"], "ml": ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters", "mili", "एमएल", "ମିଲି"], "litre": ["litre", "litres", "liter", "liters", "l", "ltr", "ltrs", "lt", "lita", "लीटर", "लिटर", "ଲିଟର", "ଲିଟର୍"], "piece": ["piece", "pieces", "pc", "pcs", "nos", "no", "number", "nag", "gota", "gote", "unit", "units", "tablet", "tablets", "goli", "khanda", "पीस", "नग", "ଗୋଟା", "ଗୋଟେ", "ଟା", "ଖଣ୍ଡ"], "dozen": ["dozen", "dozens", "dz", "doz", "darjan", "दर्जन", "ଡଜନ"], "packet": ["packet", "packets", "pkt", "pkts", "pack", "packs", "pouch", "sachet", "pakat", "puda", "pudia", "पैकेट", "ପ୍ୟାକେଟ", "ପ୍ୟାକେଟ୍", "ପ୍ୟାକେଟ"], "strip": ["strip", "strips", "patta", "patti", "pata", "पत्ता", "पत्ती", "स्ट्रिप", "ପତା", "ଷ୍ଟ୍ରିପ"], "bottle": ["bottle", "bottles", "btl", "botal", "sisi", "shishi", "बोतल", "ବୋତଲ", "ବୋତଲ୍"], "box": ["box", "boxes", "dabba", "dibba", "baksa", "डिब्बा", "ଡବା"], "carton": ["carton", "cartons", "peti", "case", "cases", "पेटी", "ପେଟି"], "bag": ["bag", "bags", "bora", "sack", "sacks", "बोरा", "ବସ୍ତା"], "bundle": ["bundle", "bundles", "gathi", "bandal"], "can": ["can", "cans", "tin", "tins"], "jar": ["jar", "jars"], "tube": ["tube", "tubes"], "roll": ["roll", "rolls"]};

const LOOKUP: Record<string, string> = {};
Object.entries(SYNONYMS).forEach(([canon, words]) => words.forEach((w) => (LOOKUP[w] = canon)));

/** The one spelling for a unit word, or the word itself lowercased when it is not in the table. */
export function normalizeUnit(unit: string | null | undefined): string {
  const u = (unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  return LOOKUP[u] ?? u;
}

/** How many `to` one `from` is: 1 g in kg is 0.001. null when they measure different things. */
export function unitFactor(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = normalizeUnit(from);
  const b = normalizeUnit(to);
  if (!a || !b || a === b) return 1;
  const fa = SIZES[a];
  const fb = SIZES[b];
  if (!fa || !fb || fa[0] !== fb[0]) return null;
  return fa[1] / fb[1];
}

/** "0.5" not "0.5000000001": quantities shown after a conversion. */
export function trimQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
