# Sign in with Google — the one step only you can do

Everything else is built and tested. What is missing is a Google OAuth **client
id** for this product, and creating one means clicking through the Google Cloud
Console signed in as you. Nobody else can do that step, so this is it, written
out so it takes about ten minutes and no decisions.

When you finish you will have one string that looks like this:

    123456789012-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.apps.googleusercontent.com

That string is **public**. It travels in the address bar of every sign-in, it
ships inside the installer, and Google's own documentation says so. You are not
handling a secret at any point in this document.

---

## Before you start: what you are actually agreeing to

**What the product will ask Google for.** Three scopes: `openid`, `email`,
`profile`. That is a person's Google account identifier, their email address,
and their display name. It is **not** access to Drive, Gmail, Calendar,
Contacts, Photos or anything else, and the code refuses to start a sign-in if
that list ever widens (`GOOGLE_SIGNIN_SCOPE_REFUSED`).

**Why that matters commercially.** Those three are Google's *non-sensitive*
scopes. Asking for them keeps this product out of Google's sensitive-scope
review entirely — no security assessment, no annual re-verification, no
third-party audit, no fee. The moment a Drive or Gmail scope is added, all of
that arrives. Do not add one to this client.

**What is stored on a customer's computer afterwards.** Their Google account
identifier and their verified email address. **No Google password, no access
token, no refresh token.** The product never calls a Google API on anybody's
behalf, so there is nothing for a stored token to do except be stolen. Once
Google has said who somebody is, the product mints its own local session.

**A shipped program cannot keep a secret.** Anything inside a download is
readable by whoever downloads it. That is why this uses PKCE and a "Desktop app"
client, which Google designed for exactly this case. If a `clientSecret` ever
appears in the configuration file, the product **refuses to start the sign-in**
and says so rather than shipping it.

---

## Step 1 — pick or create the Google Cloud project

1. Open <https://console.cloud.google.com/>, signed in as yourself.
2. Top left, the project picker. Either reuse an existing project or press
   **New Project**.
   - Name: `ToolsEnabled` (this name is internal; customers never see it).
   - No organisation and no billing account is needed. **Sign-in with these
     scopes costs nothing and will not create a billing line.**
3. Press **Create**, and wait for the picker to switch to the new project.

## Step 2 — the consent screen (what a customer sees)

Menu → **APIs & Services** → **OAuth consent screen**.

1. **User type: External.** Press **Create**.
   - "External" is right even though you are the only one so far: "Internal" is
     only available to Google Workspace organisations and would limit sign-in to
     your own domain.
2. App information:
   - **App name:** `ToolsEnabled` — *this is the name a customer reads in the
     Google dialog: "ToolsEnabled wants to access your Google Account."* Make it
     the name you ship under.
   - **User support email:** your address, from the dropdown.
   - **App logo:** optional. Skip it for now — uploading one triggers a brand
     verification review you do not need yet.
3. **Developer contact information:** your address again. Press **Save and
   continue**.
4. **Scopes.** Press **Add or remove scopes** and tick exactly these three:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`

   They are all in the "Your non-sensitive scopes" group. **Add nothing else.**
   Press **Update**, then **Save and continue**.
5. **Test users.** While the app is in *Testing*, only addresses listed here can
   sign in — up to 100. Add your own address so you can try it. Press **Save and
   continue**, then **Back to dashboard**.

### Testing vs Published — the decision to make later, not now

The consent screen starts in **Testing**. That is correct for now and has two
consequences worth knowing before they surprise you:

- only the test users you listed can sign in; everyone else is refused by
  Google with an error the product will show them; and
- a sign-in issued in Testing expires after **7 days**, so you would be asked to
  sign in again weekly.

When you are ready for customers, come back to this screen and press **Publish
app**. With only these three non-sensitive scopes, publishing does **not**
require Google's verification review — the app moves to "In production" and the
7-day expiry goes away. That is the whole reason the scope list is what it is.

## Step 3 — create the client id

Menu → **APIs & Services** → **Credentials**.

1. **Create credentials** → **OAuth client ID**.
2. **Application type: Desktop app.**
   - Not "Web application". A Desktop app client is a *public* client: it is
     issued no usable secret, and Google accepts the loopback redirect
     (`http://127.0.0.1:<port>/…`) that this product listens on. A Web
     application client would demand a fixed redirect URI and a secret, and this
     product has neither.
   - You do **not** enter a redirect URI. Google allows any loopback port for
     this client type, which is what lets each sign-in take a fresh one.
3. **Name:** `ToolsEnabled desktop` (internal only).
4. Press **Create**.
5. A dialog shows the **Client ID** and a **Client secret**. **Copy the Client
   ID only.** Ignore the secret entirely — do not put it in the configuration
   file, do not paste it into a chat, and do not store it anywhere in this
   repository. For a Desktop app client it proves nothing, and the product
   refuses a configuration that contains one.

## Step 4 — give the client id to the product

Two ways. Either is fine.

**A. This installation only — no rebuild.** Create this file:

    %APPDATA%\ToolsEnabled\google-signin.json

with exactly this in it, your client id substituted:

```json
{
  "clientId": "PASTE-YOUR-CLIENT-ID-HERE.apps.googleusercontent.com"
}
```

Restart ToolsEnabled. The sign-in screen changes from "Sign in with Google — not
available on this copy" to a working button.

**B. Every copy you ship — goes in the installer.** Create the same file at
`config/google-signin.json` in the app tree
(`C:\Users\joshp\Desktop\wt-capability`) and rebuild. `config/` is a shared file
in this repo's lane rules, so hand the change to the coordinator rather than
committing it from a lane.

The product looks in three places in this order and uses the first it finds:
the `TOOLSENABLED_GOOGLE_CLIENT_ID` environment variable, then the per-
installation file (A), then the shipped file (B).

## Step 5 — try it

Open ToolsEnabled → Settings → **Open sign-in**, or the first-run walkthrough.
Press **Sign in with Google**. Your browser opens, you pick your account, and
the window says `Signed in as <your name>` with your address underneath.

If something goes wrong, the screen says which of these it was, and you are left
signed out either way:

| What the screen says | What it means | What to do |
| --- | --- | --- |
| *not available on this copy … has not been given a Google sign-in application id* | Step 4 has not been done, or the file is not where the product looks | check the path and the spelling of `clientId` |
| *is not in the form Google issues* | the string does not end in `.apps.googleusercontent.com` | you copied the secret or a partial value |
| *contains a "clientSecret"* | a secret is in the file | delete that line; it is refused deliberately |
| *could not reach Google* | no network | use an account on this computer instead |
| *Google did not complete the sign-in (access_denied)* | you pressed Cancel, or your address is not a listed test user | add yourself under Test users, or publish the app |
| *did not carry a valid Google signature* | the reply was not really Google's | do not retry blindly; something is intercepting the connection |
| *has not verified the email address on that account* | Google does not vouch for that address | use an account whose address Google has verified |

---

## What this does not do, said plainly

- It is **not** a login to Claude or ChatGPT and carries no subscription. Those
  stay in their own programs (SHIPMENT-PLAN blocker B14).
- It does **not** replace the account-on-this-computer. That still works, is
  still offered, and is the right answer with no network or for anyone who will
  not use Google.
- It proves who somebody is **to this installation**. It is not an attestation
  to any remote party, and anyone already signed in to Windows as that user can
  still remove the local account files.

## For whoever reads the code next

| What | Where |
| --- | --- |
| the flow: PKCE, loopback, system browser | `shell/google-signin.cjs` |
| id_token verification against Google's JWKS | `shell/google-oidc.cjs` |
| where the client id comes from, and the refusals | `shell/google-signin-config.cjs` |
| the account a verified identity becomes | `shell/product-account.cjs`, `signInWithGoogle` |
| the channels (none of which takes an identity from the page) | `shell/main.cjs`, `mc-account:google-*` |
| the screen | `src/account-markup.js`, `src/views/account.js` |
| refusals, forgeries and replays | `tools/test/google-signin.test.mjs` |
| the account rules | `tools/test/google-account.test.mjs` |
| the packaged product, driven end to end | `tools/google-signin-packaged-qa.mjs` |

**The engine's `src/lib/google-oauth.js` is a different thing and must not be
reused here.** That is the capability layer: a confidential-client refresh-token
flow that lets the owner's own agents call Google APIs as him, with
`google_client_id` / `google_client_secret` / `google_refresh_token__<alias>` in
the vault. It assumes a client secret exists and is safe to hold, which is true
on his machine and false in a shipped binary.
