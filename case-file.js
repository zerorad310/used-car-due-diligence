/* ============================================================================
 * CASE FILE MODULE — used-car-due-diligence
 * ----------------------------------------------------------------------------
 * Drop-in for index.html. Two lines to integrate:
 *
 *   <div id="casefile-root"></div>
 *   <script src="case-file.js"></script>
 *
 * What it does:
 *  - Holds ONE authoritative state object (case-file.json), pre-seeded with
 *    the full search history (candidates, dead options, rules, decisions).
 *  - Persists to localStorage instantly + syncs to the GitHub repo via the
 *    Contents API (fine-grained PAT, Contents read/write on this repo only).
 *  - "Ask" tab: question + photos → Claude API. The compiled case brief is
 *    prepended automatically to every call. You never re-explain anything.
 *  - Claude returns prose + a stateUpdate JSON block → rendered as chips.
 *    Tap ✓ to commit a chip into the case file, ✗ to discard.
 *  - Photos are auto-downscaled before upload (phone photos are huge).
 *
 * First run: banner asks for GitHub token (stored localStorage, this device
 * only) and Claude API key (localStorage 'cf_api_key'; set once per device).
 * ==========================================================================*/

(function () {
  "use strict";

  /* ------------------------------------------------------------------ CONFIG */
  const GH = { owner: "zerorad310", repo: "used-car-due-diligence", path: "case-file.json" };
  const MODEL = "claude-sonnet-4-6";
  const MAX_TOKENS = 2000;
  const LS = { state: "cf_state", ghToken: "cf_gh_token", apiKey: "cf_api_key" };
  const SAVE_DEBOUNCE_MS = 2500;
  const BRIEF_DECISIONS = 15;      // recent decisions included in every brief
  const COMPRESS_AFTER = 40;       // offer log compression past this many

  /* ------------------------------------------------------------------- SEED
   * Full history of the search as of 2026-08-25. Edit freely; once the file
   * exists in the repo, the repo copy is authoritative and SEED is ignored. */
  const SEED = {
    version: 1,
    updatedAt: "2026-08-25T00:00:00Z",
    mission:
      "One-year bridge car for Atir. Daily Dubailand→Meydan (~35 km/day, Al Ain Rd) + road trips to Oman, Saudi, Al Ain with passengers. Realistic 19–20K km/yr. Target: Mazda 6 2.5L Skyactiv-G, GCC, 2015–2018. Charger/Mustang deferred to year three.",
    hardRules: [
      "GCC spec only — VIN prefix JM6/JM7 proceed, JM1 (US) reject. Check VIN before anything else.",
      "2.5L Skyactiv-G engine only. Never infer from listing filters (1500–1999cc bracket hides 1.6L/2.0L). Confirm via VIN or mulkiya.",
      "No Sharjah registration — hard geographic exclusion.",
      "AutoTrust chassis check (800 2978) mandatory on any serious candidate.",
      "Independent ~AED 300 garage inspection (buyer's choice of garage) before any payment. Never Dubizzle Book Inspection (2.6 Trustpilot, conflict of interest).",
      "Total cost of ownership: sticker + AED 4,000–7,000 year-one risk buffer on older/high-km cars.",
      "2018–19 cars: verify rocker-arm campaign + Denso fuel pump recall via VIN at Galadari before considering."
    ],
    budget: {
      strategy: "One-year bridge purchase",
      targetAED: [18000, 22000],
      ceilingAED: 35000,
      repairReserveAED: [5000, 10000],
      note: "Sub-25K listings reliably fail at least one hard rule in this market — treat cheap listings with extra suspicion, not excitement."
    },
    candidates: [
      {
        id: "c1",
        title: "2015 Mazda 6 2.5L — Dubai (fleet disposal)",
        status: "active",
        rank: "PRIMARY",
        priceAED: 22000,
        vin: "JM7GJ4S77F1138253",
        location: "Dubai",
        facts: [
          "VIN decoded: confirmed GCC build, correct year",
          "Seller's cost basis revealed at AED 20,000",
          "No service history disclosed",
          "Fleet disposal car"
        ],
        openItems: ["Run AutoTrust on VIN before offering"],
        verdict: "Primary under the bridge plan. If AutoTrust clean → open at AED 18,500–19,500."
      },
      {
        id: "c2",
        title: "Greeshma's 2016 Mazda 6 — Barsha Heights",
        status: "active",
        rank: "SECOND",
        priceAED: 36000,
        vin: "shared (on file)",
        location: "Barsha Heights, Dubai",
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
        verdict: "Over budget at ask. Anchor AED 30–31K justified by her own disclosures. Only worth it if condition is genuinely superior to c1."
      },
      {
        id: "c3",
        title: "2019 Mazda 6 2.5L — CarSwitch",
        status: "active",
        rank: "FALLBACK",
        priceAED: 39000,
        vin: "",
        location: "Dubai (CarSwitch)",
        facts: ["~200,000 km", "2019 = check rocker-arm campaign + Denso recall at Galadari"],
        openItems: [],
        verdict: "Low rank: high mileage + high capital + worse year-end resale for a one-year plan. Watch only."
      },
      {
        id: "d1",
        title: "Azhar's 2017 S Grade — AED 24,500 / 157K km",
        status: "dead",
        priceAED: 24500,
        deadReason: "Sold to another buyer."
      },
      {
        id: "d2",
        title: "Al Jada 2017 — AED 30K (AutoTrust documented)",
        status: "dead",
        priceAED: 30000,
        deadReason: "Sharjah registration — hard exclusion. Car quality was fine; do not re-evaluate."
      },
      {
        id: "d3",
        title: "2015 Mazda 6 — AED 19,500",
        status: "dead",
        priceAED: 19500,
        deadReason: "2.0L engine, fails hard rule."
      }
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
      "WhatsApp qualification template before any visit: service records, engine bay photo, accident history, loan status, ownership story. Chassis number requested as routine."
    ],
    decisions: [
      { date: "2026-07", text: "Locked target: Mazda 6 2.5L Skyactiv-G, GCC, 2016–2018 preferred (2016–17 sweet spot).", scope: "global", src: "seed" },
      { date: "2026-07", text: "Revised annual mileage from assumed 30K to realistic 19–20K km/yr.", scope: "global", src: "seed" },
      { date: "2026-08", text: "Strategy pivot: one-year bridge purchase ~AED 18–22K with 5–10K repair reserve, instead of 28–35K keeper.", scope: "global", src: "seed" },
      { date: "2026-08", text: "Rented Mazda 6 (2024/25 base) via eZhire as reference baseline.", scope: "global", src: "seed" },
      { date: "2026-08", text: "c1 (2015 Dubai, AED 22K) made PRIMARY candidate; offer 18.5–19.5K if AutoTrust clean.", scope: "c1", src: "seed" },
      { date: "2026-08", text: "c2 (Greeshma 2016): negotiation anchor set at 30–31K from her own disclosures.", scope: "c2", src: "seed" },
      { date: "2026-08", text: "Azhar's 2017 S Grade confirmed sold — removed.", scope: "d1", src: "seed" },
      { date: "2026-08", text: "Al Jada 2017 dropped on Sharjah exclusion, not car quality.", scope: "d2", src: "seed" }
    ],
    nextActions: [
      { id: "n1", text: "Call AutoTrust (800 2978) — chassis check on JM7GJ4S77F1138253", done: false },
      { id: "n2", text: "Chase Greeshma for engine bay photo (blocker for visit)", done: false },
      { id: "n3", text: "Confirm Tue/Wed evening visit window with Greeshma", done: false },
      { id: "n4", text: "Keep monitoring Dubizzle / FB Marketplace / CarSwitch / Dubicars / Al Aweer", done: false }
    ],
    summary: "",           // rolling "state of play" once log is compressed
    qa: {}                 // per-scope Q&A history: { scopeId: [{q, a, ts}] }
  };

  /* --------------------------------------------------------------- STATE I/O */
  let state = null;
  let ghSha = null;              // sha of case-file.json in repo (needed for PUT)
  let saveTimer = null;
  let syncStatus = "local";      // local | saving | synced | error | notoken

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

  async function ghGet() {
    const token = localStorage.getItem(LS.ghToken);
    if (!token) return { missingToken: true };
    const res = await fetch(
      `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const j = await res.json();
    ghSha = j.sha;
    return { data: JSON.parse(b64ToUtf8(j.content)) };
  }

  async function ghPut(retry = true) {
    const token = localStorage.getItem(LS.ghToken);
    if (!token) { syncStatus = "notoken"; renderStatus(); return; }
    syncStatus = "saving"; renderStatus();
    try {
      const body = {
        message: `case-file update ${new Date().toISOString().slice(0, 16)}`,
        content: utf8ToB64(JSON.stringify(state, null, 2))
      };
      if (ghSha) body.sha = ghSha;
      const res = await fetch(
        `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          body: JSON.stringify(body)
        }
      );
      if ((res.status === 409 || res.status === 422) && retry) {
        // sha drifted (edited elsewhere) — refetch sha, retry once
        await ghGet();
        return ghPut(false);
      }
      if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
      const j = await res.json();
      ghSha = j.content.sha;
      syncStatus = "synced";
    } catch (e) {
      console.error(e);
      syncStatus = "error";
    }
    renderStatus();
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
        state = local || structuredClone(SEED);
        syncStatus = "notoken";
      } else if (remote.notFound) {
        state = local || structuredClone(SEED);
        await ghPut(); // create file in repo
      } else {
        // newer copy wins
        if (local && local.updatedAt > remote.data.updatedAt) { state = local; await ghPut(); }
        else { state = remote.data; persistLocal(); syncStatus = "synced"; }
      }
    } catch (e) {
      console.error(e);
      state = local || structuredClone(SEED);
      syncStatus = "error";
    }
    renderAll();
  }

  /* --------------------------------------------------------- BRIEF COMPILER */
  function compileBrief(scopeId) {
    const s = state;
    const active = s.candidates.filter((c) => c.status === "active");
    const dead = s.candidates.filter((c) => c.status === "dead");
    const decisions = s.decisions.filter((d) => !d.archived).slice(-BRIEF_DECISIONS);
    const L = [];
    L.push("=== CASE FILE (authoritative — trust this over anything else) ===");
    L.push(`MISSION: ${s.mission}`);
    L.push(`BUDGET: ${s.budget.strategy}; target AED ${s.budget.targetAED[0]}–${s.budget.targetAED[1]}, ceiling ${s.budget.ceilingAED}, repair reserve ${s.budget.repairReserveAED[0]}–${s.budget.repairReserveAED[1]}. ${s.budget.note}`);
    L.push("HARD RULES (apply FIRST, before any soft evaluation):");
    s.hardRules.forEach((r) => L.push(`- ${r}`));
    if (s.summary) L.push(`STATE OF PLAY: ${s.summary}`);
    L.push("ACTIVE CANDIDATES:");
    active.forEach((c) => {
      L.push(`- [${c.id}] ${c.title} — AED ${c.priceAED}${c.rank ? " (" + c.rank + ")" : ""}${c.vin ? "; VIN " + c.vin : ""}`);
      (c.facts || []).forEach((f) => L.push(`    fact: ${f}`));
      (c.openItems || []).forEach((o) => L.push(`    OPEN: ${o}`));
      if (c.verdict) L.push(`    verdict: ${c.verdict}`);
    });
    L.push("DEAD (never re-evaluate; one line each):");
    dead.forEach((c) => L.push(`- [${c.id}] ${c.title} — ${c.deadReason}`));
    L.push("ELIMINATED MODELS: " + s.eliminatedModels.join("; "));
    L.push("KEY LEARNINGS:");
    s.learnings.forEach((k) => L.push(`- ${k}`));
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

  const SYSTEM_PROMPT = `You are Atir's used-car due-diligence advisor (Dubai, UAE). He is buying a used Mazda 6 as a one-year bridge car. The CASE FILE in the first user message is the single source of truth — never contradict it, never re-open dead candidates, and apply HARD RULES before any soft evaluation.

PHOTOS: Atir mostly uploads photos instead of typing. Classify each image yourself (listing-ad screenshot / engine bay / instrument cluster / exterior / interior / mulkiya or documents / WhatsApp chat) and act accordingly without asking him to describe it. From listing screenshots extract: year, price, km, location, VIN or chassis if visible, seller claims — then apply hard rules immediately (VIN prefix, engine, Sharjah, price band). From engine bays flag corrosion, oil seepage, mismatched paint, missing covers. From clusters read km and warning lamps. From documents verify spec, year, registration emirate.

STYLE: Mobile-concise. Lead with the verdict, then reasons. Give exact numbers (offers in AED, km thresholds). If a hard rule fails, say REJECT plainly and stop soft analysis. Suggest exact WhatsApp wording when a seller message is the next step (warm, non-committal, chassis number requested as routine).

STATE UPDATES: End EVERY response with a fenced json block, even if empty, exactly:
\`\`\`json
{"stateUpdate":{
  "decisions":[{"date":"YYYY-MM-DD","text":"...","scope":"c1|global|<id>"}],
  "candidateUpdates":[{"id":"c1","status":"active|dead","deadReason":"...","priceAED":0,"factsAdd":["..."],"openItemsAdd":["..."],"openItemsDone":["..."],"verdict":"..."}],
  "newCandidates":[{"title":"...","priceAED":0,"vin":"...","location":"...","facts":["..."],"openItems":["..."],"verdict":"..."}],
  "nextActionsAdd":["..."],
  "nextActionsDone":["exact text of a completed action"]
}}
\`\`\`
Include ONLY keys with content. Propose updates for anything decided, learned, killed, or newly discovered in this exchange. These render as tap-to-commit chips; be precise and atomic.`;

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

  /* --------------------------------------------------------------- ASK CLAUDE */
  let pendingImages = []; // [{b64, name}]

  async function askClaude(question, scopeId) {
    const apiKey = localStorage.getItem(LS.apiKey) || promptForKey();
    if (!apiKey) return { error: "No API key set." };

    const content = [];
    pendingImages.forEach((im) =>
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.b64 } })
    );
    content.push({ type: "text", text: compileBrief(scopeId) + "\n\n=== ATIR'S QUESTION ===\n" + (question || "(photos only — analyse them)") });

    // last 3 exchanges from this scope, text-only, for thread continuity
    const history = [];
    const thread = (state.qa[scopeId] || []).slice(-3);
    thread.forEach((t) => {
      history.push({ role: "user", content: t.q || "(photos)" });
      history.push({ role: "assistant", content: t.a });
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [...history, { role: "user", content }]
      })
    });
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
    const today = new Date().toISOString().slice(0, 10);
    if (chip.kind === "decision") {
      state.decisions.push({ date: chip.item.date || today, text: chip.item.text, scope: chip.item.scope || "global", src: "claude" });
    }
    if (chip.kind === "candidateUpdate") {
      const c = state.candidates.find((x) => x.id === chip.item.id);
      if (c) {
        if (chip.item.status) c.status = chip.item.status;
        if (chip.item.deadReason) c.deadReason = chip.item.deadReason;
        if (chip.item.priceAED) c.priceAED = chip.item.priceAED;
        if (chip.item.verdict) c.verdict = chip.item.verdict;
        (chip.item.factsAdd || []).forEach((f) => { c.facts = c.facts || []; c.facts.push(f); });
        (chip.item.openItemsAdd || []).forEach((o) => { c.openItems = c.openItems || []; c.openItems.push(o); });
        (chip.item.openItemsDone || []).forEach((o) => { c.openItems = (c.openItems || []).filter((x) => x !== o); });
      }
    }
    if (chip.kind === "newCandidate") {
      const id = "c" + (state.candidates.length + 1) + "_" + Date.now().toString(36).slice(-3);
      state.candidates.push(Object.assign({ id, status: "active", facts: [], openItems: [] }, chip.item));
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
    (u.nextActionsAdd || []).forEach((t) => chips.push({ kind: "nextActionAdd", item: t, label: "☐ " + t }));
    (u.nextActionsDone || []).forEach((t) => chips.push({ kind: "nextActionDone", item: t, label: "☑ done: " + t }));
    return chips;
  }
  function summarizeCU(c) {
    const bits = [];
    if (c.status) bits.push("status→" + c.status);
    if (c.priceAED) bits.push("price " + c.priceAED);
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
    const k = prompt("Claude API key (stored on this device only):");
    if (k) localStorage.setItem(LS.apiKey, k.trim());
    return k ? k.trim() : null;
  }

  /* --------------------------------------------------------------------- UI */
  const root = document.getElementById("casefile-root") || (() => {
    const d = document.createElement("div"); d.id = "casefile-root"; document.body.appendChild(d); return d;
  })();

  const css = `
  #casefile-root{--ink:#1c1f26;--mut:#6b7280;--line:#e5e7eb;--ok:#0f766e;--dead:#9ca3af;--warn:#b45309;--accent:#0e4f6e;
    font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);max-width:680px;margin:0 auto;padding:10px}
  #casefile-root *{box-sizing:border-box}
  .cf-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .cf-head h2{font-size:17px;margin:0;letter-spacing:.2px}
  .cf-dot{width:9px;height:9px;border-radius:50%;background:#9ca3af;flex:none}
  .cf-dot.synced{background:#16a34a}.cf-dot.saving{background:#f59e0b}.cf-dot.error{background:#dc2626}.cf-dot.notoken{background:#9ca3af}
  .cf-status{font-size:12px;color:var(--mut)}
  .cf-banner{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .cf-tabs{display:flex;gap:6px;margin-bottom:10px}
  .cf-tabs button{flex:1;padding:9px 0;border:1px solid var(--line);background:#fff;border-radius:8px;font-size:14px;font-weight:600;color:var(--mut)}
  .cf-tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .cf-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff}
  .cf-card.dead{opacity:.65}
  .cf-crow{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .cf-ct{font-weight:600;font-size:14px}
  .cf-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;flex:none}
  .cf-pill.active{background:#ecfdf5;color:var(--ok)}
  .cf-pill.dead{background:#f3f4f6;color:var(--dead)}
  .cf-pill.rank{background:#eff6ff;color:var(--accent)}
  .cf-meta{font-size:12.5px;color:var(--mut);margin-top:2px}
  .cf-detail{margin-top:6px;font-size:13px;display:none}
  .cf-card.open .cf-detail{display:block}
  .cf-detail div{padding:2px 0;border-top:1px dashed var(--line)}
  .cf-detail .open-item{color:var(--warn);font-weight:600}
  .cf-detail .verdict{color:var(--accent);font-weight:600}
  .cf-sec{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin:14px 0 6px}
  .cf-na{display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:14px}
  .cf-na input{margin-top:3px}
  .cf-na.done span{text-decoration:line-through;color:var(--mut)}
  .cf-log{font-size:12.5px;color:var(--mut)}
  .cf-log div{padding:3px 0;border-bottom:1px dotted var(--line)}
  .cf-mission{font-size:13px;color:var(--mut);background:#f8fafc;border-radius:8px;padding:8px 10px;margin-bottom:10px}
  .cf-ask textarea{width:100%;min-height:70px;border:1px solid var(--line);border-radius:8px;padding:9px;font:inherit;resize:vertical}
  .cf-askrow{display:flex;gap:6px;margin:8px 0}
  .cf-askrow select{flex:1;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
  .cf-btn{padding:9px 14px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-weight:700;font-size:14px}
  .cf-btn.ghost{background:#fff;color:var(--accent);border:1px solid var(--accent)}
  .cf-btn:disabled{opacity:.5}
  .cf-thumbs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
  .cf-thumbs img{width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
  .cf-ans{white-space:pre-wrap;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:10px 12px;margin-top:10px;font-size:14px;background:#fff}
  .cf-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-top:6px;font-size:13px;background:#f8fafc}
  .cf-chip span{flex:1}
  .cf-chip button{border:none;border-radius:6px;width:30px;height:30px;font-size:15px;flex:none}
  .cf-chip .yes{background:#ecfdf5;color:var(--ok)}
  .cf-chip .no{background:#fef2f2;color:#b91c1c}
  .cf-chip.applied{opacity:.5}
  .cf-load{color:var(--mut);font-size:13px;margin-top:8px}
  `;
  const styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  root.innerHTML = `
    <div class="cf-head"><div class="cf-dot" id="cfDot"></div><h2>Case File</h2><span class="cf-status" id="cfStatus"></span></div>
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
    </div>`;

  const $ = (id) => document.getElementById(id);

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
      b.innerHTML += `<div class="cf-banner"><span>Decision log is long (${unarchived}). Compress older entries into a state-of-play summary?</span><button class="cf-btn ghost" id="cfCompBtn">Compress</button></div>`;
      $("cfCompBtn").onclick = compressLog;
    }
  }

  function renderCaseFile() {
    const v = $("cfViewFile");
    const act = state.candidates.filter((c) => c.status === "active");
    const dead = state.candidates.filter((c) => c.status === "dead");
    let h = `<div class="cf-mission">${esc(state.mission)}</div>`;

    h += `<div class="cf-sec">Next actions</div>`;
    state.nextActions.forEach((n) => {
      h += `<label class="cf-na ${n.done ? "done" : ""}"><input type="checkbox" data-na="${n.id}" ${n.done ? "checked" : ""}><span>${esc(n.text)}</span></label>`;
    });

    h += `<div class="cf-sec">Active candidates (${act.length})</div>`;
    act.forEach((c) => (h += candCard(c)));
    h += `<div class="cf-sec">Dead — do not re-evaluate (${dead.length})</div>`;
    dead.forEach((c) => (h += candCard(c)));

    if (state.summary) h += `<div class="cf-sec">State of play</div><div class="cf-card" style="font-size:13px">${esc(state.summary)}</div>`;

    const dec = state.decisions.filter((d) => !d.archived).slice().reverse();
    h += `<div class="cf-sec">Decision log (${dec.length})</div><div class="cf-log">`;
    dec.slice(0, BRIEF_DECISIONS).forEach((d) => (h += `<div>[${esc(d.date)}${d.scope !== "global" ? " · " + esc(d.scope) : ""}] ${esc(d.text)}</div>`));
    h += `</div>`;
    v.innerHTML = h;

    v.querySelectorAll("[data-na]").forEach((cb) => {
      cb.onchange = () => {
        const n = state.nextActions.find((x) => x.id === cb.dataset.na);
        n.done = cb.checked;
        if (cb.checked) state.decisions.push({ date: new Date().toISOString().slice(0, 10), text: "Done: " + n.text, scope: "global", src: "atir" });
        save(); renderCaseFile();
      };
    });
    v.querySelectorAll(".cf-card[data-cid]").forEach((card) => {
      card.onclick = () => card.classList.toggle("open");
    });
    renderScopeOptions();
    renderBanners();
  }

  function candCard(c) {
    const pills =
      `<span class="cf-pill ${c.status}">${c.status}</span>` +
      (c.rank && c.status === "active" ? `<span class="cf-pill rank">${esc(c.rank)}</span>` : "");
    let d = "";
    (c.facts || []).forEach((f) => (d += `<div>· ${esc(f)}</div>`));
    (c.openItems || []).forEach((o) => (d += `<div class="open-item">⚠ ${esc(o)}</div>`));
    if (c.verdict) d += `<div class="verdict">→ ${esc(c.verdict)}</div>`;
    if (c.deadReason) d += `<div>✝ ${esc(c.deadReason)}</div>`;
    return `<div class="cf-card ${c.status}" data-cid="${c.id}">
      <div class="cf-crow"><span class="cf-ct">${esc(c.title)}</span><span>${pills}</span></div>
      <div class="cf-meta">${c.priceAED ? "AED " + c.priceAED.toLocaleString() : ""}${c.vin ? " · VIN " + esc(c.vin) : ""}${c.location ? " · " + esc(c.location) : ""}</div>
      <div class="cf-detail">${d}</div></div>`;
  }

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

  /* Photos */
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
    $("cfOut").innerHTML = `<div class="cf-load">Thinking… (brief + ${pendingImages.length} photo${pendingImages.length === 1 ? "" : "s"} sent)</div>`;
    const r = await askClaude(q, scope);
    $("cfAskBtn").disabled = false;
    if (r.error) { $("cfOut").innerHTML = `<div class="cf-ans">⚠ ${esc(r.error)}</div>`; return; }

    state.qa[scope] = state.qa[scope] || [];
    state.qa[scope].push({ q, a: r.prose, ts: Date.now() });
    state.qa[scope] = state.qa[scope].slice(-10);
    save();

    let out = `<div class="cf-ans">${esc(r.prose)}</div>`;
    $("cfOut").innerHTML = out;
    if (r.update) {
      const chips = chipsFromUpdate(r.update);
      if (chips.length) {
        const wrap = document.createElement("div");
        wrap.innerHTML = `<div class="cf-sec">Proposed updates — tap ✓ to commit</div>`;
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

  /* Public API for the rest of index.html */
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
