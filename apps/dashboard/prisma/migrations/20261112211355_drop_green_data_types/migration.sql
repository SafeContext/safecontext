-- Issue #23: the policy editor no longer offers "Safe to share" (green) data types. Nothing looks
-- for them (the agent's tier 1 skips `allow` types), so a green pill looked like a setting and did
-- nothing. Remove them from every organisation's draft; their word lists go with them (cascade).
-- Published policy versions are history and keep them; the next publish leaves them out.
DELETE FROM "DataType" WHERE "tier" = 'green';
