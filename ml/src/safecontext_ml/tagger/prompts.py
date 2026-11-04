"""Label prompts: the text GLiNER is asked to find, and which data type id each one maps to.

GLiNER takes natural-language entity types ("email address") at run time. Our labels are data
type ids (`customer-personal-data`), so every prompt set maps prompts back to ids. Several
prompts may map to the same id; the tagger reports the id.

- `names`: one prompt per data type, its display name in lower case ("revenue figures"),
  except the types in `LABEL_TEXT`, whose name would prompt for the wrong thing. This is what
  the fine-tuned model is trained on (and what its `labels.json` holds), and the natural choice
  for an admin's own data types: the agent can prompt with the name the admin typed.
- `entity`, `entity2`: one entity-style prompt per data type ("customer name"). Off-the-shelf
  GLiNER models were trained on concrete entity types, so they do better with these than with
  policy names.
- `fine`: several concrete prompts per data type ("email address", "phone number"...). The
  strongest zero-shot set, but the TypeScript agent (#15) takes exactly one label per data
  type (`labels.json`), so it can't ship as is. Kept as a reference point.

Only sets with one prompt per data type can be exported (`export.py`).

Prompts are tuned on the dev split only, never on test.
"""

from __future__ import annotations

from ..dataset import labels as L

#: Label text for types whose display name would prompt for the wrong thing. "Customer personal
#: data" reads as "the customer's name", but names are not sensitive (issue #78): the type is
#: contact and account details only.
LABEL_TEXT: dict[str, str] = {
    L.PERSONAL: "email, phone, address, card or id number",
}

NAMES: dict[str, str] = {
    t: LABEL_TEXT.get(t, L.BY_ID[t].name.lower()) for t in L.SPAN_LABELS
}

#: prompt -> data type id
PROMPT_SETS: dict[str, dict[str, str]] = {
    "names": {prompt: type_id for type_id, prompt in NAMES.items()},
    "entity": {
        "revenue figure": L.REVENUE,
        "internal metric": L.METRICS,
        "deal size": L.DEAL,
        "customer name": L.CUSTOMER,
        "project codename": L.ROADMAP,
        "api key": L.SECRET,
        "contact details": L.PERSONAL,
    },
    "entity2": {
        "revenue amount": L.REVENUE,
        "usage metric": L.METRICS,
        "contract value": L.DEAL,
        "company name": L.CUSTOMER,
        "codename or launch date": L.ROADMAP,
        "password or api key": L.SECRET,
        "contact detail or id number": L.PERSONAL,
    },
    "fine": {
        "revenue figure": L.REVENUE,
        "internal metric": L.METRICS,
        "deal size": L.DEAL,
        "customer company": L.CUSTOMER,
        "project codename": L.ROADMAP,
        "planned launch date": L.ROADMAP,
        "api key": L.SECRET,
        "access token": L.SECRET,
        "password": L.SECRET,
        "private key": L.SECRET,
        "email address": L.PERSONAL,
        "phone number": L.PERSONAL,
        "street address": L.PERSONAL,
        "credit card number": L.PERSONAL,
        "ip address": L.PERSONAL,
        "date of birth": L.PERSONAL,
        "identification number": L.PERSONAL,
        "bank account number": L.PERSONAL,
    },
}


def one_per_type(prompts: dict[str, str]) -> dict[str, str]:
    """prompt -> id as id -> prompt, for `labels.json`. Fails if a type has several prompts."""
    out: dict[str, str] = {}
    for prompt, type_id in prompts.items():
        if type_id in out:
            raise ValueError(
                f"{type_id} has several prompts; the agent takes one per data type"
            )
        out[type_id] = prompt
    return out


def prompt_set(name: str) -> dict[str, str]:
    if name not in PROMPT_SETS:
        raise ValueError(
            f"unknown prompt set {name!r}; known: {', '.join(PROMPT_SETS)}"
        )
    return PROMPT_SETS[name]
