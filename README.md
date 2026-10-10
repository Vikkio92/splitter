# Splitter.ino

A single-page web app for splitting a restaurant bill by item, with a service charge and payments or deposits that people have already made. It's an installable PWA that works offline, and bills can optionally be shared so friends can add their own items live.

## Install on iPhone
Open the GitHub Pages URL in **Safari**, then tap **Share → Add to Home Screen**.

## Turn on shared bills (one-off, ~5 minutes, free)
1. Go to <https://console.firebase.google.com>, then **Create a project** (any name; Google Analytics can be off).
2. In the left menu, open **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
   Then open **Build → Realtime Database → Create database**. Pick a location (e.g. Belgium `europe-west1`) and start in **locked mode**.
3. Open the **Rules** tab, replace everything with the contents of `database.rules.json`, then click **Publish**.
   These rules mean a bill can only be opened by someone who has its link, and nobody can list all bills.
   The person who shares a bill is its admin: only they can change the bill details, people and payments, or lock the bill.
   Guests can add food & drinks and edit or delete only the items they added, and only while the bill is unlocked.
   The admin's **Admin link** gives admin rights on another device (or to a co-admin).
4. Open **Project settings** (gear icon), go to **Your apps**, click the web icon `</>`, register an app (no Hosting needed), and copy the `firebaseConfig = { ... }` object.
5. Paste it into `firebase-config.js` in place of `null`, so it reads `window.FIREBASE_CONFIG = { apiKey: "...", ... };`

The free "Spark" plan is far more than a group of friends will ever use. The config values aren't secret; access is controlled by the rules.

## Run locally
    python -m http.server 8765
