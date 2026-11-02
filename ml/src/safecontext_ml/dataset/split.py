"""Deterministic train / dev / test assignment.

A record's split depends only on its `group` string, hashed with a fixed salt. So:
- the same group always lands in the same split, on every machine and every run;
- adding new data never moves existing records between splits;
- near-duplicates (all records from one template, scenario or source document) share a group and
  therefore a split, so they can't leak from train into test.

The same function partitions entity value pools (customer names, codenames, people), so an entity
string used in test is never seen in train.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Literal

Split = Literal["train", "dev", "test"]
SPLITS: tuple[Split, ...] = ("train", "dev", "test")

#: Percent of groups per split. Changing these (or the salt) reshuffles everything.
RATIOS: dict[Split, int] = {"train": 80, "dev": 10, "test": 10}
SALT = "safecontext-split-v1"


def bucket(key: str) -> int:
    """Stable bucket in [0, 100) for a key."""
    digest = hashlib.sha256(f"{SALT}:{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % 100


def assign_split(key: str) -> Split:
    b = bucket(key)
    if b < RATIOS["train"]:
        return "train"
    if b < RATIOS["train"] + RATIOS["dev"]:
        return "dev"
    return "test"


def partition[T: str](pool_name: str, values: Sequence[T], split: Split) -> list[T]:
    """The values of a pool that belong to `split`."""
    return [v for v in values if assign_split(f"value:{pool_name}:{v}") == split]
