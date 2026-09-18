// Checks LA City pay-tennis courts (WebTrac) and returns tonight's open slots.
// Runs on Netlify every time the page asks for /.netlify/functions/courts

const WEBTRAC = "https://reg.recreation.parks.lacity.gov/web/wbwsc/webtrac.wsc/search.html";
const WINDOW_START = 17; // 5pm
const WINDOW_END = 21;   // 9pm
const TZ = "America/Los_Angeles";

// Exact location names as they appear on the City's reservation form.
const SITES = [
  { key: "poinsettia", name: "Poinsettia Park",    location: "Poinsettia Pay Tennis" },
  { key: "cheviot",    name: "Cheviot Hills",      location: "Cheviot Hills Pay Tennis" },
  { key: "westwood",   name: "Westwood",           location: "Westwood Pay Tennis" },
  { key: "westchester",name: "Westchester",        location: "Westchester Pay Tennis" },
  { key: "riverside",  name: "Griffith Riverside", location: "Riverside Pay Tennis" },
  { key: "vermont",    name: "Vermont Canyon",     location: "Vermont Canyon Pay Tennis" },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function laNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, weekday: "long", year: "numeric",
      month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
      .formatToParts(new Date()).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const num = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [mm, dd, yyyy] = num.split("/");
  return { ...parts, hour: Number(parts.hour) % 24, minute: Number(parts.minute), mdY: `${mm}/${dd}/${yyyy}` };
}

function parseTime(s) {
  const m = s.match(/(\d{1,2}):(\d{2})\s*([ap])m/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]); const ap = m[3].toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h + min / 60;
}

function fmt(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? "PM" : "AM";
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ap}`;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Split the results page into court blocks and read the time pills.
function parseSlots(html, startH, endH) {
  const slots = [];
  const blocks = html.split(/class="result-content/).slice(1);
  for (const block of blocks) {
    const nameM = block.match(/data-title="Facility Description"[^>]*>([\s\S]*?)<\/td>/i);
    const court = nameM ? decode(nameM[1]) : "";
    const pillRe = /<a\s+class="([^"]*cart-button[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = pillRe.exec(block))) {
      const cls = m[1], text = decode(m[2]);
      if (/error/.test(cls) || !/success/.test(cls)) continue; // taken
      const range = text.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
      if (!range) continue;
      const s = parseTime(range[1]), e = parseTime(range[2]);
      if (s == null || e == null || e - s > 1.01) continue;
      if (s >= startH && s < endH) slots.push({ time: fmt(s), sort: s, court });
    }
  }
  slots.sort((a, b) => a.sort - b.sort || a.court.localeCompare(b.court));
  return slots;
}

async function fetchSite(site, dateStr, startH, endH, debug) {
  const q = new URLSearchParams({
    location: site.location, module: "FR", date: dateStr,
    begintime: `${fmt(startH).toLowerCase()}`,
    InterfaceParameter: "Iframe_Live_WebTrac", arwebsearch_buttonsearch: "yes",
  });
  const url = `${WEBTRAC}?${q}`;
  const headers = { "User-Agent": UA, "Accept": "text/html" };
  let res = await fetch(url, { headers, redirect: "follow" });
  let html = await res.text();
  // WebTrac sometimes wants a session cookie before it shows results: retry once with it.
  const cookie = res.headers.get("set-cookie");
  if (cookie && !/result-content|did not return any matching/.test(html)) {
    res = await fetch(url, { headers: { ...headers, Cookie: cookie.split(",").map(c => c.split(";")[0]).join("; ") }, redirect: "follow" });
    html = await res.text();
  }
  const entry = { key: site.key, name: site.name, url: site.url, slots: [], error: null };
  if (!res.ok) entry.error = `HTTP ${res.status}`;
  else if (!/result-content|did not return any matching/.test(html)) entry.error = "Unexpected page from the City site";
  else entry.slots = parseSlots(html, startH, endH);
  if (debug) entry.debug = { status: res.status, bytes: html.length, sample: html.slice(0, 300) };
  return entry;
}

export default async (req) => {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const now = laNow();
  // After the window closes, look at tomorrow instead of an empty evening.
  let startH = Math.max(WINDOW_START, now.hour);
  let dateStr = now.mdY, dateLabel = `${now.weekday}, ${now.month} ${now.day}`, whichDay = "tonight";
  if (now.hour >= WINDOW_END) {
    const t = new Date(Date.now() + 24 * 3600 * 1000);
    const [mm, dd, yyyy] = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t).split("/");
    dateStr = `${mm}/${dd}/${yyyy}`;
    dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(t);
    startH = WINDOW_START; whichDay = "tomorrow";
  }
  for (const s of SITES) s.url = "https://recreation.parks.lacity.gov/discover-activities?reserve=true&location=" + encodeURIComponent(s.location);

  const sites = await Promise.all(SITES.map(s => fetchSite(s, dateStr, startH, WINDOW_END, debug)
    .catch(e => ({ key: s.key, name: s.name, url: s.url, slots: [], error: String(e.message || e) }))));

  const body = {
    checked_at: `${((now.hour + 11) % 12) + 1}:${String(now.minute).padStart(2, "0")} ${now.hour >= 12 ? "PM" : "AM"}`,
    date: dateLabel, which_day: whichDay,
    window: `${fmt(startH).replace(":00", "").toLowerCase()}–${fmt(WINDOW_END).replace(":00", "").toLowerCase()}`,
    sites,
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};

export const config = { path: "/api/courts" };
