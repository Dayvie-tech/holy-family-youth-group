# Holy Family Youth Group — Project Architecture

## Purpose
This repository is the public website and future member-management platform for Holy Family Youth Group. The current root-level HTML pages are the stable public foundation. The modular folders introduced on this development branch are the planned application structure.

## Non-negotiable project decisions
- Use the exact official logo asset supplied by the youth group. Never redraw, replace, or approximate it.
- Brand palette: blue, sky blue, and white.
- Header slogan: "I WILL NOT REST TILL CHRIST IS KNOWN TO ALL".
- Keep public information separate from authenticated member and administrator interfaces.
- Registration requires administrator approval before full member access.
- Never expose private phone numbers, email addresses, or individual contribution records publicly.
- Four equal Super Administrators: Youth Chaplain, Youth Matron, Youth Patron, and Parish Moderator.
- Preserve audit trails for administrative actions.
- Chat rooms: parish-wide, prayer-house-specific, and leadership-only.
- Notifications are in-app/site only for the initial release.

## Planned structure
- `assets/`: logos, icons, approved images, and other static media.
- `css/`: shared styles and page/module stylesheets.
- `js/`: shared frontend utilities and application bootstrap.
- `pages/`: public-facing pages.
- `auth/`: sign-in, registration, approval status, and recovery screens.
- `member/`: authenticated member dashboard and profile.
- `prayer-houses/`: prayer-house workspaces and scoped activities.
- `admin/`: parish administration.
- `super-admin/`: equal-authority Super Administrator workspace.
- `chat/`: chat interface and room views.
- `database/`: schema, migrations, seed data, and Row Level Security policies.
- `pwa/`: web app manifest, service worker, and install assets.
- `docs/`: architecture, deployment, security, and handover notes.

## Current compatibility rule
Do not remove or relocate the root-level pages during this foundation step. GitHub Pages currently serves the root `index.html`. A later migration must preserve all public URLs or provide redirects and must be tested before merging to `main`.

## Data model principles
- One person may hold multiple verified appointments.
- Appointments must record role, scope, prayer house (when applicable), verification status, and effective dates.
- Prayer-house administrators are restricted to their own prayer house.
- Parish administrators have parish-wide operational permissions.
- The four Super Administrators have equal powers; no single one-person override.
- Public contribution views show aggregate totals only; detailed ledgers are permission-restricted.

## Development workflow
1. Keep `main` as the stable GitHub Pages deployment branch.
2. Build and test changes on `development/modular-foundation` or a task-specific branch.
3. Review the diff and test affected pages.
4. Merge through a pull request only after checks pass.
5. Never put service-role keys, passwords, or private credentials in frontend files.
