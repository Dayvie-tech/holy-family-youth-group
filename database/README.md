# Database

The Supabase project `holy-family-youth-group` has been created and the first two migrations have been applied and verified.

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

## Verification

- Four foundational public tables exist.
- All four have RLS enabled.
- Eight prayer-house records are seeded.
- Security Advisor currently reports no security lints.
- Performance Advisor reports only unused-index informational notices; those indexes are expected to become useful as records and queries are added.

Review `SECURITY-MODEL.md` before building authentication and approval workflows.

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
