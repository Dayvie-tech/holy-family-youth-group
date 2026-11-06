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
- Security Advisor currently reports zero security lints after the registration migration.
- The auth user creation trigger is present exactly once, and the profiles table still has RLS enabled.
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


## Migration 004 — audited membership review

Applied on 7 November 2026. Adds `admin_activity_log` and the
`public.review_membership(uuid, text)` RPC. The RPC currently supports
approval only, checks that the caller is a parish-level administrator or the
applicant's prayer-house administrator, and writes an audit record. Browser
clients cannot update `profiles.membership_status` directly. The admin review
page is a separate route at `admin-dashboard.html`.

The first Super Administrator must still be bootstrapped manually and
deliberately after the intended account has completed email verification.
Do not create public signup fields or policies that allow users to assign
themselves administrative access.


## Migration 005 — least-privilege approval

Replaces the exposed review RPC with a narrow column-level update grant and an RLS policy that permits only an authorised administrator to move a pending profile to approved. A private trigger records the approval in the audit log. Browser clients cannot update profile names, contact details, house assignments, or other profile fields through this policy.
