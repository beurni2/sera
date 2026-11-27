# Rolling back Séra

This page says how to put a live part of Séra back to how it was before a release, in plain words. Read it before you need it.

**The one rule first.** A rollback puts back the *code*. It never puts back *data*: orders, custody records, accounts, keys and photos stay as they are now. If a release wrote bad data, a rollback does not undo it.

---

## 1. A live service (Cloudflare Worker): `custody-service`, `logistics-service`

Cloudflare keeps the last 100 versions of each service. Rolling back points the service at one of them again. Nothing is rebuilt and nothing is uploaded.

### The easy road: the « rollback » workflow

1. On GitHub, open **Actions → rollback → Run workflow**, on the branch **main**.
2. Pick the **service**. Leave **rollback** unticked the first time: the run only lists the newest versions (date and version id) and reads what runs live now. Nothing changes.
3. Run it again with **rollback** ticked:
   - leave **version** empty to go back to the version before the current one, or
   - paste a version id from the list to go back to that one.
4. You approve the run (it waits for you, like every release). It then reads the service's health page for one minute and prints the live release before and after, with the time it took.

### The other road: the Cloudflare dashboard

Cloudflare dashboard → **Workers & Pages** → the service → **Deployments** → **Version history** → on the older version, **Deploy**. Then open the service's `/health` page and check the `release` it names.

### When Cloudflare refuses

Cloudflare will not roll back across a change to the service's stored objects (a Durable Object class added, renamed or deleted, or a migration), or to a version whose links to other parts (bindings) were since removed. Then there is no way back, only forward: undo the change on `main` (a revert, reviewed like any change), let the checks go green, and release again.

### Afterwards

The daily **live-watch** goes red while a service runs an older version than `main`. That is correct: it means a release is owed. It turns green again once the fix is released from `main`.

## 2. The rider app (Expo « preview » channel)

Phones fetch the newest update published on the channel. To put an earlier one back: expo.dev → the project → **Updates** → branch **preview** → the earlier update → **Republish**. From a terminal the same is `eas update:republish --group <update group id>`. Phones take it the next time the app opens. An update that changed the app's native part cannot be republished over a newer native build.

---

*Why this page exists:* a release now goes out only from a commit whose checks passed, and only after the founder approves it. This page is the other half: how to go back when a release that passed still turns out wrong.
