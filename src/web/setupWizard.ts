import type { History } from "../history.js";
import { applySetup, BROKER_NAME, checkImport, GUIDES, type BrokerId, type ImportCheck, type SetupAnswers } from "../setup.js";

/**
 * Oberfläche des Einrichtungsassistenten (UMSETZUNG 3.1) als modaler Dialog:
 * 1 Broker wählen · 2 Export holen · 3 Datei reinziehen mit Sofortprüfung · 4 drei Fragen · danach das Ergebnis.
 */

export interface WizardDeps {
  history: () => History;
  /** speichert eine geprüfte Datei in der Historie; liefert eine kurze Rückmeldung */
  storeFile: (name: string, text: string) => string;
  /** übernimmt die Antworten (bereits geprüft) und zeigt danach das Ergebnis */
  finish: (history: History) => void;
  today: () => string;
}

interface Loaded {
  name: string;
  check: ImportCheck;
  stored: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const deDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const STEPS = ["Broker", "Export holen", "Datei prüfen", "Drei Fragen"];

export function initSetupWizard(deps: WizardDeps): { open: () => void } {
  const dialog = document.getElementById("setup") as HTMLDialogElement;
  const body = document.getElementById("setupBody") as HTMLElement;
  let step = 0;
  let broker: BrokerId | null = null;
  let loaded: Loaded[] = [];
  let error = "";

  const progress = () =>
    `<ol class="steps">${STEPS.map((s, i) => `<li class="${i === step ? "now" : i < step ? "done" : ""}">${i + 1}. ${s}</li>`).join("")}</ol>`;

  function render() {
    const guide = broker ? GUIDES[broker] : null;
    let html = progress();
    if (step === 0) {
      html +=
        `<h2 id="setupTitle">Bei welchem Broker handelst du?</h2>` +
        `<p class="sub">Du kannst später weitere Broker dazunehmen. Ein Konto brauchst du nicht, alles bleibt auf diesem Gerät.</p>` +
        `<div class="brokers">${(Object.keys(GUIDES) as BrokerId[])
          .map((id) => `<button type="button" class="brokerBtn" data-broker="${id}"><b>${BROKER_NAME[id]}</b><small>${esc(GUIDES[id].title)}</small></button>`)
          .join("")}</div>`;
    } else if (step === 1 && guide) {
      html +=
        `<h2 id="setupTitle">So holst du den Export</h2>` +
        `<h3>Checkliste</h3><ul class="check">${guide.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` +
        `<h3>Schritte</h3><ol class="guide">${guide.steps
          .map((s) => `<li><p>${esc(s.text)}</p><div class="shot" role="img" aria-label="Platz für Screenshot: ${esc(s.shot)}">Screenshot folgt: ${esc(s.shot)}</div></li>`)
          .join("")}</ol>` +
        `<p class="src">Quelle: ${guide.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(", ")}. Menünamen können sich mit neuen App-Versionen ändern.</p>`;
    } else if (step === 2 && guide) {
      html +=
        `<h2 id="setupTitle">Datei reinziehen</h2>` +
        `<p class="sub">Die App prüft die Datei sofort und sagt dir, was fehlt. Mehrere Dateien sind möglich, z. B. eine je Jahr.</p>` +
        `<div class="dropzone" id="setupDrop"><label class="btn" for="setupFile">Datei wählen</label>` +
        `<input id="setupFile" type="file" multiple accept="${esc(guide.accept)}"><span>oder hierher ziehen</span></div>` +
        `<ul class="loaded">${loaded.map(renderLoaded).join("")}</ul>`;
    } else if (step === 3) {
      const s = deps.history().settings;
      const hasDeriv = loaded.some((l) => l.check.summary.hasDerivatives) || s.otherIncomeEur !== "";
      const usesTr = broker === "tr" || loaded.some((l) => l.check.broker === "Trade Republic") || deps.history().files.some((f) => f.broker === "Trade Republic");
      html +=
        `<h2 id="setupTitle">Drei Fragen</h2>` +
        `<form id="setupForm" class="qs" novalidate>` +
        `<fieldset><legend>1. Handelst du Optionen oder Futures?</legend>` +
        `<label><input type="radio" name="deriv" value="no"${hasDeriv ? "" : " checked"}> Nein</label>` +
        `<label><input type="radio" name="deriv" value="yes"${hasDeriv ? " checked" : ""}> Ja</label>` +
        (loaded.some((l) => l.check.summary.hasDerivatives) ? `<small>In deiner Datei sind Optionen oder Futures enthalten.</small>` : "") +
        `<label class="income"${hasDeriv ? "" : " hidden"}>Geschätztes sonstiges Jahreseinkommen in € <input id="setupIncome" type="number" min="0" step="100" inputmode="decimal" value="${esc(s.otherIncomeEur)}" placeholder="z. B. 30000">` +
        `<small>Zu versteuerndes Einkommen ohne Kapitalerträge, z. B. Gehalt nach Sozialversicherung. Daraus ergibt sich der Steuersatz für Optionen und Futures. Leer lassen, wenn du es nicht weißt; dann rechnet die App diesen Teil nicht.</small></label>` +
        `</fieldset>` +
        `<fieldset><legend>2. Wo liegt deine Rücklage?</legend>` +
        `<label>Freie Eingabe <input id="setupPlace" type="text" maxlength="80" value="${esc(s.reservePlace)}" placeholder="z. B. Tagesgeld bei meiner Bank"></label>` +
        `<small>Die App empfiehlt keine Anlage. Sie merkt sich nur, wo du das Geld beiseitelegst.</small></fieldset>` +
        `<fieldset><legend>3. Wie groß soll der Sicherheitspuffer sein?</legend>` +
        `<label><input id="setupBuffer" type="range" min="0" max="30" step="5" value="${s.bufferPct}"> <b id="setupBufferOut">${s.bufferPct} %</b></label>` +
        `<small>Aufschlag auf die berechnete Steuer, falls etwas fehlt oder sich ändert. Vorbelegt sind 10 %.</small></fieldset>` +
        (usesTr
          ? `<fieldset><legend>Trade Republic: Zieht Trade Republic bei dir die KESt ab (steuereinfach)?</legend>` +
            `<label><input type="radio" name="simple" value="no"${s.taxSimpleSince ? "" : " checked"}> Nein</label>` +
            `<label><input type="radio" name="simple" value="yes"${s.taxSimpleSince ? " checked" : ""}> Ja, seit <input id="setupSince" type="date" value="${esc(s.taxSimpleSince)}"></label>` +
            `<small>Das Datum der Umstellung steht in der App von Trade Republic. Erträge ab diesem Tag sind schon versteuert und zählen hier nicht.</small></fieldset>`
          : "") +
        `</form>`;
    }
    html += error ? `<p class="setupError" role="alert">${esc(error)}</p>` : "";
    const canNext = step === 0 ? false : step === 2 ? loaded.some((l) => l.check.ok) || deps.history().files.length > 0 : true;
    html +=
      `<div class="setupNav">` +
      (step > 0 ? `<button type="button" class="btn ghost" data-nav="back">Zurück</button>` : `<button type="button" class="btn ghost" data-nav="close">Erst Beispieldaten ansehen</button>`) +
      (step > 0 ? `<button type="button" class="btn" data-nav="next"${canNext ? "" : " disabled"}>${step === 3 ? "Ergebnis zeigen" : "Weiter"}</button>` : "") +
      `</div>`;
    body.innerHTML = html;
    wire();
  }

  function renderLoaded(l: Loaded): string {
    const c = l.check;
    if (!c.ok) return `<li class="bad"><b>${esc(l.name)}</b><span>${esc(c.problems.join(" "))}</span></li>`;
    const s = c.summary;
    const parts = [`${s.trades} Trades`, `${s.dividends} Dividenden`, `${s.interest} Zinsbuchungen`, `${deDate(s.from)} bis ${deDate(s.to)}`];
    const issues = [s.errors ? `${s.errors} Fehler` : "", s.warnings ? `${s.warnings} ${s.warnings === 1 ? "Warnung" : "Warnungen"}` : ""].filter(Boolean);
    return (
      `<li class="ok"><b>${esc(l.name)}</b><span>${esc(c.broker ?? "")}: ${parts.join(" · ")}. ${esc(l.stored)}</span>` +
      (c.notes.length ? `<span class="note">${esc(c.notes.join(" "))}</span>` : "") +
      (issues.length ? `<span class="note">Prüfassistent: ${issues.join(", ")}; Details stehen nach der Einrichtung unter „Buchungen prüfen“.</span>` : "") +
      `</li>`
    );
  }

  function readFiles(files: FileList | null | undefined) {
    if (!broker || !files) return;
    const b = broker;
    for (const file of files) {
      file.text().then(
        (text) => {
          const check = checkImport(text, b);
          let stored = "";
          if (check.ok) {
            try {
              stored = deps.storeFile(file.name, text);
            } catch (e) {
              check.ok = false;
              check.problems = [e instanceof Error ? e.message : String(e)];
            }
          }
          loaded = [...loaded, { name: file.name, check, stored }];
          error = "";
          render();
        },
        () => {
          error = `Die Datei „${file.name}“ konnte nicht geöffnet werden.`;
          render();
        },
      );
    }
  }

  function answers(): SetupAnswers {
    const form = body.querySelector<HTMLFormElement>("#setupForm");
    const val = (id: string) => (body.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();
    const radio = (name: string) => form?.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
    return {
      derivatives: radio("deriv") === "yes",
      otherIncomeEur: val("setupIncome"),
      reservePlace: val("setupPlace"),
      bufferPct: Number(val("setupBuffer") || "10"),
      taxSimpleSince: radio("simple") === "yes" ? val("setupSince") : "",
    };
  }

  function wire() {
    body.querySelectorAll<HTMLElement>("[data-broker]").forEach((b) =>
      b.addEventListener("click", () => {
        broker = b.dataset.broker as BrokerId;
        step = 1;
        render();
      }),
    );
    body.querySelector<HTMLElement>('[data-nav="close"]')?.addEventListener("click", () => dialog.close());
    body.querySelector<HTMLElement>('[data-nav="back"]')?.addEventListener("click", () => {
      error = "";
      step -= 1;
      render();
    });
    body.querySelector<HTMLElement>('[data-nav="next"]')?.addEventListener("click", () => {
      if (step < 3) {
        step += 1;
        error = "";
        render();
        return;
      }
      try {
        const h = applySetup(deps.history(), answers(), deps.today());
        dialog.close();
        deps.finish(h);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        render();
      }
    });
    const input = body.querySelector<HTMLInputElement>("#setupFile");
    input?.addEventListener("change", () => {
      readFiles(input.files);
      input.value = "";
    });
    const drop = body.querySelector<HTMLElement>("#setupDrop");
    drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove("over");
      readFiles(e.dataTransfer?.files);
    });
    body.querySelectorAll<HTMLInputElement>('input[name="deriv"]').forEach((r) =>
      r.addEventListener("change", () => {
        const yes = body.querySelector<HTMLInputElement>('input[name="deriv"][value="yes"]')?.checked ?? false;
        body.querySelector<HTMLElement>(".income")?.toggleAttribute("hidden", !yes);
      }),
    );
    const range = body.querySelector<HTMLInputElement>("#setupBuffer");
    range?.addEventListener("input", () => {
      const out = body.querySelector<HTMLElement>("#setupBufferOut");
      if (out) out.textContent = `${range.value} %`;
    });
    body.querySelector<HTMLInputElement>("#setupSince")?.addEventListener("focus", () => {
      const yes = body.querySelector<HTMLInputElement>('input[name="simple"][value="yes"]');
      if (yes) yes.checked = true;
    });
  }

  return {
    open() {
      step = 0;
      broker = null;
      loaded = [];
      error = "";
      render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
