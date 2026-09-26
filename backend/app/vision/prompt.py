"""Prompt for the reader stage: photo -> the lines as written. Deliberately NOT product matching.

Two stages beat one. If the reader also guessed products it would need the whole catalog in the
image request, which is a different, cache-unfriendly prompt and mixes two failure modes in one
answer. Here the reader only reports what is on the paper; the existing extractor does the matching
against the shop's catalog, so a reading mistake and a matching mistake stay tellable apart in the eval.
"""
from __future__ import annotations

READER_RULES = """You read a photograph of a shopping list and report the lines exactly as written.

## Situation
- The photo is taken by a shopkeeper in Odisha, India, at the counter. The list was written by a
  customer, or printed by a supplier. Lighting is poor, the paper may be creased, held in a hand,
  photographed at an angle, and the handwriting is often hurried.
- The writing may be Odia script, Devanagari, Latin, or a mix, sometimes inside one line
  (for example "ପାରାସିଟାମଲ 2 strip").

## What to return
- `lines`: one entry per item on the list, top to bottom, in reading order.
- Copy each item as written. Keep the original script. Do NOT translate, do NOT expand
  abbreviations, do NOT correct spelling, and do NOT rename anything to a product you know.
- Keep the quantity on the same line as its item, in the order written. A quantity written in a
  second column, to the right of the item, still belongs on that item's line.
- Keep digits as written, whether Odia (୦୧୨୩୪୫୬୭୮୯), Devanagari (०१२३४५६७८९) or Latin.
- Keep unit words that are written ("kg", "ପ୍ୟାକେଟ", "str", "pc", "packet").
- Tally marks (llll, ||||) become the digit they count, so "||||" is 4.
- A repetition mark such as "x2" or "×2" stays on the line as written.
- Crossed-out or struck-through items are ALREADY BOUGHT or cancelled: leave them out of `lines`
  and say so in `notes`.
- Skip anything that is not an item: headings, dates, a name, a phone number, a shop stamp, a
  running total, a signature. Put a total in `notes` if one is written.
- A partly hidden or unreadable word is still reported, with the letters you can actually see, so
  the next stage can match it against the shop's catalog. Never invent letters to complete a word.
  Add the item to `unclear_lines` as well when you are unsure of it.
- If the photo has no list in it at all (a face, a shelf, a blurred page), return no lines and say
  what you see in `notes`.

## Several photos
They are pages of ONE list, in the order given. Continue the numbering across them, and do not
repeat a line that appears on two photos because of overlap.

Return only the JSON object for the schema.
"""


def build_reader_message(*, hints: list[str], image_count: int) -> str:
    """The volatile half of the reader prompt. Catalog words are offered as a spelling reference only:
    the reader is told to copy what is written, never to snap a word onto this list. Matching happens
    in the next stage, against the full catalog."""
    lines = [
        f"{image_count} photo(s) of one list." if image_count > 1 else "One photo of a list.",
    ]
    if hints:
        lines += [
            "",
            "For reference only, some product words this shop stocks. Use them ONLY to settle how an "
            "already-legible word is spelled. Never replace a written word with one of these, and never "
            "add an item that is not on the paper:",
            ", ".join(hints[:40]),
        ]
    lines += ["", "Read the list."]
    return "\n".join(lines)
