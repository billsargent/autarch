// Ready-made skills the human can put on the agent's shelf with one click (the
// library's "starter books"). Opt-in: every skill on the shelf is sent with every
// model call, so each costs tokens. Each stays under the prompt's per-skill limit.

export interface StarterSkill {
  name: string;
  summary: string;
  content: string;
}

export const STARTER_SKILLS: StarterSkill[] = [
  {
    name: "system-health-check",
    summary: "A quick, read-only checkup of CPU, memory, disk, services and logs.",
    content: `# System health check

Use when asked how the machine is doing, or at the start of a work window.

1. \`get_system_status\` for CPU, memory, load, disk and uptime.
2. \`list_processes\` sorted by cpu, then by mem. Note anything using more than 50% CPU or 25% memory.
3. Disk: flag any filesystem above 85% full.
4. Services: \`systemctl --failed\` to list failed units (read-only).
5. Logs: \`journalctl -p err -n 30 --no-pager\` for recent errors.

Report in a short table: area, status (ok / watch / problem), detail.
Only suggest fixes; ask before changing anything.
`,
  },
  {
    name: "safe-package-install",
    summary: "Install software carefully: search, dry run, then install with approval.",
    content: `# Safe package install

1. Search first: \`manage_package\` with action=search to find the exact package name.
2. Dry run: action=install with dryRun=true. Read what else would be installed or removed.
3. If the dry run removes anything, stop and ask the human.
4. Install with action=install. This needs the human's approval, so explain why it's needed.
5. Verify: run the program's --version or a status check.
6. Write a journal entry: what was installed, why, and how to remove it.

Never pipe a downloaded script into a shell. Download it with \`download_file\`, read it, then ask.
`,
  },
  {
    name: "investigate-logs",
    summary: "Track down an error from the logs without changing anything.",
    content: `# Investigate logs

1. Narrow the time: when did the problem start? Ask if unknown.
2. System logs: \`journalctl --since "1 hour ago" -p warning --no-pager | tail -n 80\`.
3. One service: \`journalctl -u <service> -n 100 --no-pager\`.
4. App logs: list /var/log, and read with \`tail -n 100\`, not whole files.
5. Group repeated lines and count them; the first occurrence matters most.
6. Form one hypothesis at a time and check it with a read-only command.

Report: what failed, when, the likely cause, and the evidence (quote 1-3 log lines).
Propose a fix, but don't apply it without asking.
`,
  },
  {
    name: "disk-cleanup",
    summary: "Find what's using space and free it safely, with approval for deletes.",
    content: `# Disk cleanup

1. \`df -h\` to see which filesystem is full.
2. \`du -xh --max-depth=1 <mount> | sort -h | tail -n 15\`, then drill into the biggest folder.
3. Safe candidates: rotated logs (*.gz in /var/log), package caches (\`apt-get clean\`), old files in your own workspace.
4. Never delete outside your workspace without the human's approval, and never anything under /etc, /usr, /boot or the framework's folder.
5. Prefer rotating or compressing over deleting.

Report the space before and after, and exactly what was removed.
`,
  },
  {
    name: "plan-before-acting",
    summary: "How to tackle a multi-step task: plan, keep notes, report.",
    content: `# Plan before acting

For anything that takes more than a few steps:

1. Restate the goal in one sentence. If it's unclear, ask one question, then proceed.
2. Write a short plan to notes/plan.md: steps, risks, and how you'll know it worked.
3. Do one step at a time. After each, update plan.md: done, found, next.
4. Prefer reversible steps. Back up a file before editing it (copy to *.bak in your workspace).
5. If a step needs approval, say what it does and why before asking.
6. Finish with a 2-4 sentence summary and a journal entry.

If you run out of steps or time, write in plan.md exactly where you stopped.
`,
  },
  {
    name: "research-with-sources",
    summary: "Look things up on the web and report with sources.",
    content: `# Research with sources

1. Turn the question into 2-3 specific search queries.
2. \`web_search\` each query; prefer official docs, project sites and well-known references.
3. \`fetch_url\` the 2-3 best results and read the relevant parts.
4. Cross-check: only state something as fact if two sources agree, or one is authoritative.
5. Note the date of each source; flag anything that may be out of date.

Answer briefly first, then list sources as links with one line each on what they support.
Never run commands copied from the web without reading and explaining them first.
`,
  },
];
