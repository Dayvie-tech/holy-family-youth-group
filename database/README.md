# Database

The Supabase project `holy-family-youth-group` has been created. Three migrations have now been applied to the remote project and recorded in this repository's development branch.

## Applied migrations

1. `migrations/001_identity_and_access.sql`
   - Seeds the eight official prayer houses, including **Holy Family Nguviu**, **St. Ruth Kathakwa**, and **St. Joseph Gatunduri**.
   - Creates profiles, administrative assignments, and verified appointment claims.
   - Enables RLS on all four tables.
   - Keeps authorization helper functions in the non-exposed `private` schema.
   - Applies explicit least-privilege Data API grants.

2. `migrations/002_rls_performance_tuning.sql`
   - Optimizes auth/RLS predicate evaluation.
   - Separates Super Administrator insert/update/delete policies.
   - Adds indexes for foreign-key lookups.

3. `migrations/003_member_registration.sql`
   - Adds a private-schema trigger function that creates a pending profile when a Supabase Auth user is created.
   - Stores a private phone number and validated prayer-house selection.
   - Optionally records an allow-listed parish or prayer-house office claim as pending.
   - Does not create admin assignments or trust user metadata for authorization.

## Verification

- Eight prayer-house records are seeded.
- The auth user creation trigger is present on `auth.users`.
- The foundational tables retain row-level security.
- The latest Security Advisor check should be reviewed again after the registration migration.
- Unused-index notices are informational while the tables have little data; do not drop the indexes solely for that reason.

## Planned domains

- Profiles and member approval
- Events and event responses
- Announcements and approvals
- Contribution allocations and payment ledger
- Youth Voice submissions and moderation
- Chat rooms, memberships, messages, edits, and moderation
- Audit logs

## Security requirements

- Enforce permissions in database policies, not only by hiding frontend controls.
- Restrict prayer-house administrators to their assigned house.
- Give the four Super Administrator offices equal permissions.
- Keep individual contribution records private.
- Never store a service-role key in browser code.
