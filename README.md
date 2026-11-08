# wishlister

One static page (`index.html`) plus a Google Sheet as the database (`Code.gs`).
No server, no accounts, no cost.

- Everyone signs in once with their **first name** and a shared **family code**.
- Paste a link and the title, price and picture are filled in automatically
  (most shops; if a site blocks it, type the details yourself).
- On someone else's list, tap **I'll get this**. Others then see "Bought by Sam".
  The list owner never sees what's been bought.

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
