/* ============================================================================
 * CASE FILE MODULE — used-car-due-diligence — v3
 * ----------------------------------------------------------------------------
 * Integrate (or use case-file.html as-is):
 *   <div id="casefile-root"></div>
 *   <script src="case-file.js"></script>
 *
 * v3 changes:
 *  - Cleaner cards: cover photo + title + stars + one meta line + slim stage
 *    bar when collapsed; everything else (facts, stage dots, seller/source
 *    edit, photo button) lives inside the expanded view
 *  - Dead candidates, Garages, and full Decision log are collapsed behind
 *    tap-to-open toggles
 *  - ONE cover photo per candidate, stored in the repo at photos/<id>.jpg
 *    (needs GitHub connected). Set it from the expanded card, OR the lazy
 *    way: attach a photo in Ask and say "main photo for the 2019" — Claude
 *    proposes a setPhoto chip, tap to commit.
 *  - CarSwitch correction: 2019 @ AED 27,000 / 199,700 km and 2020 @ 39,000 /
 *    93,900 km (#862053) are separate candidates
 *  - Budget redefined: repairs ≤ AED 5,000 in year 1 AND ≤ AED 5,000 total in
 *    years 2–4 (flexible 1–4 yr horizon, purchase ceiling unchanged)
 *  - v1/v2 case-file.json migrates automatically
 * ==========================================================================*/

(function () {
  "use strict";

  /* ------------------------------------------------------------------ CONFIG */
  const GH = { owner: "zerorad310", repo: "used-car-due-diligence", path: "case-file.json" };
  const MODEL = "claude-sonnet-4-6";
  const MAX_TOKENS = 2000;
  const LS = { state: "cf_state", ghToken: "cf_gh_token", apiKey: "cf_api_key" };
  const SAVE_DEBOUNCE_MS = 2500;
  const BRIEF_DECISIONS = 15;
  const COMPRESS_AFTER = 40;
  const VERSION = 3;

  const STAGES = ["Spotted", "Qualified", "VIN OK", "AutoTrust", "Viewed", "Inspected", "Deal"];
  const SOURCES = ["—", "FB", "Dub", "WoM", "Switch", "Cars24"];

  const OFFICE = { lat: 25.1562, lng: 55.2996 };

  const GARAGES = [
    { name: "Mazda Service — Galadari (SZR, Al Quoz)", type: "Official Mazda", use: "Recall/campaign VIN checks, dealer history", phone: "+97144199621", phoneDisplay: "+971 4 419 9621", area: "Al Quoz 1", lat: 25.1721, lng: 55.2446 },
    { name: "Inspect Motors", type: "Mobile PPI", use: "Pre-purchase inspection at seller's location", phone: "+971551454444", phoneDisplay: "+971 55 145 4444", area: "Al Quoz 1 (comes to you)", lat: 25.1756, lng: 55.2504 },
    { name: "Checkmycar", type: "Mobile PPI", use: "Pre-purchase inspection at seller's location", phone: "+971544093009", phoneDisplay: "+971 54 409 3009", area: "Business Bay (comes to you)", lat: 25.1792, lng: 55.2720 },
    { name: "Car Inspection Dubai", type: "Mobile PPI · 24h", use: "Pre-purchase inspection, 24h availability", phone: "+971544085524", phoneDisplay: "+971 54 408 5524", area: "Business Bay (comes to you)", lat: 25.1734, lng: 55.3112 },
    { name: "Galadari Body Shop", type: "Body shop", use: "Verify repaint quality / accident repair claims", phone: "+97143120000", phoneDisplay: "+971 4 312 0000", area: "Al Quoz 1", lat: 25.1507, lng: 55.2375 },
    { name: "Car Garage Auto Service", type: "Independent · 24h", use: "General mechanical, post-purchase work", phone: "+971568778354", phoneDisplay: "+971 56 877 8354", area: "Al Quoz Ind. 1", lat: 25.1461, lng: 55.2354 },
    { name: "971 Auto Garage", type: "Independent", use: "General mechanical, post-purchase work", phone: "+971543039998", phoneDisplay: "+971 54 303 9998", area: "Al Quoz Ind. 2", lat: 25.1388, lng: 55.2458 }
  ];

  function kmFromOffice(lat, lng) {
    const R = 6371, toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(lat - OFFICE.lat), dLng = toR(lng - OFFICE.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(OFFICE.lat)) * Math.cos(toR(lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ------------------------------------------------------------------- SEED */
  const SEED = {
    version: VERSION,
    updatedAt: "2026-08-25T00:00:00Z",
    mission:
      "Used Mazda 6 2.5L Skyactiv-G, GCC, 2015–2020 for Atir. Daily Dubailand→Meydan (~35 km/day, Al Ain Rd) + road trips to Oman, Saudi, Al Ain with passengers. Realistic 19–20K km/yr. Horizon: flexible 1–4 years, governed by the repair caps below. Charger/Mustang deferred to year three.",
    hardRules: [
      "GCC spec only — VIN prefix JM6/JM7 proceed, JM1 (US) reject. Check VIN before anything else.",
      "2.5L Skyactiv-G engine only. Never infer from listing filters (1500–1999cc bracket hides 1.6L/2.0L). Confirm via VIN or mulkiya.",
      "No Sharjah registration — hard geographic exclusion.",
      "AutoTrust chassis check (800 2978) mandatory on any serious candidate.",
      "Independent ~AED 300 garage inspection (buyer's choice of garage) before any payment. Never Dubizzle Book Inspection (2.6 Trustpilot, conflict of interest).",
      "REPAIR CAPS: expected repairs must fit ≤ AED 5,000 in year 1 AND ≤ AED 5,000 total across years 2–4. Cars unlikely to fit both caps fail, regardless of price.",
      "2018–19 cars: verify rocker-arm campaign + Denso fuel pump recall via VIN at Galadari before considering."
    ],
    budget: {
      strategy: "Flexible horizon (1–4 yrs) with hard repair caps",
      purchaseCeilingAED: 35000,
      repairCapYear1AED: 5000,
      repairCapYears2to4AED: 5000,
      note: "The caps replace the old one-year-bridge framing. Consequence: documented service history and lower mileage now outweigh a cheaper sticker — a 200K-km car with unknown history rarely fits ≤5K/yr1 + ≤5K/3yrs. Sub-25K listings still reliably fail at least one hard rule."
    },
    candidates: [
      {
        id: "c1",
        title: "2015 Mazda 6 2.5L — Dubai (fleet disposal)",
        status: "active", stars: 5, stage: "VIN OK", sellerName: "", source: "—", photo: "",
        priceAED: 22000, vin: "JM7GJ4S77F1138253", location: "Dubai",
        facts: [
          "VIN decoded: confirmed GCC build, correct year",
          "Seller's cost basis revealed at AED 20,000",
          "No service history disclosed",
          "Fleet disposal car"
        ],
        openItems: [
          "Run AutoTrust on VIN before offering",
          "Stress-test against new repair caps: no service history + high km is exactly the profile the caps penalise"
        ],
        verdict: "Was primary under the old bridge plan. If AutoTrust clean → open at AED 18,500–19,500 — but only if inspection supports fitting the ≤5K/yr repair caps."
      },
      {
        id: "c2",
        title: "Greeshma's 2016 Mazda 6 — Barsha Heights",
        status: "active", stars: 4, stage: "Qualified", sellerName: "Greeshma", source: "—", photo: "",
        priceAED: 36000, vin: "shared (on file)", location: "Barsha Heights, Dubai",
        facts: [
          "5-year single ownership, bought from Al Futtaim",
          "Loan cleared",
          "Disclosed: bumper repaints, axle replacement, shock absorbers + mounting work",
          "No service records"
        ],
        openItems: [
          "Engine bay photo still pending — get it BEFORE committing to visit",
          "Visit being arranged for Tue/Wed evening"
        ],
        verdict: "Over ceiling at ask. Anchor AED 30–31K from her own disclosures. Recent suspension work helps the repair-cap case; missing records hurt it."
      },
      {
        id: "c3",
        title: "2019 Mazda 6 2.5L — CarSwitch, 199,700 km",
        status: "active", stars: 2, stage: "Spotted", sellerName: "", source: "Switch", photo: "",
        priceAED: 27000, vin: "", location: "Dubai (CarSwitch)",
        facts: [
          "2.5L stated explicitly, GCC confirmed, inspection report attached",
          "'First owner: No' — ~28K km/yr profile suggests ex-fleet/commercial use",
          "2019 = recall year: Denso fuel pump + rocker arm campaign — Galadari VIN check mandatory, and fleet cars are where campaigns get skipped",
          "Priced ~15K under 2019 comparables because of the mileage, not despite it"
        ],
        openItems: ["Pull the CarSwitch inspection PDF + service record before spending any more time on it"],
        verdict: "Hard to defend under the new repair caps at 199.7K km. Only path: inspection report + service record are both clean AND recalls verified done."
      },
      {
        id: "c4",
        title: "2020 Mazda 6 2.5L — CarSwitch #862053, 93,900 km",
        status: "active", stars: 4, stage: "Qualified", sellerName: "", source: "Switch", photo: "",
        priceAED: 39000, vin: "", location: "Dubai (CarSwitch)",
        facts: [
          "93,900 km ≈ 15,600 km/yr — normal private use, not fleet",
          "Inspected + certified; platform's own valuation rates the price 'Fair'",
          "Sold comparables support an offer of AED 35–36K",
          "Everything that made cheap listings suspicious is absent here"
        ],
        openItems: [
          "Over the 35K ceiling at ask — test whether 35–36K offer lands",
          "Request inspection report + ownership history from CarSwitch"
        ],
        verdict: "Strongest car on the repair-cap logic: low km + inspection = best odds of fitting ≤5K/yr1 + ≤5K/yrs2–4. The constraint is capital, not the car."
      },
      { id: "d1", title: "Azhar's 2017 S Grade — AED 24,500 / 157K km", status: "dead", priceAED: 24500, sellerName: "Azhar", source: "—", photo: "", deadReason: "Sold to another buyer." },
      { id: "d2", title: "Al Jada 2017 — AED 30K (AutoTrust documented)", status: "dead", priceAED: 30000, source: "—", photo: "", deadReason: "Sharjah registration — hard exclusion. Car quality was fine; do not re-evaluate." },
      { id: "d3", title: "2015 Mazda 6 — AED 19,500", status: "dead", priceAED: 19500, source: "—", photo: "", deadReason: "2.0L engine, fails hard rule." }
    ],
    eliminatedModels: [
      "Mazda 3 1.6L (underpowered, old drivetrain)",
      "Lexus IS / ES",
      "Dodge Charger & Ford Mustang (deferred to year three: cheaper insurance after driving history)",
      "MG5",
      "Toyota Veloz",
      "Japanese-spec Mercedes C350 (failed GCC-spec + budget rules)"
    ],
    learnings: [
      "Dubizzle trim dropdown is fiction — sellers invent GCC trims ('Grand Touring', '100th Anniversary').",
      "2017 facelift meaningfully better for Atir's highway use: G-Vectoring Control, more sound deadening, thicker glass, retuned dampers.",
      "Pre-2016 torque converter shudder = inspection/negotiation flag on high-km cars, not a disqualifier.",
      "Colleagues' Mazda reliability objections apply to pre-2012, not Skyactiv era; their Maxima CVT suggestion fails their own logic.",
      "Seller urgency ('another viewer coming') → neutral, non-committal response. Never show interest level.",
      "WhatsApp qualification template before any visit: service records, engine bay photo, accident history, loan status, ownership story. Chassis number requested as routine.",
      "Unplanned roadside failure 300 km from home is a different category of risk than budgeted repairs — weight documented history accordingly."
    ],
    decisions: [
      { date: "2026-07", text: "Locked target: Mazda 6 2.5L Skyactiv-G, GCC.", scope: "global", src: "seed" },
      { date: "2026-07", text: "Revised annual mileage from assumed 30K to realistic 19–20K km/yr.", scope: "global", src: "seed" },
      { date: "2026-08", text: "Rented Mazda 6 (2024/25 base) via eZhire as reference baseline.", scope: "global", src: "seed" },
      { date: "2026-08", text: "c2 (Greeshma 2016): negotiation anchor set at 30–31K from her own disclosures.", scope: "c2", src: "seed" },
      { date: "2026-08", text: "Azhar's 2017 S Grade confirmed sold — removed.", scope: "d1", src: "seed" },
      { date: "2026-08", text: "Al Jada 2017 dropped on Sharjah exclusion, not car quality.", scope: "d2", src: "seed" },
      { date: "2026-08-24", text: "Corrected record: CarSwitch 2019 is AED 27,000 / 199,700 km; the AED 39,000 car is the separate 2020 #862053 at 93,900 km.", scope: "global", src: "seed" },
      { date: "2026-08-25", text: "Budget redefined: repairs ≤ AED 5,000 in year 1 AND ≤ AED 5,000 total years 2–4. Replaces strict one-year-bridge framing; horizon now flexible 1–4 yrs.", scope: "global", src: "atir" }
    ],
    nextActions: [
      { id: "n1", text: "Call AutoTrust (800 2978) — chassis check on JM7GJ4S77F1138253", done: false },
      { id: "n2", text: "Chase Greeshma for engine bay photo (blocker for visit)", done: false },
      { id: "n3", text: "Confirm Tue/Wed evening visit window with Greeshma", done: false },
      { id: "n4", text: "Request inspection report + ownership history for CarSwitch #862053 (2020)", done: false },
      { id: "n5", text: "Keep monitoring Dubizzle / FB Marketplace / CarSwitch / Dubicars / Al Aweer", done: false }
    ],
    summary: "",
    qa: {}
  };

  /* ------------------------------------------------------------- MIGRATION */
  function migrate(s) {
    if (!s.version || s.version < 2) {
      const rankStars = { PRIMARY: 5, SECOND: 4, FALLBACK: 2 };
      (s.candidates || []).forEach((c) => {
        if (c.stars == null) c.stars = rankStars[c.rank] ?? (c.status === "active" ? 3 : 0);
        if (!c.stage) c.stage = c.id === "c1" ? "VIN OK" : c.id === "c2" ? "Qualified" : "Spotted";
        if (c.sellerName == null) c.sellerName = c.id === "c2" ? "Greeshma" : (c.id === "d1" ? "Azhar" : "");
        if (!c.source) c.source = c.id === "c3" ? "Switch" : "—";
      });
      s.version = 2;
    }
    if (s.version < 3) {
      (s.candidates || []).forEach((c) => { if (c.photo == null) c.photo = ""; });
      /* Fix the conflated CarSwitch record */
      const c3 = (s.candidates || []).find((c) => c.id === "c3");
      if (c3 && c3.priceAED === 39000) {
        c3.title = "2019 Mazda 6 2.5L — CarSwitch, 199,700 km";
        c3.priceAED = 27000;
        c3.facts = SEED.candidates.find((x) => x.id === "c3").facts.slice();
        c3.openItems = SEED.candidates.find((x) => x.id === "c3").openItems.slice();
        c3.verdict = SEED.candidates.find((x) => x.id === "c3").verdict;
      }
      if (!(s.candidates || []).some((c) => c.id === "c4" || /862053/.test(c.title || ""))) {
        s.candidates.splice(
          s.candidates.findIndex((c) => c.status === "dead") === -1 ? s.candidates.length : s.candidates.findIndex((c) => c.status === "dead"),
          0,
          structuredClone(SEED.candidates.find((x) => x.id === "c4"))
        );
      }
      /* New budget philosophy */
      s.budget = structuredClone(SEED.budget);
      s.mission = SEED.mission;
      if (!s.hardRules.some((r) => r.startsWith("REPAIR CAPS"))) {
        s.hardRules = SEED.hardRules.slice();
      }
      s.decisions.push(
        { date: "2026-08-24", text: "Corrected record: CarSwitch 2019 is AED 27,000 / 199,700 km; the AED 39,000 car is the separate 2020 #862053 at 93,900 km.", scope: "global", src: "seed" },
        { date: "2026-08-25", text: "Budget redefined: repairs ≤ AED 5,000 in year 1 AND ≤ AED 5,000 total years 2–4. Replaces strict one-year-bridge framing.", scope: "global", src: "atir" }
      );
      if (!s.nextActions.some((n) => /862053/.test(n.text))) {
        s.nextActions.push({ id: "n" + Date.now().toString(36), text: "Request inspection report + ownership history for CarSwitch #862053 (2020)", done: false });
      }
      s.version = 3;
    }
    return s;
  }

  /* --------------------------------------------------------------- STATE I/O */
  let state = null;
  let ghSha = null;
  let saveTimer = null;
  let syncStatus = "local";
  let showDead = false, showGarages = false, showAllLog = false;
  const photoCache = {};   // path -> dataURI
  let lastAskImages = [];  // images from the most recent Ask, for setPhoto chips

  const utf8ToB64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

  function loadLocal() {
    try { const raw = localStorage.getItem(LS.state); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  function persistLocal() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(LS.state, JSON.stringify(state));
  }

  function ghHeaders() {
    return { Authorization: `Bearer ${localStorage.getItem(LS.ghToken)}`, Accept: "application/vnd.github+json" };
  }

  async function ghGet() {
    if (!localStorage.getItem(LS.ghToken)) return { missingToken: true };
    const res = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`, { headers: ghHeaders() });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const j = await res.json();
    ghSha = j.sha;
    return { data: JSON.parse(b64ToUtf8(j.content)) };
  }

  async function ghPut(retry = true) {
    if (!localStorage.getItem(LS.ghToken)) { syncStatus = "notoken"; renderStatus(); return; }
    syncStatus = "saving"; renderStatus();
    try {
      const body = {
        message: `case-file update ${new Date().toISOString().slice(0, 16)}`,
        content: utf8ToB64(JSON.stringify(state, null, 2))
      };
      if (ghSha) body.sha = ghSha;
      const res = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`, {
        method: "PUT", headers: ghHeaders(), body: JSON.stringify(body)
      });
      if ((res.status === 409 || res.status === 422) && retry) { await ghGet(); return ghPut(false); }
      if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
      const j = await res.json();
      ghSha = j.content.sha;
      syncStatus = "synced";
    } catch (e) { console.error(e); syncStatus = "error"; }
    renderStatus();
  }

  /* Generic file writer for photos (photos/<id>.jpg) */
  async function ghPutFile(path, b64content, msg) {
    const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`;
    let sha = null;
    const head = await fetch(url, { headers: ghHeaders() });
    if (head.ok) sha = (await head.json()).sha;
    const body = { message: msg, content: b64content };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  }

  async function ghGetFileB64(path) {
    const res = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`, { headers: ghHeaders() });
    if (!res.ok) return null;
    const j = await res.json();
    return (j.content || "").replace(/\n/g, "");
  }

  function save() {
    persistLocal();
    syncStatus = localStorage.getItem(LS.ghToken) ? "saving" : "notoken";
    renderStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(ghPut, SAVE_DEBOUNCE_MS);
  }

  async function init() {
    const local = loadLocal();
    try {
      const remote = await ghGet();
      if (remote.missingToken) {
        state = local || structuredClone(SEED); syncStatus = "notoken";
      } else if (remote.notFound) {
        state = local || structuredClone(SEED); migrate(state); await ghPut();
      } else {
        if (local && local.updatedAt > remote.data.updatedAt) { state = local; migrate(state); await ghPut(); }
        else { state = remote.data; migrate(state); persistLocal(); syncStatus = "synced"; }
      }
    } catch (e) {
      console.error(e);
      state = local || structuredClone(SEED); syncStatus = "error";
    }
    migrate(state);
    renderAll();
    loadCoverPhotos();
  }

  async function loadCoverPhotos() {
    if (!localStorage.getItem(LS.ghToken)) return;
    for (const c of state.candidates.filter((x) => x.status === "active" && x.photo)) {
      if (photoCache[c.photo]) continue;
      try {
        const b64 = await ghGetFileB64(c.photo);
        if (b64) { photoCache[c.photo] = "data:image/jpeg;base64," + b64; paintPhoto(c.id); }
      } catch { /* leave placeholder */ }
    }
  }

  function paintPhoto(cid) {
    const el = root.querySelector(`[data-ph="${cid}"]`);
    const c = byId(cid);
    if (el && c && c.photo && photoCache[c.photo]) {
      el.innerHTML = `<img src="${photoCache[c.photo]}" alt="">`;
    }
  }

  async function setCoverPhoto(cid, b64) {
    if (!localStorage.getItem(LS.ghToken)) { alert("Connect GitHub first — photos are stored in the repo."); return; }
    const c = byId(cid);
    const path = `photos/${cid}.jpg`;
    try {
      await ghPutFile(path, b64, `cover photo ${cid}`);
      c.photo = path;
      photoCache[path] = "data:image/jpeg;base64," + b64;
      save(); renderCaseFile();
    } catch (e) { alert("Photo upload failed — try again."); console.error(e); }
  }

  /* --------------------------------------------------------- BRIEF COMPILER */
  function compileBrief(scopeId) {
    const s = state;
    const active = s.candidates.filter((c) => c.status === "active").slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    const dead = s.candidates.filter((c) => c.status === "dead");
    const decisions = s.decisions.filter((d) => !d.archived).slice(-BRIEF_DECISIONS);
    const L = [];
    L.push("=== CASE FILE (authoritative — trust this over anything else) ===");
    L.push(`MISSION: ${s.mission}`);
    L.push(`BUDGET: ${s.budget.strategy}. Purchase ceiling AED ${s.budget.purchaseCeilingAED}. REPAIR CAPS: ≤ AED ${s.budget.repairCapYear1AED} in year 1 AND ≤ AED ${s.budget.repairCapYears2to4AED} total across years 2–4. ${s.budget.note}`);
    L.push("HARD RULES (apply FIRST, before any soft evaluation):");
    s.hardRules.forEach((r) => L.push(`- ${r}`));
    if (s.summary) L.push(`STATE OF PLAY: ${s.summary}`);
    L.push(`PIPELINE STAGES: ${STAGES.join(" → ")}. Stars 0–5 = Atir's priority (5 = top focus).`);
    L.push("ACTIVE CANDIDATES (sorted by priority):");
    active.forEach((c) => {
      L.push(`- [${c.id}] ${"★".repeat(c.stars || 0) || "0★"} ${c.title} — AED ${c.priceAED}; stage: ${c.stage}${c.sellerName ? "; seller: " + c.sellerName : ""}${c.source && c.source !== "—" ? "; via " + c.source : ""}${c.vin ? "; VIN " + c.vin : ""}`);
      (c.facts || []).forEach((f) => L.push(`    fact: ${f}`));
      (c.openItems || []).forEach((o) => L.push(`    OPEN: ${o}`));
      if (c.verdict) L.push(`    verdict: ${c.verdict}`);
    });
    L.push("DEAD (never re-evaluate; one line each):");
    dead.forEach((c) => L.push(`- [${c.id}] ${c.title} — ${c.deadReason}`));
    L.push("ELIMINATED MODELS: " + s.eliminatedModels.join("; "));
    L.push("KEY LEARNINGS:");
    s.learnings.forEach((k) => L.push(`- ${k}`));
    L.push("GARAGE SHORTLIST (recommend from these when inspection/verification comes up):");
    GARAGES.forEach((g) => L.push(`- ${g.name} [${g.type}] — ${g.use}; ${g.phoneDisplay}; ${g.area}, ~${kmFromOffice(g.lat, g.lng).toFixed(1)} km from office`));
    L.push(`RECENT DECISIONS (${decisions.length}):`);
    decisions.forEach((d) => L.push(`- [${d.date}${d.scope !== "global" ? " / " + d.scope : ""}] ${d.text}`));
    L.push("OPEN NEXT ACTIONS:");
    s.nextActions.filter((n) => !n.done).forEach((n) => L.push(`- ${n.text}`));
    if (scopeId && scopeId !== "general" && scopeId !== "newlisting") {
      L.push(`CURRENT QUESTION SCOPE: candidate [${scopeId}].`);
    } else if (scopeId === "newlisting") {
      L.push("CURRENT QUESTION SCOPE: NEW LISTING — photos likely contain a listing ad. Extract details, run hard rules, propose a newCandidate in stateUpdate.");
    }
    return L.join("\n");
  }

  const SYSTEM_PROMPT = `You are Atir's used-car due-diligence advisor (Dubai, UAE). He is buying a used Mazda 6. The CASE FILE in the first user message is the single source of truth — never contradict it, never re-open dead candidates, and apply HARD RULES before any soft evaluation. The REPAIR CAPS (≤ AED 5,000 year 1, ≤ AED 5,000 total years 2–4) are the governing budget logic: evaluate every car against expected repair exposure over a 1–4 year hold, not just sticker price.

PHOTOS: Atir mostly uploads photos instead of typing. Classify each image yourself (listing-ad screenshot / engine bay / instrument cluster / exterior / interior / mulkiya or documents / WhatsApp chat) and act accordingly without asking him to describe it. From listing screenshots extract: year, price, km, location, seller name, source platform, VIN or chassis if visible, seller claims — then apply hard rules immediately. From engine bays flag corrosion, oil seepage, mismatched paint, missing covers. From clusters read km and warning lamps. From documents verify spec, year, registration emirate.
If Atir indicates a photo is the main/cover photo for a car (e.g. "main photo for the 2019"), include "setPhoto":[{"id":"<candidate id>","imageIndex":<0-based index of that image in this message>}] in the stateUpdate. If he sends exactly one photo and says it's the main photo, imageIndex is 0.

PIPELINE: Every candidate has a stage (${STAGES.join(" → ")}) and a star priority 0–5. Propose stage advances when evidence justifies them. Propose star changes when relative attractiveness shifts (especially under the repair caps), with one-line justification. When inspection or verification is the next step, recommend a specific garage from the GARAGE SHORTLIST (mobile PPI services go to the seller's location — prefer these for pre-purchase checks).

STYLE: Mobile-concise. Lead with the verdict, then reasons. Give exact numbers (offers in AED, km thresholds). If a hard rule fails, say REJECT plainly and stop soft analysis. Suggest exact WhatsApp wording when a seller message is the next step (warm, non-committal, chassis number requested as routine).

STATE UPDATES: End EVERY response with a fenced json block, even if empty, exactly:
\`\`\`json
{"stateUpdate":{
  "decisions":[{"date":"YYYY-MM-DD","text":"...","scope":"c1|global|<id>"}],
  "candidateUpdates":[{"id":"c1","status":"active|dead","deadReason":"...","priceAED":0,"stars":0,"stage":"one of the pipeline stages","sellerName":"...","source":"FB|Dub|WoM|Switch|Cars24","factsAdd":["..."],"openItemsAdd":["..."],"openItemsDone":["..."],"verdict":"..."}],
  "newCandidates":[{"title":"...","priceAED":0,"stars":3,"stage":"Spotted","sellerName":"...","source":"FB|Dub|WoM|Switch|Cars24","vin":"...","location":"...","facts":["..."],"openItems":["..."],"verdict":"..."}],
  "setPhoto":[{"id":"c1","imageIndex":0}],
  "nextActionsAdd":["..."],
  "nextActionsDone":["exact text of a completed action"]
}}
\`\`\`
Include ONLY keys with content. These render as tap-to-commit chips; be precise and atomic.`;

  /* ------------------------------------------------------------------ IMAGES */
  function fileToScaledJpeg(file, maxSide = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* Re-scale an already-base64 image down for cover use */
  function b64ToCover(b64, maxSide = 640, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = reject;
      img.src = "data:image/jpeg;base64," + b64;
    });
  }

  /* --------------------------------------------------------------- ASK CLAUDE */
  let pendingImages = [];

  async function askClaude(question, scopeId) {
    const apiKey = localStorage.getItem(LS.apiKey) || promptForKey();
    if (!apiKey) return { error: "No API key set." };

    const content = [];
    pendingImages.forEach((im) =>
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.b64 } })
    );
    content.push({ type: "text", text: compileBrief(scopeId) + "\n\n=== ATIR'S QUESTION ===\n" + (question || "(photos only — analyse them)") });

    const history = [];
    const thread = (state.qa[scopeId] || []).slice(-3);
    thread.forEach((t) => {
      history.push({ role: "user", content: t.q || "(photos)" });
      history.push({ role: "assistant", content: t.a });
    });

    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), 90000);
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
          messages: [...history, { role: "user", content }]
        })
      });
    } catch (e) {
      clearTimeout(killer);
      if (e.name === "AbortError") return { error: "Timed out after 90s. Check your connection and try again." };
      return { error: "Couldn't reach the API — this is usually no internet, or the request was blocked by the browser. Try again on a different connection." };
    }
    clearTimeout(killer);
    if (res.status === 401) {
      localStorage.removeItem(LS.apiKey);
      const nk = prompt("That API key was rejected (401). Paste a valid Anthropic API key — get one at console.anthropic.com → API Keys (starts with sk-ant-):");
      if (nk && nk.trim()) { localStorage.setItem(LS.apiKey, nk.trim()); return askClaude(question, scopeId); }
      return { error: "API key rejected and cleared. Tap ⚙️ (top right) → Claude API key to set a valid one." };
    }
    if (!res.ok) return { error: `API error ${res.status}: ${await res.text()}` };
    const data = await res.json();
    const full = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return splitStateUpdate(full);
  }

  function splitStateUpdate(text) {
    const m = text.match(/```json\s*([\s\S]*?)```/);
    let update = null, prose = text;
    if (m) {
      prose = text.replace(m[0], "").trim();
      try { update = JSON.parse(m[1]).stateUpdate || null; } catch { update = null; }
    }
    return { prose, update };
  }

  /* --------------------------------------------------------- APPLY UPDATES */
  function applyChip(chip) {
    const today0 = today();
    if (chip.kind === "decision") {
      state.decisions.push({ date: chip.item.date || today0, text: chip.item.text, scope: chip.item.scope || "global", src: "claude" });
    }
    if (chip.kind === "candidateUpdate") {
      const c = state.candidates.find((x) => x.id === chip.item.id);
      if (c) {
        ["status", "deadReason", "priceAED", "verdict", "sellerName", "source", "vin", "location"].forEach((k) => {
          if (chip.item[k] !== undefined && chip.item[k] !== null && chip.item[k] !== "") c[k] = chip.item[k];
        });
        if (chip.item.stars !== undefined && chip.item.stars !== null) c.stars = Math.max(0, Math.min(5, chip.item.stars));
        if (chip.item.stage && STAGES.includes(chip.item.stage)) c.stage = chip.item.stage;
        (chip.item.factsAdd || []).forEach((f) => { c.facts = c.facts || []; c.facts.push(f); });
        (chip.item.openItemsAdd || []).forEach((o) => { c.openItems = c.openItems || []; c.openItems.push(o); });
        (chip.item.openItemsDone || []).forEach((o) => { c.openItems = (c.openItems || []).filter((x) => x !== o); });
      }
    }
    if (chip.kind === "newCandidate") {
      const id = "c" + (state.candidates.length + 1) + "_" + Date.now().toString(36).slice(-3);
      state.candidates.push(Object.assign(
        { id, status: "active", stars: 3, stage: "Spotted", sellerName: "", source: "—", photo: "", facts: [], openItems: [] },
        chip.item
      ));
    }
    if (chip.kind === "setPhoto") {
      const im = lastAskImages[chip.item.imageIndex || 0];
      if (im) b64ToCover(im.b64).then((cover) => setCoverPhoto(chip.item.id, cover));
    }
    if (chip.kind === "nextActionAdd") {
      state.nextActions.push({ id: "n" + Date.now().toString(36), text: chip.item, done: false });
    }
    if (chip.kind === "nextActionDone") {
      const n = state.nextActions.find((x) => x.text === chip.item);
      if (n) n.done = true;
    }
    save();
    renderCaseFile();
  }

  function chipsFromUpdate(u) {
    const chips = [];
    (u.decisions || []).forEach((d) => chips.push({ kind: "decision", item: d, label: "📌 " + d.text }));
    (u.candidateUpdates || []).forEach((c) => chips.push({ kind: "candidateUpdate", item: c, label: "✏️ " + c.id + ": " + summarizeCU(c) }));
    (u.newCandidates || []).forEach((c) => chips.push({ kind: "newCandidate", item: c, label: "➕ New: " + c.title + (c.priceAED ? " — AED " + c.priceAED : "") }));
    (u.setPhoto || []).forEach((p) => chips.push({ kind: "setPhoto", item: p, label: "🖼 Set cover photo for " + p.id }));
    (u.nextActionsAdd || []).forEach((t) => chips.push({ kind: "nextActionAdd", item: t, label: "☐ " + t }));
    (u.nextActionsDone || []).forEach((t) => chips.push({ kind: "nextActionDone", item: t, label: "☑ done: " + t }));
    return chips;
  }
  function summarizeCU(c) {
    const bits = [];
    if (c.status) bits.push("status→" + c.status);
    if (c.stage) bits.push("stage→" + c.stage);
    if (c.stars !== undefined && c.stars !== null) bits.push(c.stars + "★");
    if (c.priceAED) bits.push("price " + c.priceAED);
    if (c.sellerName) bits.push("seller: " + c.sellerName);
    if (c.source) bits.push("via " + c.source);
    if (c.factsAdd) bits.push(c.factsAdd.length + " fact(s)");
    if (c.openItemsDone) bits.push(c.openItemsDone.length + " item(s) closed");
    if (c.openItemsAdd) bits.push(c.openItemsAdd.length + " item(s) opened");
    if (c.verdict) bits.push("verdict updated");
    return bits.join(", ") || "update";
  }

  /* ---------------------------------------------------------- LOG COMPRESSION */
  async function compressLog() {
    const apiKey = localStorage.getItem(LS.apiKey);
    if (!apiKey) return;
    const older = state.decisions.filter((d) => !d.archived).slice(0, -BRIEF_DECISIONS);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 600,
        messages: [{
          role: "user",
          content: "Compress this used-car-search decision log into ONE dense 'state of play' paragraph (facts and conclusions only, no fluff). Respond with the paragraph only.\n\nEXISTING SUMMARY: " + (state.summary || "none") + "\n\nLOG:\n" + older.map((d) => `[${d.date}/${d.scope}] ${d.text}`).join("\n")
        }]
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    state.summary = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    older.forEach((d) => (d.archived = true));
    save();
    renderCaseFile();
  }

  function promptForKey() {
    const k = prompt("Anthropic API key (stored on this device only).\nGet it at console.anthropic.com → API Keys — it starts with sk-ant-.\nNote: this is NOT your claude.ai login or GitHub token.");
    if (!k || !k.trim()) return null;
    const t = k.trim();
    if (!t.startsWith("sk-ant-")) alert("Warning: Anthropic API keys start with sk-ant-. Saved anyway — if the call fails with 401, tap ⚙️ to fix it.");
    localStorage.setItem(LS.apiKey, t);
    return t;
  }

  /* --------------------------------------------------------------------- UI */
  const root = document.getElementById("casefile-root") || (() => {
    const d = document.createElement("div"); d.id = "casefile-root"; document.body.appendChild(d); return d;
  })();

  const css = `
  #casefile-root{--ink:#1c1f26;--mut:#8a919c;--line:#eceef1;--ok:#0f766e;--warn:#b45309;--accent:#0e4f6e;--star:#d97706;--bg:#fafbfc;
    font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);max-width:680px;margin:0 auto;padding:12px}
  #casefile-root *{box-sizing:border-box}
  .cf-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .cf-head h2{font-size:18px;margin:0;letter-spacing:.2px}
  .cf-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af;flex:none}
  .cf-dot.synced{background:#16a34a}.cf-dot.saving{background:#f59e0b}.cf-dot.error{background:#dc2626}.cf-dot.notoken{background:#9ca3af}
  .cf-status{font-size:12px;color:var(--mut)}
  #cfGear{margin-left:auto;background:none;border:none;font-size:17px;padding:4px 6px;cursor:pointer}
  .cf-banner{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .cf-tabs{display:flex;gap:6px;margin-bottom:12px}
  .cf-tabs button{flex:1;padding:10px 0;border:1px solid var(--line);background:#fff;border-radius:10px;font-size:14px;font-weight:600;color:var(--mut)}
  .cf-tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .cf-mission{font-size:12.5px;color:var(--mut);padding:0 2px 10px;line-height:1.45}
  .cf-sec{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);margin:16px 0 8px;display:flex;justify-content:space-between;align-items:center}
  .cf-tgl{font-size:12px;font-weight:600;color:var(--accent);background:none;border:none;padding:4px;letter-spacing:0}
  .cf-card{border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:#fff;overflow:hidden}
  .cf-card.dead{opacity:.6}
  .cf-top{display:flex;gap:10px;padding:10px;align-items:center}
  .cf-ph{width:60px;height:60px;border-radius:9px;background:var(--bg);border:1px dashed var(--line);flex:none;display:flex;align-items:center;justify-content:center;color:#c6cbd2;font-size:20px;overflow:hidden}
  .cf-ph img{width:100%;height:100%;object-fit:cover}
  .cf-main{flex:1;min-width:0}
  .cf-ct{font-weight:600;font-size:14px;line-height:1.3}
  .cf-stars{font-size:14px;letter-spacing:1px;cursor:pointer;user-select:none;color:#dfe3e8;margin-top:1px}
  .cf-stars .on{color:var(--star)}
  .cf-meta{font-size:12px;color:var(--mut);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cf-bar{height:3px;background:var(--line);border-radius:2px;margin-top:7px;position:relative}
  .cf-bar i{position:absolute;left:0;top:0;bottom:0;background:var(--ok);border-radius:2px}
  .cf-stagelbl{font-size:11px;color:var(--accent);font-weight:700}
  .cf-detail{display:none;border-top:1px solid var(--line);padding:10px 12px;font-size:13px;background:var(--bg)}
  .cf-card.open .cf-detail{display:block}
  .cf-detail .row{padding:3px 0}
  .cf-detail .open-item{color:var(--warn);font-weight:600}
  .cf-detail .verdict{color:var(--accent);font-weight:600;padding-top:6px}
  .cf-stage{display:flex;align-items:center;margin:10px 0 4px;overflow-x:auto;padding-bottom:2px}
  .cf-stage .st{display:flex;flex-direction:column;align-items:center;flex:1;min-width:44px;cursor:pointer}
  .cf-stage .st .d{width:11px;height:11px;border-radius:50%;background:#e5e7eb;border:2px solid #e5e7eb}
  .cf-stage .st.done .d{background:var(--ok);border-color:var(--ok)}
  .cf-stage .st.cur .d{background:#fff;border-color:var(--accent);box-shadow:0 0 0 3px #dbeafe}
  .cf-stage .st span{font-size:9px;color:var(--mut);margin-top:3px;white-space:nowrap}
  .cf-stage .st.cur span{color:var(--accent);font-weight:700}
  .cf-stage .bar{height:2px;background:#e5e7eb;flex:.5;min-width:8px;margin-bottom:14px}
  .cf-edit{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  .cf-edit button{font-size:12px;padding:5px 10px;border:1px solid var(--line);border-radius:99px;background:#fff;color:var(--ink)}
  .cf-na{display:flex;gap:8px;align-items:flex-start;padding:5px 2px;font-size:14px}
  .cf-na input{margin-top:3px}
  .cf-na.done span{text-decoration:line-through;color:var(--mut)}
  .cf-log{font-size:12.5px;color:var(--mut)}
  .cf-log div{padding:4px 2px;border-bottom:1px solid var(--line)}
  .cf-gar{border:1px solid var(--line);border-radius:12px;padding:9px 12px;margin-bottom:6px;background:#fff;font-size:13px}
  .cf-gar .gr{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .cf-gar .gn{font-weight:600}
  .cf-gar .gt{font-size:11px;font-weight:700;color:#4338ca;background:#eef2ff;border-radius:99px;padding:1px 7px;flex:none}
  .cf-gar .gm{color:var(--mut);font-size:12px;margin-top:2px}
  .cf-gar a{color:var(--accent);font-weight:700;text-decoration:none}
  .cf-foot{font-size:11px;color:var(--mut);margin:4px 0 10px}
  #cfViewAsk textarea{width:100%;min-height:110px;border:1px solid var(--line);border-radius:10px;padding:12px;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;resize:vertical;background:#fff;display:block}
  #cfViewAsk textarea:focus{outline:none;border-color:var(--accent)}
  .cf-askrow{display:flex;gap:6px;margin:8px 0}
  .cf-askrow select{flex:1;padding:9px;border:1px solid var(--line);border-radius:10px;font-size:16px;font-family:inherit;background:#fff}
  .cf-btn{padding:10px 14px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:14px}
  .cf-btn.ghost{background:#fff;color:var(--accent);border:1px solid var(--accent)}
  .cf-btn:disabled{opacity:.5}
  .cf-thumbs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
  .cf-thumbs img{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
  .cf-ans{white-space:pre-wrap;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;padding:10px 12px;margin-top:10px;font-size:14px;background:#fff}
  .cf-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:7px 10px;margin-top:6px;font-size:13px;background:var(--bg)}
  .cf-chip span{flex:1}
  .cf-chip button{border:none;border-radius:8px;width:30px;height:30px;font-size:15px;flex:none}
  .cf-chip .yes{background:#ecfdf5;color:var(--ok)}
  .cf-chip .no{background:#fef2f2;color:#b91c1c}
  .cf-chip.applied{opacity:.5}
  .cf-load{color:var(--mut);font-size:13px;margin-top:8px}
  `;
  const styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  root.innerHTML = `
    <div class="cf-head"><div class="cf-dot" id="cfDot"></div><h2>Case File</h2><span class="cf-status" id="cfStatus"></span><button id="cfGear" title="Keys">⚙️</button></div>
    <div id="cfSettings" style="display:none">
      <div class="cf-banner"><span>Update stored keys for this device.</span></div>
      <div class="cf-askrow">
        <button class="cf-btn ghost" id="cfSetApi" style="flex:1">Claude API key</button>
        <button class="cf-btn ghost" id="cfSetGh" style="flex:1">GitHub token</button>
      </div>
    </div>
    <div id="cfBanners"></div>
    <div class="cf-tabs">
      <button id="cfTabFile" class="on">Case file</button>
      <button id="cfTabAsk">Ask</button>
    </div>
    <div id="cfViewFile"></div>
    <div id="cfViewAsk" style="display:none">
      <div class="cf-askrow"><select id="cfScope"></select></div>
      <textarea id="cfQ" placeholder="Type a question — or just attach photos and hit Ask"></textarea>
      <div class="cf-thumbs" id="cfThumbs"></div>
      <div class="cf-askrow">
        <button class="cf-btn ghost" id="cfPhotoBtn">📷 Photos</button>
        <input type="file" id="cfPhotoIn" accept="image/*" multiple style="display:none">
        <button class="cf-btn" id="cfAskBtn" style="flex:1">Ask</button>
      </div>
      <div id="cfOut"></div>
    </div>
    <input type="file" id="cfCoverIn" accept="image/*" style="display:none">`;

  const $ = (id) => document.getElementById(id);
  let coverTarget = null;

  /* Settings (⚙️): update keys any time */
  $("cfGear").onclick = () => {
    const s = $("cfSettings");
    s.style.display = s.style.display === "none" ? "" : "none";
  };
  $("cfSetApi").onclick = () => {
    const cur = localStorage.getItem(LS.apiKey);
    const k = prompt("Anthropic API key from console.anthropic.com (starts with sk-ant-):" + (cur ? "\nCurrently set: " + cur.slice(0, 12) + "…" : ""));
    if (k === null) return;
    const t = k.trim();
    if (!t) { localStorage.removeItem(LS.apiKey); alert("API key cleared."); return; }
    if (!t.startsWith("sk-ant-")) alert("Warning: Anthropic API keys start with sk-ant-. Saved anyway — if calls fail, double-check you copied it from console.anthropic.com → API Keys.");
    localStorage.setItem(LS.apiKey, t);
    alert("API key updated.");
    $("cfSettings").style.display = "none";
  };
  $("cfSetGh").onclick = () => {
    const t = prompt("GitHub fine-grained token (Contents read/write on " + GH.repo + "):");
    if (t === null) return;
    const v2 = t.trim();
    if (!v2) { localStorage.removeItem(LS.ghToken); syncStatus = "notoken"; renderStatus(); return; }
    localStorage.setItem(LS.ghToken, v2);
    ghGet().then(() => ghPut()).catch(() => ghPut());
    $("cfSettings").style.display = "none";
  };

  $("cfCoverIn").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !coverTarget) return;
    try {
      const b64 = await fileToScaledJpeg(f, 640, 0.75);
      await setCoverPhoto(coverTarget, b64);
    } catch { alert("Couldn't read that image."); }
    coverTarget = null;
  };

  function renderStatus() {
    const dot = $("cfDot"); if (!dot) return;
    dot.className = "cf-dot " + syncStatus;
    $("cfStatus").textContent =
      syncStatus === "synced" ? "saved to repo" :
      syncStatus === "saving" ? "saving…" :
      syncStatus === "error" ? "sync failed — data safe locally" :
      syncStatus === "notoken" ? "local only" : "";
    renderBanners();
  }

  function renderBanners() {
    const b = $("cfBanners"); b.innerHTML = "";
    if (!localStorage.getItem(LS.ghToken)) {
      b.innerHTML += `<div class="cf-banner"><span>Not synced to GitHub — this device only.</span><button class="cf-btn ghost" id="cfTokBtn">Connect</button></div>`;
      $("cfTokBtn").onclick = () => {
        const t = prompt("Paste your GitHub fine-grained token (Contents read/write on " + GH.repo + "):");
        if (t) { localStorage.setItem(LS.ghToken, t.trim()); ghGet().then(() => ghPut()).catch(() => ghPut()); }
      };
    }
    const unarchived = state ? state.decisions.filter((d) => !d.archived).length : 0;
    if (unarchived > COMPRESS_AFTER) {
      b.innerHTML += `<div class="cf-banner"><span>Decision log is long (${unarchived}). Compress older entries?</span><button class="cf-btn ghost" id="cfCompBtn">Compress</button></div>`;
      $("cfCompBtn").onclick = compressLog;
    }
  }

  function starsHtml(c, small) {
    let h = `<div class="cf-stars" data-stars="${c.id}">`;
    for (let i = 1; i <= 5; i++) h += `<span class="${i <= (c.stars || 0) ? "on" : ""}" data-v="${i}">★</span>`;
    return h + `</div>`;
  }

  function stageDots(c) {
    const cur = STAGES.indexOf(c.stage);
    let h = `<div class="cf-stage" data-stage="${c.id}">`;
    STAGES.forEach((s, i) => {
      if (i > 0) h += `<div class="bar"></div>`;
      h += `<div class="st ${i < cur ? "done" : ""} ${i === cur ? "cur" : ""}" data-s="${s}"><div class="d"></div><span>${s}</span></div>`;
    });
    return h + `</div>`;
  }

  function candCard(c) {
    const alive = c.status === "active";
    const pct = alive ? Math.round(((STAGES.indexOf(c.stage) + 1) / STAGES.length) * 100) : 0;
    const photo = c.photo && photoCache[c.photo]
      ? `<img src="${photoCache[c.photo]}" alt="">`
      : (alive ? "🚗" : "✝");
    let d = "";
    (c.facts || []).forEach((f) => (d += `<div class="row">· ${esc(f)}</div>`));
    (c.openItems || []).forEach((o) => (d += `<div class="row open-item">⚠ ${esc(o)}</div>`));
    if (c.deadReason) d += `<div class="row">✝ ${esc(c.deadReason)}</div>`;
    if (c.verdict) d += `<div class="row verdict">→ ${esc(c.verdict)}</div>`;
    const detailExtras = alive ? `
      ${stageDots(c)}
      <div class="cf-edit">
        <button data-cover="${c.id}">📷 Cover photo</button>
        <button data-seller="${c.id}">${c.sellerName ? "Seller: " + esc(c.sellerName) : "+ Seller"}</button>
        <button data-src="${c.id}">Source: ${esc(c.source || "—")}</button>
      </div>
      <div class="row" style="color:var(--mut);font-size:12px;padding-top:6px">${c.vin ? "VIN " + esc(c.vin) + " · " : ""}${esc(c.location || "")}</div>` : "";
    return `<div class="cf-card ${c.status}" data-cid="${c.id}">
      <div class="cf-top">
        <div class="cf-ph" data-ph="${c.id}">${photo}</div>
        <div class="cf-main">
          <div class="cf-ct">${esc(c.title)}</div>
          ${alive ? starsHtml(c) : ""}
          <div class="cf-meta">${c.priceAED ? "AED " + c.priceAED.toLocaleString() : ""}${alive ? ` · <span class="cf-stagelbl">${esc(c.stage)}</span>` : ""}</div>
          ${alive ? `<div class="cf-bar"><i style="width:${pct}%"></i></div>` : ""}
        </div>
      </div>
      <div class="cf-detail">${detailExtras}${d}</div></div>`;
  }

  function renderCaseFile() {
    const v = $("cfViewFile");
    const act = state.candidates.filter((c) => c.status === "active").slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    const dead = state.candidates.filter((c) => c.status === "dead");
    let h = `<div class="cf-mission">${esc(state.mission)}</div>`;

    h += `<div class="cf-sec"><span>Next actions</span></div>`;
    state.nextActions.filter((n) => !n.done).forEach((n) => {
      h += `<label class="cf-na"><input type="checkbox" data-na="${n.id}"><span>${esc(n.text)}</span></label>`;
    });

    h += `<div class="cf-sec"><span>Candidates (${act.length})</span></div>`;
    act.forEach((c) => (h += candCard(c)));

    h += `<div class="cf-sec"><span>Dead candidates (${dead.length})</span><button class="cf-tgl" data-tgl="dead">${showDead ? "hide" : "show"}</button></div>`;
    if (showDead) dead.forEach((c) => (h += candCard(c)));

    h += `<div class="cf-sec"><span>Garages</span><button class="cf-tgl" data-tgl="gar">${showGarages ? "hide" : "show"}</button></div>`;
    if (showGarages) {
      GARAGES.slice().sort((a, b) => kmFromOffice(a.lat, a.lng) - kmFromOffice(b.lat, b.lng)).forEach((g) => {
        h += `<div class="cf-gar">
          <div class="gr"><span class="gn">${esc(g.name)}</span><span class="gt">${esc(g.type)}</span></div>
          <div class="gm">${esc(g.use)}</div>
          <div class="gm">${esc(g.area)} · ~${kmFromOffice(g.lat, g.lng).toFixed(1)} km from office · <a href="tel:${g.phone}">${esc(g.phoneDisplay)}</a></div>
        </div>`;
      });
      h += `<div class="cf-foot">Distances are straight-line from Meydan. Locations via Google — confirm hours before driving.</div>`;
    }

    if (state.summary) h += `<div class="cf-sec"><span>State of play</span></div><div class="cf-gar" style="font-size:13px">${esc(state.summary)}</div>`;

    const dec = state.decisions.filter((d) => !d.archived).slice().reverse();
    const shown = showAllLog ? dec : dec.slice(0, 5);
    h += `<div class="cf-sec"><span>Decision log (${dec.length})</span>${dec.length > 5 ? `<button class="cf-tgl" data-tgl="log">${showAllLog ? "less" : "all"}</button>` : ""}</div><div class="cf-log">`;
    shown.forEach((d) => (h += `<div>[${esc(d.date)}${d.scope !== "global" ? " · " + esc(d.scope) : ""}] ${esc(d.text)}</div>`));
    h += `</div>`;
    v.innerHTML = h;

    /* interactions */
    v.querySelectorAll("[data-tgl]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.tgl === "dead") showDead = !showDead;
        if (btn.dataset.tgl === "gar") showGarages = !showGarages;
        if (btn.dataset.tgl === "log") showAllLog = !showAllLog;
        renderCaseFile();
      };
    });
    v.querySelectorAll("[data-na]").forEach((cb) => {
      cb.onchange = () => {
        const n = state.nextActions.find((x) => x.id === cb.dataset.na);
        n.done = true;
        state.decisions.push({ date: today(), text: "Done: " + n.text, scope: "global", src: "atir" });
        save(); renderCaseFile();
      };
    });
    v.querySelectorAll(".cf-card[data-cid] .cf-top").forEach((top) => {
      top.onclick = () => top.parentElement.classList.toggle("open");
    });
    v.querySelectorAll("[data-stars]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const c = byId(el.dataset.stars);
        const val = +e.target.dataset.v;
        if (!val) return;
        c.stars = c.stars === val ? val - 1 : val;
        save(); renderCaseFile();
      };
    });
    v.querySelectorAll("[data-stage]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const st = e.target.closest(".st");
        if (!st) return;
        const c = byId(el.dataset.stage);
        if (c.stage !== st.dataset.s) {
          c.stage = st.dataset.s;
          state.decisions.push({ date: today(), text: shortTitle(c) + " stage → " + c.stage, scope: c.id, src: "atir" });
          save(); renderCaseFile();
        }
      };
    });
    v.querySelectorAll("[data-src]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const c = byId(el.dataset.src);
        c.source = SOURCES[(SOURCES.indexOf(c.source || "—") + 1) % SOURCES.length];
        save(); renderCaseFile();
      };
    });
    v.querySelectorAll("[data-seller]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const c = byId(el.dataset.seller);
        const n = prompt("Seller name:", c.sellerName || "");
        if (n !== null) { c.sellerName = n.trim(); save(); renderCaseFile(); }
      };
    });
    v.querySelectorAll("[data-cover]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        coverTarget = el.dataset.cover;
        $("cfCoverIn").click();
      };
    });
    renderScopeOptions();
    renderBanners();
  }

  const byId = (id) => state.candidates.find((x) => x.id === id);
  const today = () => new Date().toISOString().slice(0, 10);
  const shortTitle = (c) => c.title.length > 34 ? c.title.slice(0, 32) + "…" : c.title;

  function renderScopeOptions() {
    const sel = $("cfScope"); const cur = sel.value;
    sel.innerHTML = `<option value="general">General question</option><option value="newlisting">🆕 New listing (paste photos)</option>`;
    state.candidates.filter((c) => c.status === "active").forEach((c) => {
      sel.innerHTML += `<option value="${c.id}">${esc(c.title)}</option>`;
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* Tabs */
  $("cfTabFile").onclick = () => switchTab(true);
  $("cfTabAsk").onclick = () => switchTab(false);
  function switchTab(file) {
    $("cfTabFile").classList.toggle("on", file);
    $("cfTabAsk").classList.toggle("on", !file);
    $("cfViewFile").style.display = file ? "" : "none";
    $("cfViewAsk").style.display = file ? "none" : "";
  }

  /* Photos in Ask */
  $("cfPhotoBtn").onclick = () => $("cfPhotoIn").click();
  $("cfPhotoIn").onchange = async (e) => {
    for (const f of e.target.files) {
      try {
        const b64 = await fileToScaledJpeg(f);
        pendingImages.push({ b64, name: f.name });
      } catch { /* skip unreadable */ }
    }
    e.target.value = "";
    renderThumbs();
  };
  function renderThumbs() {
    $("cfThumbs").innerHTML = pendingImages
      .map((im, i) => `<img src="data:image/jpeg;base64,${im.b64}" data-i="${i}" title="tap to remove">`).join("");
    $("cfThumbs").querySelectorAll("img").forEach((img) => {
      img.onclick = () => { pendingImages.splice(+img.dataset.i, 1); renderThumbs(); };
    });
  }

  /* Ask */
  $("cfAskBtn").onclick = async () => {
    const q = $("cfQ").value.trim();
    const scope = $("cfScope").value;
    if (!q && !pendingImages.length) return;
    $("cfAskBtn").disabled = true;
    const n = pendingImages.length;
    let secs = 0;
    $("cfOut").innerHTML = `<div class="cf-load" id="cfTick">Thinking… (brief + ${n} photo${n === 1 ? "" : "s"}) — 0s</div>`;
    const tick = setInterval(() => {
      secs++;
      const el = $("cfTick");
      if (el) el.textContent = `Thinking… (brief + ${n} photo${n === 1 ? "" : "s"}) — ${secs}s`;
    }, 1000);

    let r;
    try {
      r = await askClaude(q, scope);
    } catch (e) {
      console.error(e);
      r = { error: "Something broke while asking: " + (e.message || e) };
    } finally {
      clearInterval(tick);
      $("cfAskBtn").disabled = false;
    }
    if (r.error) { $("cfOut").innerHTML = `<div class="cf-ans">⚠ ${esc(r.error)}</div>`; return; }

    lastAskImages = pendingImages.slice();

    state.qa[scope] = state.qa[scope] || [];
    state.qa[scope].push({ q, a: r.prose, ts: Date.now() });
    state.qa[scope] = state.qa[scope].slice(-10);
    save();

    $("cfOut").innerHTML = `<div class="cf-ans">${esc(r.prose)}</div>`;
    if (r.update) {
      const chips = chipsFromUpdate(r.update);
      if (chips.length) {
        const wrap = document.createElement("div");
        wrap.innerHTML = `<div class="cf-sec"><span>Proposed updates — tap ✓ to commit</span></div>`;
        chips.forEach((chip) => {
          const el = document.createElement("div");
          el.className = "cf-chip";
          el.innerHTML = `<span>${esc(chip.label)}</span><button class="yes">✓</button><button class="no">✗</button>`;
          el.querySelector(".yes").onclick = () => { applyChip(chip); el.classList.add("applied"); el.querySelectorAll("button").forEach((b) => (b.disabled = true)); };
          el.querySelector(".no").onclick = () => { el.classList.add("applied"); el.querySelectorAll("button").forEach((b) => (b.disabled = true)); };
          wrap.appendChild(el);
        });
        $("cfOut").appendChild(wrap);
      }
    }
    $("cfQ").value = "";
    pendingImages = [];
    renderThumbs();
  };

  function renderAll() { renderStatus(); renderCaseFile(); }

  /* Public API */
  window.CaseFile = {
    getState: () => state,
    save,
    ask: askClaude,
    compileBrief,
    setApiKey: (k) => localStorage.setItem(LS.apiKey, k),
    setGithubToken: (t) => { localStorage.setItem(LS.ghToken, t); ghGet().then(() => ghPut()); }
  };

  init();
})();
