# Database

Backend schema and migrations will be introduced here after the Supabase project configuration is confirmed.

Planned domains:
- profiles and member approval
- prayer houses
- roles and verified appointments
- events and event responses
- announcements and approvals
- contribution allocations and payment ledger
- Youth Voice submissions and moderation
- chat rooms, memberships, messages, edits, and moderation
- audit logs

Security requirements:
- Enable Row Level Security on every table containing member or administrative data.
- Enforce permissions in database policies, not only by hiding frontend controls.
- Restrict prayer-house administrators to their assigned house.
- Give the four Super Administrator offices equal permissions.
- Keep individual contribution records private.
- Store no service-role key in browser code.
