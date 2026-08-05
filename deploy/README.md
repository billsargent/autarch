# Deployment notes (Linux machine)

## Web dashboard (production)
1. Copy the repo to the machine, e.g. `/root/autarch`.
2. `cd /root/autarch && npm ci && npm run build`
3. Install the unit:
   ```
   sudo cp deploy/deepseek-agent-web.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now deepseek-agent-web
   ```
4. Verify: `sudo systemctl status deepseek-agent-web` and open `http://<host>:3000`.

> `allowedDevOrigins` in `next.config.ts` only affects `next dev`; production needs no change.

## Background worker
Mirror the pattern used for the worker, e.g. a `deepseek-agent-worker.service`:
```
[Service]
Type=simple
User=root
WorkingDirectory=/root/autarch
ExecStart=/usr/bin/npm run worker
Restart=on-failure
RestartSec=5
```
The worker and web server share `data/app.db` (WAL mode handles concurrent access).

## Nightly backup (WAL-safe)
The DB uses WAL mode, so a plain `cp app.db` can be inconsistent. Use the provided script:
```
sudo cp deploy/deepseek-agent-backup.service deploy/deepseek-agent-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now deepseek-agent-backup.timer
```
Backups land in `/root/backups/` (override with `BACKUP_DIR`).

## Keeping the deployment up to date
Behavior changes (safety guarantees, new features, bug fixes) only apply to the **deployed build**.
To sync the machine with the repo:
```
git pull origin master
npm ci && npm run build
sudo systemctl restart deepseek-agent-web deepseek-agent-worker   # adjust unit names
```
For example, the "conversation mode never calls tools" guarantee is enforced only by the latest
build — an older copied-over version will not have it.
