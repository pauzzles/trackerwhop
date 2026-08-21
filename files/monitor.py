#!/usr/bin/env python3
"""
Content Rewards campaign monitor.

Checks https://contentrewards.com/discover, works out which campaigns are
new since the last run, and sends an alert for each one via Telegram,
Discord, or both.

Designed to be run ONCE per invocation (by cron / Task Scheduler / a loop) --
it keeps state in seen_campaigns.json next to this file, so each run only
reports campaigns it hasn't reported before.

Setup:
    pip install -r requirements.txt
    playwright install chromium

    Set whichever of these you're using (env vars, or edit the constants
    below):
        TELEGRAM_BOT_TOKEN   - from @BotFather
        TELEGRAM_CHAT_ID     - your numeric chat id (see README.md)
        DISCORD_WEBHOOK_URL  - from a channel's Integrations > Webhooks (see README.md)

Run once to test:
    python monitor.py --once --notify telegram
    python monitor.py --once --notify discord
    python monitor.py --once --notify both

Run forever, checking every 60 seconds (simplest option if you're leaving
a PC or VM on):
    python monitor.py --loop 60 --notify discord

Or call `python monitor.py --once` from cron / Task Scheduler every minute
instead of using --loop (more crash-resistant, since each run is fresh).
"""

import os
import re
import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone

import requests

DISCOVER_URL = "https://contentrewards.com/discover"
STATE_FILE = Path(__file__).parent / "seen_campaigns.json"
DATA_EXPORT_FILE = Path(__file__).parent / "campaigns.json"
DATA_EXPORT_FILE_ROOT = Path(__file__).parent.parent / "campaigns.json"

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")

CATS = ["Entertainment", "Technology", "Product", "Music", "Other", "Logo",
        "Personal brand", "Slideshow"]
CAT_PAT = "|".join(CATS)
NUM = r"\d{1,3}(?:,\d{3})*"
LINE_RE = re.compile(
    r"^(?P<agency>.+?)\u00b7(?P<age>\d+[a-zA-Z]+)(?P<category>" + CAT_PAT + r")"
    r"(?P<rest>.*)Join Campaign\$(?P<spent>" + NUM + r")/\$(?P<total>" + NUM + r")"
    r"(?P<count>[\dKk.]*)\$(?P<cpm>[\d.]+)/1K$"
)


def fetch_rendered_text() -> str:
    """
    Render the page with a real (headless) browser and return its visible
    text, one logical block per line. contentrewards.com is a JS app, so a
    plain requests.get() will usually return an near-empty shell -- this is
    why we use Playwright instead of BeautifulSoup-on-raw-HTML.
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(DISCOVER_URL, wait_until="networkidle", timeout=45000)
        # Give any lazy-loaded campaign cards a moment to mount.
        page.wait_for_timeout(2000)
        text = page.inner_text("body")
        browser.close()
    return text


def parse_campaigns(raw_text: str):
    """
    The rendered page concatenates each campaign card into one long run of
    text per card (agency, age, category, title, description, '$spent/$total',
    a submission count, and '$cpm/1K'), with no separators between fields.
    This mirrors the pattern used to parse the one-off snapshot earlier.
    """
    # Normalise whitespace/newlines the way the live site tends to lay text out.
    chunks = re.split(r"Join Campaign", raw_text)
    campaigns = []
    for i in range(len(chunks) - 1):
        # Re-attach the delimiter and look back a reasonable window for the
        # start of this card (agency name onwards).
        window = chunks[i][-400:] + "Join Campaign" + chunks[i + 1][:60]
        m = LINE_RE.search(window.replace("\n", ""))
        if not m:
            continue
        d = m.groupdict()
        spent = int(d["spent"].replace(",", ""))
        total = int(d["total"].replace(",", ""))
        cpm = float(d["cpm"])
        rest = d["rest"].strip()
        title = extract_title(rest)
        campaigns.append({
            "key": f"{d['agency'].strip()}::{title}",
            "agency": d["agency"].strip(),
            "category": d["category"],
            "title": title,
            "total": total,
            "spent": spent,
            "cpm": cpm,
            "age": d["age"],
        })
    return campaigns


def extract_title(rest: str) -> str:
    rest = rest.strip()
    if not rest:
        return rest
    boundaries = [m.start() + 1 for m in re.finditer(r"[a-z0-9\)\]][A-Z]", rest)]
    for b in boundaries:
        if b >= 14:
            return rest[:b].strip()
    return rest[:80].strip()


def load_seen():
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_seen(keys):
    STATE_FILE.write_text(json.dumps(sorted(keys)))


def send_telegram(text: str):
    if "PUT_YOUR" in TELEGRAM_BOT_TOKEN or "PUT_YOUR" in TELEGRAM_CHAT_ID:
        print("[warn] Telegram not configured -- printing instead:\n", text)
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(url, data={
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }, timeout=15)
    if not resp.ok:
        print(f"[error] Telegram send failed: {resp.status_code} {resp.text}", file=sys.stderr)


def send_discord(campaign: dict):
    if "PUT_YOUR" in DISCORD_WEBHOOK_URL:
        print("[warn] Discord not configured -- printing instead:\n", campaign)
        return
    remaining = max(0, campaign.get("total", 0) - campaign.get("spent", 0))
    embed = {
        "title": f"⚡ New Campaign: {campaign['title'][:200]}",
        "url": "https://contentrewards.com/discover",
        "description": f"**Agency:** `{campaign['agency']}`\n**Category:** `{campaign['category']}` • **Posted:** `{campaign.get('age', 'Recent')}`",
        "color": 0xC9FF3D,  # Vibrant Lime Accent
        "fields": [
            {"name": "💰 CPM Rate", "value": f"**${campaign['cpm']:.2f}** / 1K views", "inline": True},
            {"name": "🏦 Remaining Pool", "value": f"**${remaining:,}** left", "inline": True},
            {"name": "📊 Total Budget", "value": f"${campaign['total']:,}", "inline": True},
            {"name": "🔗 Campaign Link", "value": "[Open on Content Rewards Discover](https://contentrewards.com/discover)", "inline": False}
        ],
        "footer": {
            "text": "Content Rewards Radar • Auto-Monitor"
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    resp = requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=15)
    if not resp.ok:
        print(f"[error] Discord send failed: {resp.status_code} {resp.text}", file=sys.stderr)


def parse_interval(val: str) -> int:
    """
    Parse an interval string into integer seconds.
    Supports formats like:
      - '30m', '30min', '30mins', '30 minutes' (half an hour)
      - '1h', '1hr', '1 hour', '2h' (hourly)
      - '0.5h', '0.5hr' (half an hour)
      - '1800', '3600' (raw seconds)
    """
    if isinstance(val, (int, float)):
        return max(1, int(val))
    val_str = str(val).strip().lower()

    # Hour formats (e.g. '1h', '0.5h', '1.5 hours', '1hr')
    m_hour = re.match(r"^([\d.]+)\s*(?:h|hr|hrs|hour|hours)$", val_str)
    if m_hour:
        return max(1, int(float(m_hour.group(1)) * 3600))

    # Minute formats (e.g. '30m', '30min', '30mins', '60m')
    m_min = re.match(r"^([\d.]+)\s*(?:m|min|mins|minute|minutes)$", val_str)
    if m_min:
        return max(1, int(float(m_min.group(1)) * 60))

    # Second formats (e.g. '1800s', '3600', '60s')
    m_sec = re.match(r"^([\d.]+)\s*(?:s|sec|secs|second|seconds)?$", val_str)
    if m_sec:
        return max(1, int(float(m_sec.group(1))))

    raise argparse.ArgumentTypeError(
        f"Invalid interval: '{val}'. Examples: '30m' (half hour), '1h' (1 hour), '1800', '3600'"
    )


def format_interval(seconds: int) -> str:
    """Format seconds into a human-readable interval description."""
    if seconds % 3600 == 0 and seconds >= 3600:
        hrs = seconds // 3600
        return f"{hrs} hour" if hrs == 1 else f"{hrs} hours"
    if seconds % 1800 == 0 and seconds == 1800:
        return "30 minutes (half an hour)"
    if seconds % 60 == 0 and seconds >= 60:
        mins = seconds // 60
        return f"{mins} minute" if mins == 1 else f"{mins} minutes"
    return f"{seconds} seconds"


def run_once(notify: str = "telegram"):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    try:
        raw = fetch_rendered_text()
    except Exception as e:
        print(f"[{now}] fetch failed: {e}", file=sys.stderr)
        return

    campaigns = parse_campaigns(raw)
    if not campaigns:
        print(f"[{now}] parsed 0 campaigns -- site layout may have changed, check parse_campaigns()")
        return

    seen = load_seen()
    is_first_run = len(seen) == 0
    new_ones = [c for c in campaigns if c["key"] not in seen]

    if is_first_run:
        # Don't spam Telegram with the entire board on the very first run --
        # just record a baseline.
        print(f"[{now}] first run: recorded {len(campaigns)} existing campaigns as baseline")
    elif new_ones:
        for c in new_ones:
            if notify in ("telegram", "both"):
                msg = (
                    f"\U0001F4E3 <b>New campaign</b>\n"
                    f"<b>{escape(c['title'])}</b>\n"
                    f"{escape(c['agency'])} \u00b7 {c['category']}\n"
                    f"${c['cpm']:.2f}/1K \u00b7 budget ${c['total']:,}\n"
                    f"https://contentrewards.com/discover"
                )
                send_telegram(msg)
            if notify in ("discord", "both"):
                send_discord(c)
        print(f"[{now}] sent {len(new_ones)} new campaign alert(s) via {notify}")
    else:
        print(f"[{now}] checked, no new campaigns ({len(campaigns)} total on board)")

    save_seen({c["key"] for c in campaigns})

    # Export latest structured campaign data for the dashboard
    try:
        payload = json.dumps(campaigns, indent=2)
        DATA_EXPORT_FILE.write_text(payload, encoding="utf-8")
        DATA_EXPORT_FILE_ROOT.write_text(payload, encoding="utf-8")
    except Exception as ex:
        print(f"[warn] failed to update campaigns.json: {ex}", file=sys.stderr)


def send_discord_digest(campaigns: list):
    """Sends a rich summary digest of the entire market to Discord."""
    if "PUT_YOUR" in DISCORD_WEBHOOK_URL:
        return
    remaining_budget = sum(max(0, c.get("total", 0) - c.get("spent", 0)) for c in campaigns)
    avg_cpm = sum(c.get("cpm", 0) for c in campaigns) / len(campaigns) if campaigns else 0

    top_cpm = sorted(campaigns, key=lambda x: x.get("cpm", 0), reverse=True)[:3]
    top_cpm_text = "\n".join([f"• **{c['title'][:40]}** (`{c['agency']}`) — **${c['cpm']:.2f}**/1K" for c in top_cpm])

    top_pool = sorted(campaigns, key=lambda x: max(0, x.get("total", 0) - x.get("spent", 0)), reverse=True)[:3]
    top_pool_text = "\n".join([f"• **{c['title'][:40]}** — **${max(0, c['total'] - c['spent']):,}** left" for c in top_pool])

    embed = {
        "title": "📊 Content Rewards Intelligence Market Digest",
        "url": "https://contentrewards.com/discover",
        "description": f"Market recap across **{len(campaigns)} active campaigns** on Content Rewards.",
        "color": 0x00F2FE,  # Cyan
        "fields": [
            {"name": "🏦 Remaining Reward Pool", "value": f"**${remaining_budget:,}**", "inline": True},
            {"name": "💰 Average CPM Rate", "value": f"**${avg_cpm:.2f}** / 1K", "inline": True},
            {"name": "🎯 Active Campaigns", "value": f"**{len(campaigns)}** pools", "inline": True},
            {"name": "🏆 Top Highest Paying Campaigns", "value": top_cpm_text or "None", "inline": False},
            {"name": "🏦 Largest Remaining Pools", "value": top_pool_text or "None", "inline": False},
            {"name": "🔗 Quick Action", "value": "[Open Discover Dashboard](https://contentrewards.com/discover)", "inline": False}
        ],
        "footer": {"text": "Content Rewards Daily Digest"},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    try:
        resp = requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=15)
        if resp.ok:
            print("[digest] Sent market digest to Discord!")
    except Exception as ex:
        print(f"[error] Digest failed: {ex}", file=sys.stderr)


def escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Content Rewards campaign monitor — alerts on new campaigns via Telegram/Discord."
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single check and exit (ideal for external schedulers like Task Scheduler or cron)"
    )
    parser.add_argument(
        "--loop",
        "--interval",
        dest="interval",
        type=parse_interval,
        nargs="?",
        const="30m",
        default=None,
        metavar="INTERVAL",
        help="Run continuously every INTERVAL (e.g. '30m' for half an hour, '1h' for 1 hour, '1800', '3600'). Defaults to 30m if specified without a value."
    )
    parser.add_argument(
        "--notify",
        choices=["telegram", "discord", "both"],
        default="discord",
        help="Where to send new-campaign alerts (default: discord)"
    )
    parser.add_argument(
        "--digest",
        action="store_true",
        help="Send a full market digest overview to Discord and exit"
    )
    args = parser.parse_args()

    if args.digest:
        try:
            raw = fetch_rendered_text()
            camps = parse_campaigns(raw)
            send_discord_digest(camps)
        except Exception as ex:
            print(f"[error] Digest run failed: {ex}", file=sys.stderr)
    elif args.once:
        run_once(notify=args.notify)
    else:
        # Default to loop mode every 30 minutes if neither --once nor --loop was passed,
        # or use the parsed interval
        interval_seconds = args.interval if args.interval is not None else 1800
        readable_interval = format_interval(interval_seconds)

        print(
            f"====================================================\n"
            f" Content Rewards Campaign Monitor\n"
            f" Mode: Auto-updating every {readable_interval}\n"
            f" Notification: {args.notify.upper()}\n"
            f" Target: {DISCOVER_URL}\n"
            f" Press Ctrl+C to stop.\n"
            f"===================================================="
        )

        while True:
            try:
                run_once(notify=args.notify)
            except Exception as ex:
                err_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                print(f"[{err_time}] [error] unexpected error during check: {ex}", file=sys.stderr)

            next_run_ts = datetime.now(timezone.utc).timestamp() + interval_seconds
            next_run_str = datetime.fromtimestamp(next_run_ts, tz=timezone.utc).strftime("%H:%M:%S UTC")
            print(f"Next automatic check scheduled in {readable_interval} (at {next_run_str})...")

            try:
                time.sleep(interval_seconds)
            except KeyboardInterrupt:
                print("\nMonitoring stopped by user.")
                break
