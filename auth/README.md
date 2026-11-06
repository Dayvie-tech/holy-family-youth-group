# Authentication

## Implemented on `development/modular-foundation`

- Email/password registration through Supabase Auth.
- Required email confirmation with a redirect to `auth-callback.html`.
- Sign-in and sign-out.
- Profile status routing: pending members go to `pending.html`; approved members go to `member-dashboard.html`; suspended accounts are signed out.
- Private phone number capture.
- Optional parish or prayer-house office claim at registration. Claims are recorded as pending and do not grant permissions.

## Required Supabase URL configuration

Before testing the registration page on GitHub Pages, configure:

- Site URL: `https://dayvie-tech.github.io/holy-family-youth-group/`
- Allowed redirect URL: `https://dayvie-tech.github.io/holy-family-youth-group/auth-callback.html`

Email confirmation must remain enabled. The browser uses only the project's public publishable key from `auth-client.js`. Never put a service-role or secret key in this repository.

## Signup data and security

- A database trigger creates the member profile with `membership_status = 'pending'`.
- User metadata is treated as untrusted form input only. It is never used to decide permissions.
- Optional office claims are allow-listed and saved with `verification_status = 'pending'`.
- No browser-facing profile insert/update policy is added.
- No registration field can create an admin assignment or elevate a user's access level.

## Not yet implemented

- Administrator approval interface and trusted approval action.
- Password reset and resend-confirmation UI.
- Full member dashboard modules and role-specific admin pages.
- Production email delivery configuration and end-to-end live testing.

The development branch is isolated from the stable `main` branch. Do not invite real members to register until the approval workflow and live email flow have been tested.
