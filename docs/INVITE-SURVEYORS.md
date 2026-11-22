# Bud&Leaf invitations (email-verified pilot)

The invitation and surveyor-account UI is shared by the PWA and Android build.
It is **not a production-ready permission system until Firestore rules have been
deployed and validated**.

## User journey

1. The project owner sets up Firebase, creates an account with an email/password,
   verifies their email, and signs in.
2. They enable cloud on a **new, secured project** and sync it. An `owner_uid`
   records who controls it.
3. They enter the colleague's email under **Invite surveyor / Join project**.
   Bud&Leaf creates a seven-day, single-use 48-hex-character invitation code.
4. They share it privately. The surveyor creates an account with **that email**,
   verifies it, signs in, and pastes the full `projectUuid.secret` code.
5. Firestore checks that the invited email matches the verified account,
   and an atomic batch accepts the invitation, creates membership and adds
   the project to the surveyor's project list.
6. They choose **Cloud projects**, open the shared project, and register
   their own name and 2–3 letter surveyor code. Those codes are for feature
   attribution and are separate from permission granting.

The app creates and shares a code through the Android share sheet (or clipboard); it does **not** send an email from a backend service automatically.

Invitation access is not granted merely by entering initials or knowing a
project UUID. Photos continue to be local-only; project data and survey records
synchronise through the existing cloud interface.

## Required backend activation

- In Firebase Authentication enable **Email/Password** provider and email
  verification. Allow-list appropriate website domains.
- Review `firestore.rules` and deploy it to the **correct** Firebase project.
  This is not possible merely by committing rules to GitHub.
- Test with at least two verified accounts, one owner and one invitee; ensure
  an unrelated account cannot read a project, list all projects, use someone
  else's invitation, or join with an expired/used code.
- Disable/replace old open/anonymous Firestore rules. Do not promise secure
  sharing before rules are deployed.
- Verify the web and Android builds both load the same Firebase settings
  and invitation module.

## Legacy cloud-project migration warning

The old prototype used **anonymous Firebase users** and root project documents
with **no `owner_uid`**. New Firestore rules cannot safely infer which anonymous
user owns those projects. **Do not auto-claim or overwrite them.**

Before deploying rules, export a full local ZIP (including photographs) from
each old project. Keep those backups safe. The new **Create secure copy of this
project** control creates a separate local copy with a new project UUID,
preserving feature UUIDs, surveyor codes, dates and photographs locally.
It attempts to upload that new copy to Firebase under the signed-in owner;
the original project is unchanged. Verify the clone and cloud sync before inviting anyone.
Full ZIP restore remains separately under development.

## Updating both targets

- PWA source of truth:
  `index.html`, `cloud-sync.js`, `invite-surveyors.js`,
  `teams-surveyor.js` in `elmtalk/Bud-and-Leaf-Teams`.
- Native: copy **exact matching source file bytes** into `upstream/` in
  `elmtalk/BLT-Native-Android-App` and make sure
  `scripts/build-web.mjs` copies `invite-surveyors.js` into `www`.
- Bump PWA version metadata and service worker cache version. PWA update
  activates only at the user's explicit **Update now** action.
- Run native parity checks, generate debug APK, test both against a dedicated
  test Firebase project, and verify the same user and invitation behaviour.
- Routine APK updates still need the **same stable signing key and a higher
  versionCode**; debug APKs built on different runners are not guaranteed to
  update in place. Preserve ZIP backups before any migration.

## Security limitations and test gates

- The invitation is a bearer secret but email ownership must also be verified.
- Firestore rules are the source of truth, not client-side checks.
- An accepted invitation creates member records atomically with its acceptance.
- Revocation UI and paid-device/licence enforcement are not yet implemented.
- Cloud conflicts and photographic recovery require further validation.
- The Android invitation UI needs handset testing (including sharing).

### Deployment order

1. Verify Firebase emulator rule tests pass in GitHub Actions.
2. Back up legacy local projects and confirm they open.
3. Deploy reviewed rules to the correct Firebase database; this replaces the previous rules.
4. Verify owner/recipient test accounts and accepted project access, then test PWA ↔ Android together.
5. Do not invite real clients until the security and restore tests are passed.
