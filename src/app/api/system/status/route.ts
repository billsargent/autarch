import { NextResponse } from "next/server";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function GET() {
  const cpus = os.cpus();
  let df = "";
  let uptimeStr = "";
  let topProcs = "";
  try {
    df = (await execAsync("df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs")).stdout;
  } catch {
    /* ignore */
  }
  try {
    uptimeStr = (await execAsync("uptime -p")).stdout.trim();
  } catch {
    /* ignore */
  }
  try {
    topProcs = (await execAsync("ps axo pid,%cpu,%mem,etime,comm --sort=-%cpu | head -n 11")).stdout;
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimePretty: uptimeStr || `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
    cpuModel: cpus[0]?.model || "unknown",
    cpuCount: cpus.length,
    loadavg: os.loadavg(),
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    usedMemPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    disk: df.trim(),
    topProcesses: topProcs.trim(),
    timestamp: new Date().toISOString(),
  });
}
