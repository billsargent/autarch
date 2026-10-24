# Deployment notes (Linux machine)

Autarch runs as an ordinary user called `autarch`, not as root. That user can use `sudo`
without a password, so commands the agent runs with `sudo` work. The dashboard classifies
every `sudo` command as critical, so each one waits for your approval unless you switch on
Unrestricted mode.

The shipped files assume the repo lives in `/home/autarch/autarch`. If you put it elsewhere,
edit `WorkingDirectory` in the units.

| File | What it is |
| --- | --- |
| `autarch-web.service` | The dashboard (Next.js), on port 3000 on every interface |
| `autarch-worker.service` | The background worker: scheduled jobs and work windows |
| `autarch-backup.service` + `.timer` | A WAL-safe database backup every night at 03:00, keeping 14 days |
| `autarch-sudoers` | Passwordless `sudo` for the `autarch` user |

## First install

```
# 1. The service user, with passwordless sudo
sudo useradd --create-home --shell /bin/bash autarch
sudo install -m 0440 deploy/autarch-sudoers /etc/sudoers.d/autarch
sudo visudo -c

# 2. The code, owned by that user
sudo -iu autarch git clone https://github.com/billsargent/autarch.git ~/autarch
sudo -iu autarch bash -c 'cd ~/autarch && npm ci && npm run build'

# 3. The services
sudo cp ~autarch/autarch/deploy/autarch-*.service ~autarch/autarch/deploy/autarch-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now autarch-web autarch-worker autarch-backup.timer
```

Then:

1. **Check it's running:** `sudo systemctl status autarch-web autarch-worker`.
2. **Sign in.** The first start prints a setup code in the log:
   `journalctl -u autarch-web | grep "setup code"`. Open `http://<machine>:3000` from any
   computer on your network, enter the code and choose a password. Alternatively, set
   `Environment=AUTARCH_PASSWORD=...` in `autarch-web.service` before the first start.
3. **Workspace.** The agent's workspace defaults to `/home/autarch/agent-workspace`.

> The dashboard is reachable from your local network and protected by sign-in. Don't forward
> port 3000 to the internet. If you need to reach it from outside, use a VPN, or a reverse proxy
> with HTTPS.

## Moving an existing root install over

The old units were called `deepseek-agent-*` and ran as root from `/root/autarch`.

```
sudo systemctl disable --now deepseek-agent-web deepseek-agent-worker deepseek-agent-backup.timer
sudo rm /etc/systemd/system/deepseek-agent-*
# create the user and sudoers file as in step 1 above, then:
sudo mv /root/autarch /home/autarch/autarch
sudo mv /root/agent-workspace /home/autarch/agent-workspace
sudo chown -R autarch:autarch /home/autarch
# then step 3 above
```

After that, open **Settings** and change the workspace to `/home/autarch/agent-workspace`. An
existing install keeps the old `/root/...` path until you change it. Old backups in
`/root/backups` can be moved to `/home/autarch/backups`.

## Nightly backup (WAL-safe)

The database uses WAL mode, so a plain `cp app.db` can be inconsistent; `npm run backup` uses
SQLite's backup API instead. Backups go to `/home/autarch/backups` (`BACKUP_DIR`). Backups older
than 14 days are deleted after each run (`BACKUP_KEEP_DAYS`; `0` keeps them all).

## Keeping the deployment up to date

Changes (safety guarantees, new features, bug fixes) only apply to the **deployed build**:

```
sudo -iu autarch bash -c 'cd ~/autarch && git pull origin master && npm ci'
sudo systemctl restart autarch-web autarch-worker   # the web unit rebuilds on start
```

> `allowedDevOrigins` in `next.config.ts` only affects `next dev`; production needs no change.

### Upgrading to the village (PR #112) or any release with database changes

The database upgrades itself on start (new tables and columns; nothing is deleted), but take a
backup first so you can go back:

```
sudo systemctl stop autarch-worker autarch-web
sudo -iu autarch bash -c 'cd ~/autarch && npm run backup'           # a WAL-safe copy in ~/backups
sudo -iu autarch bash -c 'cd ~/autarch && git pull origin master && npm ci'
sudo systemctl start autarch-web autarch-worker                     # the web unit rebuilds on start
```

Then check:

1. `journalctl -u autarch-web -u autarch-worker -n 50` shows no errors.
2. The dashboard opens on the village; sign in as before.
3. Your agent is now the **Mayor** (the town hall → Mayor's ledger → Villagers), with its old
   conversations, jobs and diary.
4. Settings are in the Mayor's ledger. Nothing that runs on its own is switched on by the upgrade:
   free time, the daily self-report and self-directed work stay off until you turn them on.
5. Optional: set a **town daily budget** (Mayor's ledger → Limits) before adding villagers.

To go back: stop both services, check out the previous commit, copy the backup over
`data/app.db` (or your `AUTARCH_DB_PATH`), `npm ci`, and start them again.
