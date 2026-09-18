// Checks LA City pay-tennis courts (WebTrac) and returns tonight's open slots.
// Runs on Netlify every time the page asks for /.netlify/functions/courts

const WEBTRAC = "https://reg.recreation.parks.lacity.gov/web/wbwsc/webtrac.wsc/search.html";
const EVENING_START = 17; // 5pm
const EVENING_END = 21;   // 9pm
const DAY_START = 7;      // 7am  (all-day mode)
const DAY_END = 22;       // 10pm (last bookable hour is 9pm)
const TZ = "America/Los_Angeles";

// Exact location names as they appear on the City's reservation form.
// miles = approximate driving distance from West Hollywood; used for sorting and shown on the page.
const SITES = [
  { key: "poinsettia", name: "Poinsettia Park",    location: "Poinsettia Pay Tennis",    miles: 1.5 },
  { key: "vermont",    name: "Vermont Canyon",     location: "Vermont Canyon Pay Tennis", miles: 5.5 },
  { key: "riverside",  name: "Griffith Riverside", location: "Riverside Pay Tennis",      miles: 6 },
  { key: "cheviot",    name: "Cheviot Hills",      location: "Cheviot Hills Pay Tennis",  miles: 7 },
  { key: "westwood",   name: "Westwood",           location: "Westwood Pay Tennis",       miles: 7.5 },
  { key: "westchester",name: "Westchester",        location: "Westchester Pay Tennis",    miles: 13 },
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
function bookUrl(location, dateStr, startH) {
  const q = new URLSearchParams({ location, module: "FR", date: dateStr, begintime: fmt(startH).toLowerCase(),
    InterfaceParameter: "Iframe_Live_WebTrac", arwebsearch_buttonsearch: "yes" });
  return `${WEBTRAC}?${q}`;
}

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
  const entry = { key: site.key, name: site.name, miles: site.miles, url: bookUrl(site.location, dateStr, startH), slots: [], error: null };
  if (!res.ok) entry.error = `HTTP ${res.status}`;
  else if (!/result-content|did not return any matching/.test(html)) entry.error = "Unexpected page from the City site";
  else entry.slots = parseSlots(html, startH, endH).map(x => ({ ...x, url: bookUrl(site.location, dateStr, x.sort) }));
  if (debug) entry.debug = { status: res.status, bytes: html.length, sample: html.slice(0, 300) };
  return entry;
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const debug = params.get("debug") === "1";
  const wantTomorrow = params.get("day") === "tomorrow";
  const modeParam = params.get("mode"); // "evening" | "all" | null (auto)
  const now = laNow();

  // Which calendar day are we looking at?
  const target = new Date(Date.now() + (wantTomorrow ? 24 * 3600 * 1000 : 0));
  const dayOf = d => ({
    mdY: (() => { const [mm, dd, yyyy] = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("/"); return `${mm}/${dd}/${yyyy}`; })(),
    label: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(d),
    weekend: /^(Sat|Sun)/.test(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d)),
  });
  let d = dayOf(target), whichDay = wantTomorrow ? "tomorrow" : "today";
  // Weekends show the whole day; weekdays default to evenings.
  const mode = modeParam === "all" || modeParam === "evening" ? modeParam : (d.weekend ? "all" : "evening");
  const endH = mode === "all" ? DAY_END : EVENING_END;
  const firstH = mode === "all" ? DAY_START : EVENING_START;
  // Skip the hour already in progress: at 6:46 PM the first useful slot is 7:00 PM.
  let startH = wantTomorrow ? firstH : Math.max(firstH, now.hour + 1);

  // If today's window has already closed, roll to tomorrow automatically.
  let autoTomorrow = false;
  if (!wantTomorrow && startH >= endH) {
    autoTomorrow = true; whichDay = "tomorrow";
    d = dayOf(new Date(Date.now() + 24 * 3600 * 1000));
    startH = firstH;
  }
  const dateStr = d.mdY;

  const sites = await Promise.all(SITES.map(s => fetchSite(s, dateStr, startH, endH, debug)
    .catch(e => ({ key: s.key, name: s.name, miles: s.miles, url: bookUrl(s.location, dateStr, startH), slots: [], error: String(e.message || e) }))));

  const body = {
    checked_at: `${((now.hour + 11) % 12) + 1}:${String(now.minute).padStart(2, "0")} ${now.hour >= 12 ? "PM" : "AM"}`,
    date: d.label, which_day: whichDay, weekend: d.weekend, mode, auto_tomorrow: autoTomorrow,
    window: `${fmt(startH).replace(":00", "").toLowerCase()}–${fmt(endH).replace(":00", "").toLowerCase()}`,
    sites,
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
