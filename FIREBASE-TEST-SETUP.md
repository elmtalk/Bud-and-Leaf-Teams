# Bud&Leaf Firebase prototype setup

This checkpoint is for testing Bud&Leaf's local-first/cloud collaboration model.

## 1. Create a Firebase project

Create a Firebase project in the Firebase console.

You do not need Bud&Leaf to own this Firebase project. It belongs to the surveyor/organisation testing the app.

## 2. Add a Web App

In **Project settings → Your apps**, add a Web app.

Firebase will show a `firebaseConfig` object. Copy that object. Bud&Leaf has a **Cloud collaboration (experimental)** panel where you paste it.

A Firebase web config is not a private server secret; access is controlled by Firebase Authentication and Firestore Security Rules.

## 3. Enable Anonymous Authentication

Open **Authentication → Sign-in method** and enable **Anonymous**.

Bud&Leaf v7b uses anonymous users only to get the cloud prototype working quickly. This will be replaced by proper project invitation/member authentication later.

## 4. Create Firestore

Create a Cloud Firestore database.

For this prototype, use the default database.

## 5. Use temporary authenticated-user rules

For the test, use these Firestore rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /budleaf_projects/{projectId} {
      allow read, write: if request.auth != null;

      match /features/{featureId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

These are intentionally broad for a two-phone prototype. Any authenticated anonymous user connected to this Firebase project can access Bud&Leaf cloud projects.

Do **not** treat these as production rules.

## 6. Phone A

1. Open Bud&Leaf.
2. Open **Cloud collaboration (experimental)**.
3. Paste the `firebaseConfig`.
4. Tap **Connect Firebase**.
5. Select/create a Bud&Leaf project.
6. Tap **Enable cloud for project**.
7. Continue surveying normally.

Local saving still happens first.

## 7. Phone B

1. Open the same Bud&Leaf build.
2. Paste the same Firebase config.
3. Tap **Connect Firebase**.
4. Tap **Cloud projects**.
5. Open the shared project.
6. Register the second surveyor code when entering the field map.
7. Add survey features.

Changes should appear on the other phone when both are online.

## Prototype limitations

- Photos remain local.
- Concurrent edits to the same feature are not yet presented as a conflict-resolution UI.
- This is testing the transport/sync architecture, not production security.
