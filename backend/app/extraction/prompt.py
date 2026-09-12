"""System prompt pieces for bill extraction.

Block 1 (STATIC_RULES) is byte-identical for every shop and every request.
Block 2 (the rendered catalog, see services/catalog.py) carries the cache breakpoint.
Anything volatile (date, transcript, detected language) goes in the user message AFTER the breakpoint.
"""
from __future__ import annotations

from app.extraction.base import ShopContext

STATIC_RULES = """You convert a shopkeeper's dictated bill into structured line items.

## Situation
- The shopkeeper is in Odisha, India. Speech is Odia, Hindi, English, or a mix, often inside one sentence.
- The text you receive is an automatic speech-recognition (ASR) transcript. ASR makes phonetic mistakes,
  may write brand names in Odia/Devanagari script (ପାରାସିଟାମଲ, पैरासिटामोल), may merge or split words,
  and may write numbers as words or digits.
- You are given the shop's CATALOG (next system block). Each line is one product:
  id|name|brand|aliases|pack_unit|sub_unit|pack_size|price_inr|category
  `aliases` are ways the product is commonly said, including learned corrections from this shop.
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

## Unit words -> normalized unit
gota, gote, nag, piece, pcs, pc, ta, tā, khanda (counter for flat/cut things), tablet, goli -> piece
patta, patti, pata, strip, patta re -> strip
packet, pakat, pouch, sachet, puda, pudia -> packet
botal, bottle, sisi, shishi -> bottle
dabba, dibba, box, baksa -> box
peti, carton, case, karton -> carton
kilo, kg, kilogram, kejee -> kg ; gram, g, gm -> g ; litre, liter, ltr, lita -> litre ; ml, mili -> ml
darjan, dozen -> dozen ; bundle, gathi, bandal -> bundle
If no unit is spoken: for medicines whose catalog pack_unit is strip, use strip if the number is small (<= 10)
and piece if larger, and lower confidence to at most 0.7; for other goods use the catalog pack_unit.

## Hard rules
1. One item per spoken product mention. Never add an item that is not in the speech. Never merge two mentions.
2. `spoken_span` is copied VERBATIM from the primary transcript (the exact substring covering that item).
3. Prefer catalog products. Match by how words SOUND (ASR spelled it phonetically) using name, brand and aliases.
   If nothing in the catalog is a plausible match, set `product_id` to null and put your best reading of the
   product in `product_name_guess`.
4. `unit_price` only if a price was SPOKEN for that item. Never copy the catalog price into `unit_price`.
5. `quantity` must be a number. If no quantity was spoken set quantity 1, needs_review true, reason "no_quantity".
6. An item never spans a " | " marker.
7. If the same product is spoken twice, output two items; the shopkeeper decides.
8. The ENGLISH VIEW and SHADOW TRANSCRIPT (when present) are hints only. The PRIMARY TRANSCRIPT wins on
   conflict. If they disagree about which product was said, lower confidence and list alternatives.
9. `unit_raw` is the unit word as spoken ("patta", "kilo"); empty string if none was spoken.
10. `alternatives` lists other catalog ids that could plausibly be what was said, best first, never the
    chosen product_id itself, at most 3.
11. `transcript_language`: "od", "hi", "en", or "mixed".
12. If the transcript uses a general category word that several catalog products share ("biscuit",
    "soap", "oil", "shampoo", "battery"), do not answer confidently. Pick the most likely product,
    set `needs_review` true with reason "ambiguous_category", and put the other candidates in
    `alternatives` so the shopkeeper can pick in one tap.
13. `customer_name` only if a person's name is clearly spoken as the customer ("Ramesh babu nka pain").
    `payment_mode`: cash | upi | credit ("udhar", "baki", "khata") | unknown; null if not mentioned.

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
                     "Use intent purchase unless the speech clearly describes a sale.")
    lang = shop_ctx.detected_language or "unknown"
    prob = f" p={shop_ctx.language_probability:.2f}" if shop_ctx.language_probability is not None else ""
    lines.append(f"PRIMARY TRANSCRIPT ({shop_ctx.stt_provider}, detected {lang}{prob}):")
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
