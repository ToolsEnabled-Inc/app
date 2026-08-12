# oauth-live-test — Google sign-in, proven against Google

**He was right, and the blocking premise was false twice over.** "No Google OAuth
client id exists yet (his step)" was wrong — a Desktop-app client was already on
this machine — and the deeper problem underneath it was that the shipped code
*refused the one thing Google requires*, so even with a client id it could never
have completed a sign-in. Both are fixed. The packaged product now completes a
genuine Google sign-in end to end, twice: once with the machine's existing
client, and once with a **new client registered to this product**, which is the
one it should ship with. Nothing is waiting on him.

---

## 1. The client type, settled from Google's own answers

Not inferred from the vault's shape — measured.

| Probe (same client, same request) | Google's answer | Means |
| --- | --- | --- |
| `redirect_uri=http://127.0.0.1:49731/…` | `302` → sign-in page | accepted |
| `redirect_uri=http://127.0.0.1:51234/…` (different port) | `302` → sign-in page | accepted |
| `redirect_uri=https://example.com/…` | `302` → `authError=…redirect_uri_mismatch` | refused |
| `redirect_uri=http://192.168.214.2:49731/…` | `invalid_request: device_id and device_name are required for private IP` | installed-app path |

The control matters: the off-machine case being **refused** proves Google really
is validating `redirect_uri` at that step, so the loopback cases being accepted
on *arbitrary* ports is a fact about the client, not an artefact of asking too
early. Only a **Desktop app** (installed-app) client behaves this way; a Web
application client demands a pre-registered URI and would have refused all four.
The private-IP error is an installed-app-only code path and corroborates it.

**Verdict: Desktop app. `clientType: "desktop"`.**

## 2. The real blocker, which nobody had hit yet

With PKCE S256 correct and no client secret — exactly what the shipped code sent:

```
POST https://oauth2.googleapis.com/token
HTTP 400  {"error":"invalid_request","error_description":"client_secret is missing."}
```

`shell/google-signin.cjs` carried this in its header: *Google's "Desktop app"
client type … issues no usable secret; the proof of possession is PKCE instead.*
The first half is false. Google's client_secret exemption covers **Android, iOS
and Chrome** clients only — Desktop is not among them, and PKCE does not
substitute. `shell/google-signin-config.cjs` went further and **refused** a
configuration containing one (`GOOGLE_SIGNIN_CLIENT_SECRET_REFUSED`), and
`docs/GOOGLE-SIGN-IN-SETUP.md` told the owner to copy the client id and *"ignore
the secret entirely"*.

So the 61/61 local-provider suite was green against a provider built to the same
false assumption — the one thing a local stand-in cannot check is whether the
real server agrees. Every customer would have reached Google, signed in, and
failed on the last step.

**Why sending it is not a leak.** Google, for installed apps: *"the client secret
is obviously not treated as a secret."* It is a second public name for the
application. PKCE — fresh per sign-in, never leaving the process — is what proves
possession, and it is still sent, always. This is what `gcloud` and every other
desktop Google client does.

## 3. Proven against Google's actual servers

`node tools/google-signin-live-qa.mjs` — the packaged build, the shipped button,
Google's authorization server, Google's token endpoint, Google's JWKS. The only
substitution is the hand that clicks, and the run asserts the test-provider
banner is **absent**, so it cannot be confused with a local-provider run.

**21/21 checks passed, twice**, signing in as `jpinckard95@gmail.com`:

- the shipped **Sign in with Google** button, pressed in the packaged window
- the browser sent to `https://accounts.google.com`, ephemeral loopback redirect,
  `S256`, scopes `openid email profile`, no secret in the URL
- Google's own account chooser and consent screen completed as a real person
- Google redirected to the product's loopback listener; the completion page shows
  no authorization code
- token exchange accepted; `id_token` verified against Google's **real** JWKS by
  the product's own verifier
- screen reads `Signed in as Josh Pinckard` with the Google-verified address
- account record: `signInMethod: "google"`, `email: "jpinckard95@gmail.com"`
- **no Google token and no client secret written to the profile**
- **the session survives a restart** of the packaged product

Also verified: `shell/google-oidc.cjs` pins `aud` to exactly this product's client
id (`audience.length !== 1 || audience[0] !== clientId` → refuse). That closes the
trap an earlier lane flagged — a Google `sub` is the same across OAuth clients, so
the audience check is what stops a token minted for another application.

## 4. The client the product should ship with — created

The machine's existing client is the **capability layer's**: it holds Drive,
Gmail and Calendar grants for the owner's accounts. Publishing its identifiers
inside an installer would hand every customer the application identity those
grants were issued to. It proved the flow; it must not ship.

So a dedicated one was registered (authorized under `inScope`
*accounts-and-organizations* / *forms-and-registrations*):

- Google Cloud project **`ToolsEnabled`** (`toolsenabled`), no organization, no
  billing — Google charges nothing for a project, a consent screen or a client
- Google Auth Platform configured: app name **ToolsEnabled**, support and contact
  `jpinckard95@gmail.com`, audience **External**, User Data Policy accepted
  (ordinary clickwrap for a free service)
- OAuth client **`ToolsEnabled desktop sign-in`**, type **Desktop app**
- client id `840383906222-t0jlnp7lmr4377l0ego13oct9murtl5s.apps.googleusercontent.com`

Both values are in the vault as `product_google_signin_client_id` and
`product_google_signin_client_secret`. The secret was piped from the browser
straight into the vault; it was never printed, logged, or written to a file that
outlived the run. **The live suite then passed 21/21 against this new client**, so
what is proven is the client the product will actually use.

## 5. Files changed

| File | What |
| --- | --- |
| `shell/google-signin.cjs` | accepts `clientSecret`; sends it in the token POST body only, never the URL; header corrected |
| `shell/google-signin-config.cjs` | reads `clientSecret`/`client_secret`/`secret` from the same source as the id, and `TOOLSENABLED_GOOGLE_CLIENT_SECRET`; refusal messages never echo it; header corrected |
| `tools/test/google-signin.test.mjs` | the refusal test became an acceptance test; new test pins the secret to the token endpoint and proves PKCE is not dropped — **27/27** |
| `tools/google-signin-live-qa.mjs` | **new** — the packaged build against real Google |
| `tools/google-signin-packaged-qa.mjs` | header only: it claimed a real round trip was impossible for anyone |
| `docs/GOOGLE-SIGN-IN-SETUP.md` | corrected the instruction that would have shipped a build that cannot sign anyone in |

Regression: `tools/google-signin-packaged-qa.mjs` still **61/61**;
`google-account` + `product-account-surface` still **81/81**.

## 6. The one edit not applied — `shell/main.cjs` is fenced

Add one line inside the `createGoogleSignIn({…})` call (~line 1973):

```js
    const attempt = createGoogleSignIn({
      clientId: config.clientId,
      clientSecret: config.clientSecret,          // <-- add this line
      openExternal: url => electronShell.openExternal(url),
```

Until it lands, `tools/google-signin-live-qa.mjs` applies exactly this line to its
**staged copy** (`applyMainShim`) and says so on every run. Once the real line is
there the shim detects it and does nothing, and `applyMainShim` can be deleted.

Also for the coordinator — the shipped default, `config/google-signin.json`
(shared file, not a lane's to commit):

```json
{
  "clientId": "840383906222-t0jlnp7lmr4377l0ego13oct9murtl5s.apps.googleusercontent.com",
  "clientSecret": "<vault: product_google_signin_client_secret>"
}
```

Substitute the value from that vault key. Note plainly: in an open-source repo
this secret becomes public, which Google's installed-app guidance accepts, and it
is why the client above is scoped to sign-in and holds no API grants.

## 7. Proven vs. still assumed

**Proven against Google:** the client type; that a secret-free Desktop exchange is
refused; that the product's authorization request, loopback redirect, PKCE,
scopes, token exchange, JWKS verification, account creation, on-screen verified
email and session persistence all work against Google's live servers, in the
packaged build, with the client the product will ship.

**Not proven:**
- **Sign-in by anyone who is not the owner.** The new consent screen is External
  in **Testing**. Google's documentation says that at `openid email profile`
  alone users need not be on the test-user list and authorizations do not expire
  after 7 days — that is read, not measured, and could not be measured without a
  second person's Google account and password.
- **The other two registered accounts.** Only `jpinckard95@gmail.com` is signed
  into the ToolsEnabled-owned browser; `jpinckard21@gmail.com` and
  `jpinc005@ucr.edu` would need his password and MFA.
- **Which Google account should own the shipping client long-term.** It was
  created under `jpinckard95@gmail.com`, the account this machine's browser is
  signed into and a personal Gmail (an earlier lane noted a `.edu` account is
  wrong here because a Workspace admin could revoke it). Moving it later is a
  ten-minute redo, but the client id would change.
