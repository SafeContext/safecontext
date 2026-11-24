// Every connection to Postgres runs its session in UTC (#97).
//
// Prisma's Postgres adapter sends a `Date` as a UTC wall-clock time with no offset, and Postgres
// reads that in the session's time zone. On a database set to another zone (a Mac's local
// Postgres is often America/New_York) every stored time was shifted by the zone's offset: right
// for Prisma, which reads it back the same way, but wrong for SQL, reports and other services.
// No `$app` imports, so the seed and scripts can use it too.

/** libpq `options` that set the session's time zone to UTC. Pass to `PrismaPg` and `pg.Client`. */
export const PG_SESSION_OPTIONS = '-c TimeZone=UTC';
