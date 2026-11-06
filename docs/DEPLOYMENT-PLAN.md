# Deployment Plan

## Live branch
The `main` branch remains the stable public GitHub Pages branch.

## Development branch
`development/modular-foundation` is the isolated branch for architecture and application groundwork. Its commits do not change the live Pages deployment while Pages remains configured to deploy from `main`.

## Deployment gates
Before merging a feature to `main`:
- Check all navigation and asset paths.
- Test desktop and mobile layouts.
- Confirm the official logo file remains unchanged.
- Verify that private member data is not exposed.
- Test authentication and role permissions where applicable.
- Check browser console and network errors.
- Confirm all public-facing wording is accurate about features that are not yet active.

## Backend launch gate
Do not accept real member registrations or contribution records until authentication, database policies, role checks, and administrator approval workflows have been tested. Frontend-only checks are not sufficient for access control.
