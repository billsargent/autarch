# Email and calendar

The villagers can help with your email and your calendar, but they never send anything themselves. They read what you allow, and they write **drafts**. An email or a calendar event goes out only when you approve it in the outbox (on your desk at home, or at the post office counter).

## Email

Open the Mayor's ledger → **Email** and pick your provider.

### Gmail (and other providers with app passwords)

Gmail won't take your normal Google password from an app. It needs an **app password**: a 16-letter code made for this app alone.

1. Turn on **2-Step Verification** in your Google account (Security), if it isn't on already.
2. Open [App passwords](https://myaccount.google.com/apppasswords), make one (call it "Village"), and copy the 16-letter code Google shows.
3. In the Email page, pick **Gmail**, type your Gmail address, and paste the code into **App password**. Spaces don't matter.
   - This is not your Google password.
   - It is not the 6-digit code from your phone either.
4. Save. Then **Send a test to yourself** and **Check the inbox**.

The same address and app password are used for sending (SMTP) and reading (IMAP). The servers are filled in for you; open **Server settings** to see or change them.

iCloud, Yahoo and Fastmail work the same way, each with its own app-password page (linked on the Email page). For any other provider, choose **Other** and fill in the servers.

Outlook, Hotmail and Microsoft 365 no longer accept passwords from mail apps; signing in with Microsoft isn't available yet (#141).

### Who may read your email

Nobody, unless you tick them on the Email page. A villager you tick gets a read-only `read_email` tool: nothing is marked read, moved or deleted.

### Drafts and sending

- **The address comes first.** A villager's email draft must have a real email address in **To**, or it's refused when they write it. The neighbouring towns in village life (Millbrook and the others) are part of the game and have no email; their orders are answered with `accept_order`.
- **You have the last word.** In the outbox you can change **To**, the subject and the words before you approve. **Approve and send** sends it from your account.
- **If a send fails**, it says why. **Fix it and try again** puts it back in the tray.
- **Limits.** The Email page sets a daily limit, an optional "only people I've emailed before", and an optional "written by … sent by …" footer.

## Calendar

You can connect a calendar in two ways, from the wall calendar at home or the calendar desk at the post office.

### Read only: a private ICS address

Most calendars (Google, Apple, Outlook) have a private address in iCal (ICS) format in their sharing settings. Paste it in, and the calendar shows on the wall at home. Villagers you tick can read it. This way, nobody can add events.

### Google Calendar: read, and add events you approve

Connecting Google Calendar lets villagers propose events, which are added to your calendar when you approve them. It takes a one-time setup in your own Google Cloud project. It's free, and the access stays between your Google account and this machine.

1. In the [Google Cloud console](https://console.cloud.google.com/), make a project.
2. **APIs & Services → Library**: turn on the **Google Calendar API**.
3. **OAuth consent screen**: choose External, give it a name, and leave it in **Testing**. Under test users, add your own Google address.
4. **Credentials → Create credentials → OAuth client ID**: choose **Web application**. Under **Authorized redirect URIs**, add the address the calendar desk shows, for example `http://localhost:3000/api/google/callback`. Use the **Copy** button so it matches exactly.
5. Copy the **client ID** and **client secret** into the calendar desk, and **Save**.
6. **Connect Google Calendar**. Google asks you to sign in and allow access to your calendar's events and list. You come back to the calendar desk, connected.

Then:

- **Pick the calendar** villagers' events go into (your main one by default).
- **Tick the villagers** who may read it. They get a read-only `read_calendar` tool.
- **A villager proposes an event** with `save_draft` (kind `event`, with a start, an end and a place). It waits in your outbox with its time and place. **Approve and add** puts it on the calendar.
- **Disconnect Google** revokes the access at Google and forgets it here.

**Good to know:**

- **Redirect address.** Google only accepts `http://localhost` or an `https://` address as a redirect. Open the village at `http://localhost:3000` (on the machine itself) when you connect, or put it behind HTTPS (#114).
- **Testing mode.** While the consent screen is in Testing, Google may ask you to connect again after a week. Publishing the app (for your own use) avoids that.
- **What's stored.** The client secret and Google's tokens stay on this machine. No page shows them, and no villager can read them: `query_database` refuses the calendar settings.
