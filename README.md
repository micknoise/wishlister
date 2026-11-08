# wishlister

One static page (`index.html`) plus a Google Sheet as the database (`Code.gs`).
No server, no accounts, no cost.

- Everyone signs in once with their **first name** and a shared **family code**.
- Paste a link and the title, price and picture are filled in automatically
  (most shops; if a site blocks it, type the details yourself).
- On someone else's list, tap **I'll get this**. Others then see "Sam is getting this".
  The list owner never sees what's been bought.
- Edit items, star favourites, and ask for more than one ("want 2").
- Add secret suggestions to someone else's list, or keep a list for someone who won't
  use this (e.g. a child or grandparent).
- **My shopping** lists everything you're getting, with a "Bought" tick. Items the owner
  removes stay there, marked as removed.
- After the occasion, **Open my presents** clears bought things into "Presents received"
  (showing who gave what). Anyone can **Tidy up** a list for someone who doesn't use it.

## Setup (about 5 minutes, done once)

1. Create a new Google Sheet (any name).
2. In it, open **Extensions → Apps Script**. Delete the sample code and paste in
   all of `Code.gs`. Change `FAMILY_CODE` to your own secret, then save.
3. **Deploy → New deployment →** type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click Deploy and authorise it. Google warns it's "unverified" because it's your
   own script: choose Advanced → Go to (project).
4. Copy the **Web app URL** (ends in `/exec`) and paste it into `API_URL` near the
   top of the `<script>` in `index.html`. Commit and push.
5. In this repo: **Settings → Pages → Build and deployment → Deploy from a branch →
   `main` / `(root)`**. After a minute the site is at `https://micknoise.github.io/wishlister/`.
6. Send the family that link and the family code.

If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**
so the URL stays the same.

## Data

Two tabs in the Sheet, created automatically:

- **Items**: `id, owner, title, url, image, price, notes, addedBy, secret, priority, qty, removedBy, archived, added`
- **Claims**: `itemId, buyer, qty, bought, archived, added` (one row per person per item)

The script adds missing columns itself. Sheets from the first version (with a `boughtBy`
column) are upgraded the first time the new script runs: each `boughtBy` becomes a Claims row.

## Updating the script

1. Open the Sheet → **Extensions → Apps Script**, replace everything with the new `Code.gs`,
   and put your real `FAMILY_CODE` back in. Save.
2. **Deploy → Manage deployments →** pencil icon **→ Version: New version → Deploy.**
   This keeps the same URL, so `index.html` doesn't change.

If the page says "The Google script is out of date", step 2 hasn't been done.

## Testing changes before going live

Test against a *copy* of the Sheet, so the real lists are never touched:

1. Open the real Sheet → **File → Make a copy** (call it "Wishlist TEST"). The copy brings its
   own copy of the script and a snapshot of the real data, which is a good upgrade test.
2. In the copy: **Extensions → Apps Script**, paste the new `Code.gs`, set `FAMILY_CODE`,
   then **Deploy → New deployment → Web app** (Execute as: Me, Access: Anyone). Copy its URL.
3. Open the new page with `?api=<test URL>` on the end. A yellow **TEST MODE** banner confirms
   it's using the copy. Either:
   - download `index.html` from the branch and open it in your browser, adding `?api=…`, or
   - use `https://raw.githack.com/micknoise/wishlister/<commit>/index.html?api=…`.
4. Use **Switch back** in the banner (or `?api=default`) to return to the real data.

When happy, merge the branch into `main` and do **Updating the script** on the real Sheet.
The live page shows the "out of date" banner from the merge until the script is updated,
so do both together.

## Amazon

Amazon blocks most automated page reads (Google's servers included), so Amazon links
are handled in layers. Whatever is missing, the person just types it in.

1. Short links (`amzn.to`, `amzn.eu/d/…`, `a.co`) are expanded and every Amazon link is
   tidied to `amazon.xx/dp/ASIN`, which drops tracking and referral codes.
2. The product page is tried. When Amazon lets it through, you get the title, picture and price.
3. If it's blocked, the title comes from the link when the link contains the product name
   (`/Kindle-Paperwhite/dp/…`), and the picture comes from Amazon's unofficial
   image-by-ASIN address (reliable for books, hit-and-miss otherwise).
4. **On phones, use Amazon's Share → Copy and paste the whole message.** It includes the
   product name, which the page splits out automatically. This is the most dependable route.

The official route (Amazon's Product Advertising API) needs an Amazon Associates account
with qualifying sales, which isn't worth it for a family list.

## Notes

- The Sheet (tab "Items") is the data. You can fix typos or delete rows there directly.
- GitHub Pages on a free account needs a **public** repo. That's fine: `Code.gs` holds
  no secrets here (set the real `FAMILY_CODE` only in the Apps Script editor).
- This is trust-based, built for family. The family code keeps strangers out; names
  aren't verified. Don't commit the family code to this repo.
- The web app URL is fine to publish because it's useless without the code.
