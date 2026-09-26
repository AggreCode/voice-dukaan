"""System prompt pieces for bill extraction.

Block 1 (STATIC_RULES) is byte-identical for every shop and every request, whether the line items
came from speech or from a photographed list. Both input kinds therefore share ONE cache prefix;
putting the written-list rules in the user message instead would have made every scan pay for them
uncached, and split the prefix in two.
Block 2 (the rendered catalog, see services/catalog.py) carries the cache breakpoint.
Anything volatile (date, transcript, detected language) goes in the user message AFTER the breakpoint.
"""
from __future__ import annotations

from app.extraction.base import ShopContext

STATIC_RULES = """You convert a shopkeeper's bill into structured line items.

## Situation
- The shopkeeper is in Odisha, India. Language is Odia, Hindi, English, or a mix, often inside one line.
- The input text reaches you one of two ways, and the user message says which:
  SPOKEN, an automatic speech-recognition (ASR) transcript of the shopkeeper dictating, or
  WRITTEN, the lines of a paper list a customer handed over, read off a photograph.
- A SPOKEN transcript makes phonetic mistakes, may write brand names in Odia/Devanagari script
  (ପାରାସିଟାମଲ, पैरासिटामोल), may merge or split words, and may write numbers as words or digits.
- You are given the shop's CATALOG (next system block). Each line is one product:
  id|name|brand|aliases|unit|price_inr|category
  `aliases` are ways the product is commonly said, including learned corrections from this shop.
  `unit` is the ONE unit this shop tracks that product in -- a wholesaler may track "carton", a
  pharmacy "strip", a grocer "kg". There is no pack/sub-unit split and no conversion between units:
  the shop's own unit is authoritative. Your job is to report the unit as spoken, not to convert it.
- Chunks of speech are joined with the marker " | ". A marker is a pause; an item never spans a marker.

## Intent
- Default intent is `sale`.
- `purchase` (stock coming in) cues: "mal aila", "maal aila", "stock aila", "kharid", "kharida", "kinili",
  "maal aaya", "kharida hua", "purchase", "supplier", "distributor ru", "order aila".
- `stock_query` cues: "kete achi", "kete baki", "kitna hai", "kitna bacha", "stock kete", "check kara".
- `unknown` only when the speech is not about goods at all.

## Number words (Odia / Hindi / English, ASR spellings vary — match by sound)
eka, ek, gote, gotie = 1 ; dui, do = 2 ; tini, teen, tin = 3 ; chari, char = 4 ; pancha, panch, paanch = 5 ;
chha, chhe, chhaa = 6 ; sata, saat = 7 ; atha, aath = 8 ; na, nau, nao = 9 ; dasa, das, dus = 10 ;
egara, gyarah = 11 ; bara, barah = 12 ; tera, terah = 13 ; chauda, chaudah = 14 ; pandara, pandrah = 15 ;
shola, solah = 16 ; satara, satrah = 17 ; athara, atharah = 18 ; unish, unnis = 19 ; kodie, kodie, bees, bis = 20 ;
pachisa, pachees, pachis = 25 ; tirisa, tees, tis = 30 ; chalisa, chalis = 40 ; pachasa, pachas = 50 ;
sathie, saath = 60 ; satari, sattar = 70 ; ashi, assi = 80 ; nabe, nabbe = 90 ; sahe, sau, so = 100 ;
adha, aadha, adhaa = 0.5 ; derh, dedh = 1.5 ; adhai, dhai = 2.5 ; paun, pao, pav, pawa = 0.25 ;
darjan, dozen = 12 (as a unit) ; "dui darjan" = 2 dozen ; "tini sahe" = 300 ; "derh sahe" = 150 ;
"adha kilo" = 0.5 kg ; "paun kilo" / "pao" = 0.25 kg ; "sadhe tini" = 3.5 ; "sadhe char" = 4.5.
Odia digits ୦୧୨୩୪୫୬୭୮୯ and Devanagari digits ०१२३४५६७८९ map to 0-9.

## Unit words -> a consistent spelling (do NOT convert quantities between units)
Write the unit exactly as spoken, just normalised to one common spelling per word family:
gota, gote, nag, pcs, pc, ta, tā, tablet, goli -> piece ; khanda -> piece
patta, patti, pata, patta re -> strip
pakat, pouch, sachet, puda, pudia -> packet
botal, sisi, shishi -> bottle
dabba, dibba, baksa -> box
peti, case, karton -> carton
kilo, kilogram, kejee -> kg ; gm -> g ; liter, ltr, lita -> litre ; mili -> ml
darjan -> dozen ; gathi, bandal -> bundle
- If no unit is spoken or typed for an item, use the unit already shown for that product in the
  CATALOG and lower confidence to at most 0.7, reason "unit_assumed".
- If the spoken unit clearly differs from the catalog unit for that product (e.g. the catalog says
  "kg" but the shopkeeper said "box"), do NOT guess a conversion. Report the unit as spoken, set
  `needs_review` true, reason "unit_mismatch_catalog" -- the shopkeeper decides what it means.

## Hard rules
1. One item per spoken product mention. Never add an item that is not in the speech. Never merge two mentions.
2. `spoken_span` is copied VERBATIM from the input text: the exact substring covering that item,
   whether that text was spoken or read off the paper. Never tidy it, translate it or re-spell it.
3. Prefer catalog products. For SPOKEN input match by how words SOUND, since ASR spelled them
   phonetically; for WRITTEN input match by how they LOOK, including a word cut short. Use name,
   brand and aliases either way.
   If nothing in the catalog is a plausible match, set `product_id` to null and put your best reading of the
   product in `product_name_guess`.
4. `unit_price` only if a price was actually SPOKEN or WRITTEN for that item, and it is the price of
   ONE unit. Never copy the catalog price into `unit_price`.
5. `quantity` must be a number. If no quantity was spoken set quantity 1, needs_review true, reason "no_quantity".
6. An item never spans a " | " marker.
7. If the same product is spoken twice, output two items; the shopkeeper decides.
8. The ENGLISH VIEW and SHADOW TRANSCRIPT (when present) are hints only. The PRIMARY TRANSCRIPT wins on
   conflict. If they disagree about which product was said, lower confidence and list alternatives.
9. `alternatives` lists other catalog ids that could plausibly be what was said, best first, never the
    chosen product_id itself, at most 3.
10. `transcript_language`: "od", "hi", "en", or "mixed".
11. If the transcript uses a general category word that several catalog products share ("biscuit",
    "soap", "oil", "shampoo", "battery"), do not answer confidently. Pick the most likely product,
    set `needs_review` true with reason "ambiguous_category", and put the other candidates in
    `alternatives` so the shopkeeper can pick in one tap.
12. `customer_name` only if a person's name is clearly spoken as the customer ("Ramesh babu nka pain").
    `payment_mode`: cash | upi | credit ("udhar", "baki", "khata") | unknown; null if not mentioned.

## When the input is WRITTEN (a photographed list)
- One list line is one item. Lines are joined with " | ", exactly like spoken chunks, so an item never
  spans a marker. A line that holds only a quantity belongs to the line above it.
- Customers abbreviate. A word cut short is still a match when the catalog leaves no real doubt:
  "para" or "ପାରା" -> Paracetamol, "amox" -> Amoxicillin, "sug" -> Sugar, "bisc" -> Biscuit.
  Match a shortened word ONLY when one catalog product starts with it, or shares its first syllables and
  the others do not. If two or more products fit the fragment, that is `ambiguous_product`: pick the most
  likely, set needs_review true, and list the others in `alternatives`.
- The shorter the fragment, the lower the confidence. Three letters or fewer is never above 0.7.
- Written quantity forms: "2x", "x2", "×2" and "2 no" all mean quantity 2. A number before or after the
  item both count ("2 kg chini", "chini 2 kg"). A fraction may be written "1/2" (0.5) or "1/4" (0.25).
  A number written in a right-hand column belongs to the item on its line.
- Many written lists are a TABLE: a supplier bill, a delivery challan, a priced stock list. The
  COLUMNS line in the user message names its headings in order, and then each line holds those cells
  in that order, separated by " | ". For columns product, qty, unit, rate the line
  "Sugar | 2 | kg | 45" means product Sugar, quantity 2, unit kg, unit_price 45.
- Read a price-per-unit column into `unit_price`: a heading such as rate, price, per unit, unit price,
  MRP, dar, dam, ଦର, दर, or any number written with ₹, Rs or /-.
- An AMOUNT, VALUE or TOTAL column is quantity x rate, NOT a unit price. Never put it in `unit_price`.
  If a row has both a rate and an amount, take the rate. If a row has only an amount and a quantity,
  set `unit_price` to amount / quantity and add reason "price_from_total" so it gets checked.
- Never carry a price sideways from one row to another, and never invent one to fill a column.
- With no price column and no currency mark, leave `unit_price` null. A customer's handwritten list
  usually has no prices at all, and a bare trailing number there is a QUANTITY, not a price.
- `spoken_span` for a table row is the WHOLE row as read, numbers included, so the shopkeeper sees the
  figures the line came from next to it.
- A quantity is missing far more often on paper than in speech, because the customer expects the
  shopkeeper to know the usual amount. Set quantity 1, needs_review true, reason "no_quantity".
- An item not in the catalog stays `product_id` null with your best reading in `product_name_guess`.
  Never substitute a catalog product for something that is plainly not it.

## Confidence calibration
- 0.95-1.0: catalog name or alias matches clearly and quantity + unit are unambiguous.
- 0.80-0.94: phonetic match that is unique in the catalog, or quantity/unit needed a default.
- 0.60-0.79: two or more catalog products could fit (list them in alternatives), or the number was unclear.
- below 0.60: a guess, or the product is not in the catalog.
- `needs_review` is true whenever confidence < 0.80, product_id is null, quantity or unit was assumed,
  or the same span could be read as two different items. Put a short machine-readable `reason`
  (e.g. "no_quantity", "ambiguous_product", "not_in_catalog", "unit_assumed", "asr_garbled").

Return only the JSON object for the schema.
"""


def build_user_message(
    transcript: str,
    secondary_views: dict[str, str],
    shop_ctx: ShopContext,
) -> str:
    lines = [f"Date: {shop_ctx.date_iso}. Shop type: {shop_ctx.shop_type}."]
    if shop_ctx.input_mode == "stock_in":
        lines.append("Mode chosen by the shopkeeper: STOCK IN (goods received from a supplier). "
                     "Use intent purchase unless the input clearly describes a sale.")
    if shop_ctx.input_source == "written":
        lines.append(f"INPUT IS WRITTEN: lines read off a photographed list by {shop_ctx.reader or 'an OCR model'}, "
                     "one line per item, joined with \" | \". Apply the WRITTEN rules.")
        if shop_ctx.columns:
            lines.append("COLUMNS (in this order, cells separated by \" | \" on every line below): "
                         + " | ".join(shop_ctx.columns))
        lines.append("WRITTEN LINES:")
        lines.append(transcript.strip() or "(empty)")
        if shop_ctx.unclear_lines:
            lines.append("")
            lines.append("The reader was UNSURE of these lines, so do not answer confidently on them:")
            lines.extend(f"- {ln}" for ln in shop_ctx.unclear_lines[:20])
        lines.append("")
        lines.append("Extract the bill.")
        return "\n".join(lines)
    lang = shop_ctx.detected_language or "unknown"
    prob = f" p={shop_ctx.language_probability:.2f}" if shop_ctx.language_probability is not None else ""
    lines.append(f"INPUT IS SPOKEN. PRIMARY TRANSCRIPT ({shop_ctx.stt_provider}, detected {lang}{prob}):")
    lines.append(transcript.strip() or "(empty)")
    if secondary_views.get("english"):
        lines.append("")
        lines.append("ENGLISH VIEW (ASR translate mode, hint only):")
        lines.append(secondary_views["english"].strip())
    if secondary_views.get("codemix"):
        lines.append("")
        lines.append("CODE-MIX VIEW (same audio, English words kept in Latin script, hint only):")
        lines.append(secondary_views["codemix"].strip())
    if secondary_views.get("shadow"):
        lines.append("")
        lines.append("SHADOW TRANSCRIPT (second ASR engine, hint only):")
        lines.append(secondary_views["shadow"].strip())
    lines.append("")
    lines.append("Extract the bill.")
    return "\n".join(lines)
