# The fulfilment ledger cannot answer two questions the paid surfaces need

**Found by:** paid-product engineering (session 81b2c0ee), building the projection from the
fulfilment ledger into the customer account area. **Filed here rather than fixed**, because the
grant path is the engine's and the fix is a decision about what a ledger records, not a patch.

**This is not a defect in the ledger's own job.** It grants correctly, it refuses correctly, and
it deliberately never guesses an expiry — `paddlePeriodEndMs`'s comment on refusing to infer from
a billing interval is right, and this report is not asking for that to change. The gap is that two
facts the *customer-facing* side needs are not captured by anything, and both are cheap to capture
at grant time and expensive to recover afterwards.

## What the ledger records

From `entitlement-grant.js` (~line 540), the subscription record is:

```
subscriptionId, provider, pairId, tier, status, licenseId, licenseKey,
licensee, licenseeKey, issuedAt, expiresAt, lastEventId, lastAction,
delivered, deliveredAtMs, deliveryCount
```

Measured: `grep -n "interval\|billing_cycle\|updated_at\|updatedAt" src/lib/entitlement-grant.js
src/lib/entitlement-fulfilment.js` returns one hit, and it is a comment.

## 1 · `interval` — month or year — is not recorded, and is not derivable

Every offer and restatement surface has to say **"$19 per month"** or **"$190 per year"**. The
automatic-renewal disclosure the legal lane specified (`positions/ARL-SURFACE-SPEC.md`) builds its
*frequency* element from it, and that element is one of seven that are individually mandatory.

It cannot be derived from the tier, because **a tier carries both prices** — `operator` is
`monthlyUsd: 19` *and* `annualUsd: 190`. A projector that picked one would be right for half of
all customers and would print the wrong renewal terms for the other half, on the page where being
wrong about renewal terms is the specific thing California ARL is about.

It is known at grant time: it is a property of the price the customer bought, and the notification
that triggered the grant carries the price.

## 2 · The provider's `updated_at` is not recorded, and the cancel fence needs it

`providers/paddle.js subscriptionCancel` takes `expectedStatus` **and** `expectedUpdatedAt`, and
refuses with `PADDLE_SUBSCRIPTION_CANCEL_FENCE_MISMATCH` unless the live subscription still matches.
That fence is good design — it is what stops a cancellation being applied to a subscription that
moved underneath us between read and write.

Nothing on our side stores the stamp, so a cancel call originating from the customer's own account
page cannot arm it. The choices that leaves are: fetch the subscription from Paddle immediately
before every cancel (an extra outbound call, and still racy), or pass the fence a value it will
reject, or disable the fence — which removes the guard at the one moment it exists for.

## What would close it

Either is fine and they are not exclusive:

- **Record both at grant time.** `applyGrantOrRenew` already reads the notification's `data`; the
  interval is on the price and `updated_at` is on the subscription object. Two more fields on the
  record.
- **Or state that the projector's caller must fetch them**, in which case the account service needs
  a Paddle credential, which it currently and deliberately does not have — the process exposed to
  strangers is not the one holding a key that moves money.

The first is cheaper and keeps the credential boundary where it is.

## What we did meanwhile

`toolsenabled-paid/server/src/fulfilment-projector.js` translates a ledger record into an account
subscription and **refuses, naming both fields and what each blocks**, rather than defaulting
either. A defaulted interval is a wrong price on a real customer's page; a missing stamp is a
disabled fence. Neither is a thing to discover at the first sale, so the refusal is the deliverable
until this is closed.

The refusal is returned, never thrown — a webhook handler that crashes on a well-formed
notification is its own outage, and the provider will retry into the same crash.
