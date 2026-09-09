# AI Farms — Farm Tracker

Three workspaces under one roof, switched from the toggle at the top:
**Poultry**, **Bell Pepper Fields**, and **Whole Farm**.

---

## Farm Profile — using this for more than one farm

Tap **Farm Profile** in the top bar (visible from every workspace) to set
your farm's name, location, and contact details. This is what shows up in
every header, the weekly report, and on every invoice and receipt you
generate — so the app reflects *your* farm, not a copy of someone else's.

**If you're sharing this app with others** (friends each signing in with
their own account on the same deployment): every brand-new sign-up starts
completely empty — no inherited flock names, no borrowed history, no
pre-filled farm name. Each person sets their own Farm Profile once, and from
then on their data, their headers, and their documents are entirely their
own. Row-level security on the cloud database means no account can see
another's data, regardless of how many people share the same deployment.

**Two things worth knowing if several people use one deployment:**
- The installed app's icon and name on someone's home screen come from the
  build itself, not the Farm Profile — everyone who installs this same
  deployment gets the same icon/name, even with different farm names set
  inside the app.
- Whoever owns the Supabase project this is connected to is the de facto
  administrator of everyone's data on it — their storage and bandwidth
  limits apply across every account, and they're the one who'd need to act
  on any account-level issue (password resets outside the app's own flow,
  etc.).

---

## Poultry

Multi-flock: switch between your Ross 308 broilers and Hy-Line layers, or add a
new batch. Each flock keeps its own daily log, feed, growth curve, breed
standard, sales, litter and vaccinations.

### Finishing a batch

Applies the same way whether you've sold the last broiler or culled the last
spent layer at end of lay: when you're starting a new batch, add a **new
flock** ("+ Flock") rather than editing the old one's start date —
otherwise the old and new batch's numbers blend together in the same log.

**Edit flock** sits right under the flock name at the top of the Poultry
workspace — that's also where the point-of-lay override and Completed
status live. Once a flock's bird count reaches zero, a banner appears there
automatically with a one-tap **Mark Completed** button, so you don't have
to remember to go looking for it.

Marking a flock Completed just moves it out of the everyday flock switcher
so the list doesn't fill up with finished batches — nothing is deleted. Its
full Daily Log, Sales & Profit, and history stay exactly as they were, still
switchable to anytime via **Show completed**, and still included in Export
and Backup.

- **Dashboard** — birds, mortality, survival, hen-day % (layers) or **FCR**
  against a Ross 308 target (broilers), **egg crates today and this week**
  (Ghana's 30-eggs-per-crate standard), revenue / cost / margin, **feed
  run-out projection**, litter age and condition, manure banked.
- **Feed & Inventory** — log purchases here; the running balance updates
  automatically from those purchases *and* from the "feed given" you log
  each day in Daily Log, merged into one chronological ledger. You never
  enter usage twice, and the balance is always correct even if entries are
  logged out of order (e.g. a purchase logged today, then yesterday's usage
  added afterwards). A low-stock banner projects days of feed remaining.
- **Feed Mix** — home-mix ration calculator (see below).
- **Litter & Manure** — litter laid, topped up, turned, changed, and
  **removed to field** as manure, with condition tracking.
- **Growth** — weight samples charted against the flock's breed standard.
- **Laying & Eggs** (layer flocks only) — see below.
- **Sales & Profit** — egg/bird sales, with cost broken into feed, litter and setup.
- **Health** — medications and vaccinations, plus one-click loading of the
  standard Hy-Line or Ross 308 vaccination programme.
- **Reminders** — vaccinations due, feed reorder, litter change, plus your own tasks.

### Laying & Eggs

Under a layer flock's **Laying & Eggs** tab:

- **Real point of lay** — the flock's actual first-egg date, taken straight
  from the day eggs first appear in Daily Log, not guessed from a breed
  standard. If your birds consistently start laying earlier or later than
  the generic Hy-Line week-21 figure, set **Expected point of lay (week)**
  when editing the flock — the pre-lay countdown then uses your own farm's
  real experience instead of the textbook number.
- **Laying rate** — today's hen-day %, a 7-day average, a 30-day average,
  and a trend chart plotting your actual rate against a typical Hy-Line
  Brown production curve. A **Peak So Far** card shows the flock's best
  7-day average to date, and that same peak is marked directly on the
  chart — based on a smoothed week rather than a single stand-out day, so
  one unusually good (or under-logged) day can't wrongly claim the title.
  If the peak falls outside the chart's current 30/90/180-day window, a
  note tells you to switch to a longer range to see it marked.
- **Egg cash flow** — today's, this week's, and this month's egg revenue,
  pulled specifically from egg sales.
- **Cost per egg** — feed cost ÷ eggs collected, next to your average sale
  price, so you see the real margin per egg.
- **Egg stock** — a running balance of eggs collected minus cracked minus
  sold, the same ledger approach used for feed. Crate sales assume 30 eggs
  per crate.
- **Cracked eggs as cash** — shown as GH₵ lost, not just a count.

The moment real eggs show up in Daily Log, the app's own feed-phase
recommendation switches to Layer immediately — it no longer waits for the
generic breed-standard week, since real birds don't always match it. A
**laying rate drop** still gets flagged automatically (a real week-over-week
fall, only once the rate has settled past the noisy early ramp-up), and for
the first two weeks after laying starts, a reminder nudges you to confirm
the feeder actually has Layer feed in it — since fixing the app's own
assumption doesn't switch what's physically in the trough.

### Feed Mix calculator
Enter your ingredient prices and blend; it returns finished **protein,
calcium and energy** against the target band for the ration type, your
**cost per kg**, the saving versus bagged feed, and the exact **weigh-out in
kg** for your batch size. Recipes save so you can compare blends as maize
prices move.

> The nutrient figures are typical book values for comparing blends and
> catching a bad ratio — not a lab analysis. **Always follow the inclusion
> rate printed on your concentrate bag**, since brands differ. And check your
> maize: mouldy maize carries aflatoxin, which quietly cuts laying, weakens
> shells and can kill birds.

---

## Bell Pepper Fields

Two-field operation with a Field A / Field B / Both selector filtering every view.

- **Dashboard** — plant stand, pest pressure, harvest-hold status, yield,
  revenue / cost / margin, plus alerts.
- **Crop Cycle** — variety, transplant date, live days-after-transplant counter,
  plant count, expected first harvest.
- **Scouting** — pest and disease logging with a pressure trend chart.
- **Spray & Fertigation** — products with **pre-harvest interval** enforcement
  and an active-ingredient rotation warning.
- **Input Stock** — agrochemicals and fertilisers with reorder levels.
- **Harvest & Sales** — kg, grade, price, buyer.
- **Reminders** — harvest holds, scouting due, low input stock.

---

## Goats

Herd registry (tag, name, sex, breed, DOB, sire/dam pedigree, bloodline,
status incl. quarantine), heat observation logging with an ~20-day next-heat
estimate, mating log that runs a pedigree check for inbreeding risk before
saving (blocks direct/full-sibling pairs, warns on half-siblings or shared
ancestry within 3 generations, with an override + log-anyway path), kidding
records linked to a mating, a kid mortality log by cause and pre/post-weaning
stage, a unified health log (deworming, vaccination, FAMACHA, BCS, general
treatment), weight tracking with a monthly average-weight chart, goat sales
with one-click invoicing, and auto-reminders for deworming due (~90 days),
expected heat, and expected kidding (~150 days gestation). Revenue, purchase
cost, and health cost roll into a goat-specific margin, and everything flows
into the Whole Farm P&L and Export Center alongside poultry and pepper.

---

## Whole Farm

Combined profit and loss: poultry margin + pepper margin + goat margin + a
general expense log (labour, transport, utilities, repairs), plus manure
recycled from the poultry house to the fields. Feed, litter, spray, goat
purchase/health, and setup costs are pulled in automatically — add only what
those don't already capture (enterprise = "Goats" for goat-specific running
costs like housing or mineral licks).

---

## Soil Monitoring & Batch Performance

Under **Bell Pepper Fields → Soil & Batches**, the same manure-then-mixed-soil
testing workflow from the AI Farms soil monitoring sheet, now digitised.

### Soil Monitoring
- **Manure pile readings** — sample a few spots before mixing (moisture, EC,
  pH, N, P, K); the app averages them and shows a Fertility (N+P+K) total.
- **Field soil readings** — test several spots in a field on the same day
  after mixing; the app averages the most recent round per field and shows
  Days Since Mix (from the field's Manure Applied date, set in Crop Cycle).
- **Transplant readiness** — a Safe / Caution / Not safe verdict per field,
  following the gate that actually matters: EC and pH. Nitrogen, Phosphorus
  and Potassium are shown for information against **targets you set per
  field** (Crop Cycle → Edit → Soil targets — defaults are typical bell
  pepper ranges, but every farm's soil is different).
- **Retest reminders** — if a field has a manure-applied date and hasn't
  reached Safe yet, a reminder nudges you roughly every 7 days to retest.

### Planting Batches
Each time you transplant, the field's current planting becomes one entry in
its history — a **batch**. Hit **+ New Batch** in Crop Cycle when you replant;
the app archives what was there and starts the new one.

**Batch Performance** (Soil & Batches → Batch Performance) shows, for every
batch a field has ever had: the soil reading closest to its transplant date,
and that batch's actual yield, revenue, cost, and margin — computed from
harvests, sprays, and scouting logged within that batch's own date window.
Nothing needs tagging by hand; the app works out which records belong to
which batch from their dates.

> Batch cost is that batch's own setup cost plus sprays in its window — it
> doesn't include the field's shared structures or general expenses, which
> stay at the field level in the Dashboard and Whole Farm P&L.

---

## Nursery

Under **Bell Pepper Fields → Nursery**, tracking starts before a field ever
gets planted — from the day seeds go into trays or a seedbed, through
germination, to transplant-ready.

- **Sow a batch** — label, variety, sowing date, method, quantity sown, and
  how many days you expect it to need before it's ready (30 is the typical
  default for bell pepper, editable per batch).
- **Log germination** — date and percentage, whenever you check. A reminder
  appears automatically about a week after sowing if it hasn't been checked
  yet, and again as the expected transplant-ready date approaches.
- **Transplant to field** — picks a field, carries the variety across
  automatically, and closes out whatever was previously growing there the
  same way starting a new batch always does. The nursery batch itself is
  marked Transplanted, with the actual date recorded — so you can see how
  long it really spent in the nursery versus what you expected.

Past batches (transplanted or failed) stay visible in a simple history table
underneath the active ones.

---

## Bell Pepper Spray & Nutrition Programme

Under **Bell Pepper Fields → Spray Programme**, a 14-week, 42-event nutrition
and pest/disease schedule (Omex Starter, Boom Boost, Finisher Pro, CalMag,
Boron, Konmidor, Emamectin, CYDIM SUPER, Alt Sulfur, Neem Oil) — computed
from **each field's own transplant date**, not a fixed calendar. Switch
fields at the top of Bell Pepper Fields and the whole programme recalculates
for that field's actual dates.

- Grouped by week and growth stage (Establishment → Vegetative → Pre-flower
  → Flowering → Fruiting → Harvest Approach), filterable by category.
- Tap any event for its exact rate (ml or g per 15L, drip rates, PHI notes).
- **Generate reminders** turns the remaining (not-yet-passed) events into
  actual Reminders with due dates and rates in the notes — safe to tap more
  than once, it skips anything already added.

This is a plan, not a log — record what you actually spray in **Spray &
Fertigation** as you go, which is what your PHI holds, resistance-rotation
warnings, and spray costs are based on.

---

## Fuel Tracker

Under **Whole Farm → Fuel**, log every fuel purchase — generator, water pump,
vehicle, tiller, motorbike:

- **Date, fuel type, equipment, liters, price per liter** — cost calculates
  itself from liters × price, or you can type the total directly.
- **Assign it** to poultry, bell pepper, or the whole farm — down to a
  specific field or flock, same as expenses and staff payments. A water
  pump run for Field A shows up in Field A's own cost, not just a farm-wide
  total.
- **Totals and averages** — total spent, total liters, average price per
  liter, and a spend-by-equipment breakdown, so you can see whether the
  generator or the vehicle is the real cost driver.

Fuel counts as a running cost the same way labour does, so it flows straight
into the Whole Farm P&L and the relevant field/flock margin automatically.
Edit and Delete a purchase from the Fuel tab — editing from the general
Whole Farm expenses list is disabled for fuel records, since that form
doesn't know about liters or price per liter and would drop them.

---

## Black Soldier Fly Larvae

Under **Whole Farm → BSF Larvae**, track turning manure and farm waste into
a home-grown protein supplement for poultry feed:

- **Start a batch** — date, substrate (poultry manure, goat manure, kitchen
  scraps, or mixed), and how much you fed in.
- **Log the harvest** whenever it's ready — larvae harvested (fresh weight),
  dried weight if you're storing it, and what it was used for (fed fresh,
  dried and stored, or sold).
- Active batches show a **Nearing harvest** flag once they're likely getting
  close (roughly 3–6 weeks in) — a loose guide, not a guarantee, since heat
  and substrate change how fast larvae mature.
- **Totals** — larvae harvested lifetime, dried and stored, and substrate
  used, so you can see the actual output of the whole operation over time.

This isn't linked into Feed Mix or feed cost calculations yet — it's a
production log for now. If you want your feed cost and FCR numbers to
reflect BSF larvae once you're producing them regularly, that's a natural
next step to add.

---

## Farm Team & Payroll

Under **Whole Farm → Farm Team**, track your farm help and what you pay them.

- **Staff** — name, role, phone, pay type (Daily/Weekly/Monthly), usual rate,
  start date. Mark someone Inactive when they leave; you can only **Delete**
  a staff record outright if they have no payment history yet, so payment
  records never go missing by accident.
- **Payments** — each one is Wage, Advance, Repaid in cash, or Worked off,
  and can be assigned to poultry, bell pepper, or general — down to a
  **specific field or flock**. Picking a staff member auto-suggests their
  usual rate for a Wage payment.
- **Advances** — give someone money ahead of work, and the app tracks what
  they still owe. When they've worked it off, log it as **Worked off** (no
  new cash left the farm, so no new cost — it just clears the balance). If
  they hand cash back instead, log **Repaid in cash** (refunds the cost).
- **Due-payment warnings** — based on pay type and the last wage actually
  logged, the tab flags anyone whose next payment is due or overdue.

Because payments live in the same cost ledger as everything else, they flow
straight into the Whole Farm P&L, and into the specific field or flock's own
cost — the same way Structures & Assets and general expenses already do.

> The general **Labour** category under Whole Farm expenses still exists for
> one-off casual hires you don't want to add as a named staff member. For
> anyone regular, log through Farm Team instead — logging the same payment
> in both places would count it twice.

---

## Structures & assets (net houses, coops)

Big builds — an insect net house, a poultry coop, a drip system, a borehole —
are tracked in **Whole Farm → Structures & assets**, not as ordinary expenses.

Add one with **+ Add structure**, then set:

- **What is it** — net house, coop, irrigation, fencing, etc.
- **Enterprise** — poultry or bell pepper.
- **Which field / flock** — assign it to Field A, Field B, a specific flock, or shared.
- **Amount** and **useful life in years** (sensible defaults are filled in).

The cost is then **spread over its useful life** rather than charged entirely to
the season it was built. A GH₵25,000 net house on a 4-year life charges about
GH₵6,250 a year — so one build doesn't make an otherwise good season look like a
disaster. The assets table shows what you invested, what's been written off, and
what value is left.

Because structures are assigned to a field or flock, **Field A and Field B are
directly comparable** — the pepper field snapshot shows structures and charged
cost per field, so once the second net house is up you can see whether the
netting actually paid for itself.

### Fixing a feed purchase entered wrong

If you saved a purchase without the quantity (or with a wrong cost), open
**Feed & Inventory**, find the record in the **Purchases & adjustments**
table, and tap **Edit**. Correct the amount and save — the running balance
and your feed-cost-per-bird recalculate from the correction immediately,
rather than stacking the fix on top of the mistake. **Delete** is there too,
if a record shouldn't exist at all.

### Litter you clear now, assign to a field later

When you clean the coop, log it under **Litter & Manure → + Log litter**,
action **"Removed to field."** Give it a **Batch label** — e.g. "Broiler coop
clean-out" — so you can tell it apart from any other batch later. If you
don't know which field it's going to yet — it's still composting, or you
haven't decided — choose **"Stored / composting"** as the destination
instead of a field.

That batch shows up under an **awaiting assignment** banner at the top of
the tab, listed by name (or by quantity and date if you skipped the label).
Whenever you actually apply it, find that batch — by its label, in the new
**Batch** column — and tap **Edit**, then change "To field" to the real
field. The manure total for that field updates immediately.

There's no automatic batch tracking beyond this — the app doesn't know which
physical pile is which, only what you tell it. The label is what makes
several stored batches distinguishable later, so it's worth filling in
whenever you're not assigning a field the same day.

---

> Don't enter the same money twice. If you log a net house here, leave that
> field's **Setup cost** in Crop Cycle blank — otherwise it's counted in both
> places and your margin will look worse than it is.

---

## Install on your phone

The tracker is a PWA, so it installs like a normal app — its own icon, no
browser address bar, and it opens offline.

- **Android / Chrome:** an "Install" bar appears in the app; tap it. Or use
  the browser menu → *Install app* / *Add to Home screen*.
- **iPhone / Safari:** tap the **Share** button, then **Add to Home Screen**.
  (iOS gives no install button, so the app shows this instruction instead.)

Once installed it works with no signal: your data is saved on the device and
syncs whenever you're back online.

---

## Invoices & Receipts

Every sale in **Sales & Profit** (poultry) and **Harvest & Sales** (bell
pepper) has an **Invoice** button — tap it and a proper document opens,
pre-filled from that sale: buyer, item, quantity, price. For anything not
logged as a sale yet, **Whole Farm → Export → + New Invoice / Receipt**
starts one blank.

- **Invoice or Receipt** — a toggle at the top switches between "payment
  due" and "paid in full," each numbered in its own sequence
  (`INV-2026-004`, `RCT-2026-004`), resetting each year.
- Everything is editable before you print — buyer name, phone, item
  description, quantity, price, and a notes line for payment method or
  delivery details.
- **Save & Print / Save as PDF** saves the document to your farm's records
  and opens your phone's own print dialog — Android's has "Save as PDF"
  built in, so no extra app is needed to get a real PDF you can send.
- Every invoice and receipt you generate is kept in a running log (visible
  under Export → Documents) — a full paper trail of what's been billed to
  whom, exportable as its own CSV alongside everything else.

---

## Export Center

Under **Whole Farm → Export**, every dataset in the app — Daily Log, Feed,
Medications, Vaccinations, Growth, Sales, Litter, Scouting, Sprays, Harvests,
Soil & Manure Readings, Batches, Input Stock, Expenses (incl. Fuel and Staff
Payments), and Staff — downloads as its own CSV file, opens straight in
Excel or Google Sheets. Useful for your own analysis, or handing records to
a bank, buyer, or co-op. **Export everything** downloads all of them in one
go (your browser may ask permission for multiple downloads — allow it).

## In-app confirmations

Deleting anything now shows a proper in-app dialog instead of the browser's
native popup, and actions like loading a vaccination programme or restoring
a backup show a small toast message instead of freezing the screen — works
the same, just doesn't feel foreign on a phone.

## Daily Log safeguard

If mortality + culls would take a flock's closing count below zero — always
a typo, never a real event — the entry is blocked from saving, with a clear
explanation of the numbers that don't add up, instead of quietly accepting
an impossible bird count that throws off survival %, current flock size, and
every cost-per-bird figure downstream.

## Faster on long-running flocks

The population, feed, and feed-balance charts on the poultry dashboard now
default to the last 90 days, with a 30/90/180/All toggle — a layer flock
racking up hundreds of daily entries a year no longer has to render (and
recompute) all of them just to show what happened this week. The Daily Log
table loads 30 rows at a time with "Show more" / "Show all," instead of every
entry from day one.

## Spray Programme → Spray & Fertigation shortcut

Every event in the Spray Programme has a **Log this spray now** button —
opens Spray & Fertigation pre-filled with the product, rate, and the right
spray type for that event's category, so recording what you actually sprayed
takes one tap instead of retyping the programme by hand.

---

## Backup & Restore

**Backup** downloads your whole farm as a `.json` file. **Restore** loads one
back in — both sit in the poultry header, and work with no internet at all.

Every backup carries the app's schema version, so restoring an old file
never silently produces a half-broken farm:

- A backup missing a field the current app expects gets that field filled
  in with a sensible default, same as it always has.
- A backup written by a **newer** version of the app than you're currently
  running gets flagged before anything loads, with the choice to proceed or
  update first — rather than silently losing whatever that newer version
  understood that this one doesn't.
- Selecting a file that isn't an AI Farms backup at all (wrong file, empty
  JSON) is rejected outright, instead of "succeeding" into a near-empty farm.
- A successful restore reports how many records were loaded, so you can see
  at a glance whether it was the file you meant.

The same version check applies to **cloud sync** — if your account's cloud
data was written by a newer app version, sync pauses in both directions
(neither pulling nor pushing) until you update, rather than guessing.

---

## Login & cloud sync

You sign in with an email and password. The Supabase URL and key are built
into the app, so there is nothing to type on each device — install, sign in,
and your farm data is there.

### If the app says "Saved on this device only"

That means the build had no Supabase details. Either:

- **Best:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel and
  **redeploy** — env vars are read at build time, so adding them without a
  redeploy changes nothing. Then close and reopen the installed app.
- **Or, right now:** tap **Set up cloud sync** on the sync bar and paste the
  Project URL and anon key. It checks the connection before saving, and stores
  them on that device.

Installed app still showing the old version after a redeploy? Close it fully and
reopen — the service worker fetches a fresh copy on launch. On Android you can
also clear the app's cache from the browser's site settings.

### One-time setup

1. Create a free project at supabase.com.
2. **SQL Editor → New query**, paste all of `supabase-setup.sql`, and Run.
3. **Authentication → Providers → Email**: make sure Email is enabled.
   If you'd rather skip confirmation emails, turn **Confirm email** off under
   *Authentication → Sign In / Up*.
4. **Project Settings → API**: copy the **Project URL** and the
   **anon public** key. Never use the `service_role` key.
5. In Vercel, add them as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (see `.env.example`), then redeploy.
6. Open the app, choose **Create an account**, and sign in.
7. Once your account exists, go to **Authentication → Sign In / Up** and turn
   **Allow new users to sign up** OFF, so nobody else can register.

### Vaccinations

Loading a programme creates **scheduled** shots — the app never assumes one was
given. Each appears under **To confirm** in the Health tab with **Done** and
**Not given** buttons, and stays there until you say which. Confirming Done
stamps it with today's date. You can undo a confirmation at any time.

### Medications — day-by-day courses

Logging a medication with a **Duration** (e.g. Amprocox for 5 days) creates
the full course, not just one entry. It shows up under **Active courses** in
the Health tab with a chip for each day — tap a day once it's actually been
given. The day you log it starts checked, since you're giving that dose right
then; the rest confirm as you go.

- A day left unchecked after its date has passed turns red — a missed dose,
  visible at a glance rather than buried in a table.
- The main Medications table shows a **Progress** column (e.g. 3/5) so you
  can see every course's status without opening it.
- A reminder appears automatically on any day a course is active and that
  day hasn't been confirmed yet.

### Security

Each row in `farm_state` is tied to your user id, and row-level security means
the database only ever returns rows belonging to whoever is signed in. The
anon key in the bundle cannot read your records without a valid login.

### How syncing behaves

Sync is **automatic** once you're signed in — you never have to remember to
tap a button:

- A few seconds after you save anything, it's pushed to the cloud on its own.
- Reopening the app, or bringing it back to the foreground after it's been
  backgrounded, triggers a check too.
- **Sync now** and **Pull from cloud** are still there for manual control —
  useful right before you hand the phone to someone else, or if you just want
  to confirm everything's up to date.

**Built-in protection against the failure that matters most:** if a device's
local data gets wiped — storage cleared, app reinstalled, phone reset — it
still starts with a fresh, "just now" timestamp, which could otherwise trick
the app into thinking that empty local copy is the newest version and
pushing it over your real cloud data. Auto-sync checks for this: if a device
looks dramatically emptier than your cloud account, it **pulls your real
data back down instead of overwriting it**, and shows a banner explaining
what happened. This is last-write-wins for genuine edits across devices —
log on two devices without syncing in between and the later push still wins
— but a wipe is never mistaken for a genuine edit.

**Backup / Restore** buttons remain as an extra, offline safety net — worth
using occasionally regardless, since a local file is one thing that doesn't
depend on your connection or your Supabase project being reachable.

If no Supabase keys are configured, the app skips the login screen entirely and
runs purely on-device — no auto-sync, no cloud copy, so Backup/Restore is the
only safety net in that mode.

---

## Deploy

```bash
npm install
npm run dev      # local
npm run build    # production
```

Push to GitHub and import in Vercel as a Vite project.
