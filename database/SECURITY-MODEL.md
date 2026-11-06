# Identity and access security model

## Migration 001
Apply `migrations/001_identity_and_access.sql` to a fresh Supabase project using the SQL Editor. Review it before applying it to any project containing existing data.

This migration establishes:
- The eight parish prayer houses.
- Member profiles linked to Supabase Auth identities.
- Multiple appointment records per member, scoped to parish or one prayer house.
- Separate system-level admin assignments.
- Four equal Super Administrator office labels: Youth Chaplain, Youth Matron, Youth Patron and Parish Moderator.
- Row Level Security (RLS) on all four tables.
- Database helper functions for checking Super Administrator, parish administrator and prayer-house administrator access.

## Important security choices
- A prayer-house administrator is scoped to their assigned prayer house. Parish administrators and Super Administrators have parish-wide access.
- All four Super Administrators use the same `super_admin` access level. No office is given an override or higher rank.
- A person can have multiple appointment rows, including parish and prayer-house appointments.
- A member can submit their own appointment claim, but cannot mark it verified.
- Profiles have no browser insert/update policy in this migration. A trusted registration workflow must create/update them and must validate member approval.
- Individual phone numbers and raw profile records are not publicly readable.
- Public directory data must be exposed later through a limited view with explicit column selection.
- Administrative assignment changes and appointment verification must be implemented as trusted, audited backend actions.
- Do not put a Supabase service-role key in browser JavaScript.

## Not included yet
This is the identity/authority foundation, not a complete application backend. It does not yet implement event, announcement, contribution, Youth Voice, chat, notification, or PWA tables. Those modules will receive separate migrations and module-specific RLS policies.

## Before applying
1. Create a Supabase project.
2. Confirm that it is a fresh project with no conflicting tables or policies.
3. Read the migration and confirm the eight prayer-house names.
4. Apply it in the Supabase SQL Editor.
5. Test with separate accounts for a normal member, a prayer-house administrator, a parish administrator and each Super Administrator office.

## Initial administrator bootstrap
There is intentionally no public self-service route for creating Super Administrator assignments. On a brand-new project, the project owner must first create/verify the four designated administrator Auth accounts, provision their matching profile rows through the trusted setup process, and then create one active `admin_assignments` row for each account with `access_level = 'super_admin'` and the correct `super_admin_office` label. This one-time bootstrap must be performed by the project owner using the Supabase SQL Editor or a protected server-side setup action, never by exposing the service-role key in the website. Keep a record of who authorised the initial assignments.

Until at least one Super Administrator assignment exists, the admin-management policies intentionally allow no browser account to grant itself administrative access. This prevents privilege escalation but means the initial four accounts must be provisioned out-of-band.

## Initial test matrix
Before enabling member-facing features, test with separate test accounts:
- Unapproved member: can see only their own profile and appointment claim.
- Approved member: gains only the member capabilities defined by later module policies.
- Prayer-house administrator: can manage only their assigned house.
- Parish administrator: can perform parish-wide operational tasks but cannot alter Super Administrator assignments.
- Each of the four Super Administrator offices: receives the same system permissions.
- Suspended member: cannot use member-only functions, while their history and audit records remain intact.


## Prayer-house leadership directory

The member-facing name shown in a prayer-house leadership roster is stored as a display-name snapshot on the appointment row by a private trigger. This avoids granting house administrators access to unrelated profile fields such as private phone numbers. The roster reads verified appointment rows under the existing house-scoped RLS policy. The trigger function is private and not directly executable by browser roles.
