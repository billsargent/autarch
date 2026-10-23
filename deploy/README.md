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
