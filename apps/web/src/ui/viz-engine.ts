// Shared CSP-safe, theme-proof interactive floating tooltip & chart focus engine.
// Populates strictly with textContent (never innerHTML) so zero XSS is possible.

let tooltipEl: HTMLDivElement | null = null;
let pinned = false;
let initialized = false;

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
  const el = document.createElement("div");
  el.id = "viz-tooltip";
  el.className = "viz-tip";
  el.setAttribute("role", "tooltip");
  el.hidden = true;

  const title = document.createElement("div");
  title.className = "viz-tip-title";
  const body = document.createElement("div");
  body.className = "viz-tip-body";
  const sub = document.createElement("div");
  sub.className = "viz-tip-sub";

  el.appendChild(title);
  el.appendChild(body);
  el.appendChild(sub);
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

export function hideVizTooltip(): void {
  pinned = false;
  if (tooltipEl) tooltipEl.hidden = true;
}

function positionTooltip(el: HTMLDivElement, clientX: number, clientY: number): void {
  el.hidden = false;
  const rect = el.getBoundingClientRect();
  const pad = 12;
  let left = clientX + 14;
  let top = clientY - rect.height - 14;
  if (left + rect.width + pad > window.innerWidth) {
    left = Math.max(pad, clientX - rect.width - 14);
  }
  if (top < pad) {
    top = Math.min(window.innerHeight - rect.height - pad, clientY + 18);
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function showTooltipForTarget(target: HTMLElement | SVGElement, clientX: number, clientY: number): void {
  const titleText = target.getAttribute("data-tip-title") || "";
  const bodyText = target.getAttribute("data-tip-body") || "";
  const subText = target.getAttribute("data-tip-sub") || "";
  if (!titleText && !bodyText) return;

  const el = ensureTooltip();
  const titleEl = el.children[0] as HTMLDivElement;
  const bodyEl = el.children[1] as HTMLDivElement;
  const subEl = el.children[2] as HTMLDivElement;

  titleEl.textContent = titleText;
  titleEl.hidden = !titleText;
  bodyEl.textContent = bodyText;
  bodyEl.hidden = !bodyText;
  subEl.textContent = subText;
  subEl.hidden = !subText;

  positionTooltip(el, clientX, clientY);
}

export function initVizInteractions(): void {
  if (initialized) return;
  initialized = true;

  document.addEventListener("pointermove", (ev) => {
    if (pinned || ev.pointerType === "touch") return;
    const raw = ev.target as Element | null;
    const target = raw?.closest?.("[data-tip-title], [data-tip-body]") as HTMLElement | SVGElement | null;
    if (!target) {
      if (tooltipEl && !tooltipEl.hidden) tooltipEl.hidden = true;
      return;
    }
    showTooltipForTarget(target, ev.clientX, ev.clientY);
  });

  document.addEventListener("pointerdown", (ev) => {
    const raw = ev.target as Element | null;
    const target = raw?.closest?.("[data-tip-title], [data-tip-body]") as HTMLElement | SVGElement | null;
    if (!target) {
      hideVizTooltip();
      return;
    }
    if (ev.pointerType === "touch") {
      pinned = true;
      showTooltipForTarget(target, ev.clientX, ev.clientY);
    }
  });

  document.addEventListener("focusin", (ev) => {
    const raw = ev.target as Element | null;
    const target = raw?.closest?.("[data-tip-title], [data-tip-body]") as HTMLElement | SVGElement | null;
    if (!target) return;
    const r = target.getBoundingClientRect();
    showTooltipForTarget(target, r.left + r.width / 2, r.top);
  });

  document.addEventListener("focusout", () => {
    if (!pinned) hideVizTooltip();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideVizTooltip();
  });

  window.addEventListener("scroll", () => {
    if (tooltipEl && !tooltipEl.hidden) hideVizTooltip();
  }, { passive: true });
}
