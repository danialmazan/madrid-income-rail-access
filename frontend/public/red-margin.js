(function (global) {
  "use strict";
  const namespace = "RedMargin";
  const rootSelector = '[data-style="red-margin"]';

  function initReveal(root = document) {
    const elements = [...root.querySelectorAll(`${rootSelector} .reveal, ${rootSelector}.reveal`)];
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in global)) {
      elements.forEach(element => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }), { threshold: .1, rootMargin: "0px 0px -4%" });
    elements.forEach(element => observer.observe(element));
  }

  function initTooltips(root = document) {
    root.querySelectorAll(`${rootSelector} [data-tooltip-host]`).forEach(host => {
      if (host.dataset.tooltipReady === "true") return;
      host.dataset.tooltipReady = "true";
      let tip = host.querySelector(":scope > .chart-tooltip");
      if (!tip) {
        tip = document.createElement("div");
        tip.className = "chart-tooltip";
        tip.hidden = true;
        host.appendChild(tip);
      }
      const show = (target, event) => {
        if (!target?.dataset.tooltip) { tip.hidden = true; return; }
        tip.textContent = target.dataset.tooltip;
        tip.hidden = false;
        const rect = host.getBoundingClientRect();
        const x = (event?.clientX ?? rect.left + 18) - rect.left;
        const y = (event?.clientY ?? rect.top + 18) - rect.top;
        tip.style.left = `${Math.max(8, Math.min(x + 12, host.clientWidth - tip.offsetWidth - 8))}px`;
        tip.style.top = `${Math.max(8, Math.min(y - tip.offsetHeight - 12, host.clientHeight - tip.offsetHeight - 8))}px`;
      };
      host.querySelectorAll("[data-tooltip]").forEach(target => {
        if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
        if (!target.hasAttribute("aria-label")) target.setAttribute("aria-label", target.dataset.tooltip);
      });
      host.addEventListener("pointermove", event => show(event.target.closest("[data-tooltip]"), event));
      host.addEventListener("pointerleave", () => { tip.hidden = true; });
      host.addEventListener("focusin", event => show(event.target.closest("[data-tooltip]")));
      host.addEventListener("focusout", () => { tip.hidden = true; });
    });
  }

  function initLanguageSwitch({ defaultLanguage = "en", onChange } = {}) {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    const params = new URL(location.href).searchParams;
    let language = ["en", "es"].includes(params.get("lang")) ? params.get("lang") : defaultLanguage;
    const setLanguage = (next, updateUrl = true) => {
      if (!["en", "es"].includes(next)) return;
      language = next;
      document.documentElement.lang = next;
      root.querySelectorAll("[data-copy-en][data-copy-es]").forEach(element => {
        element.textContent = element.dataset[next === "es" ? "copyEs" : "copyEn"];
      });
      root.querySelectorAll("button[data-lang]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.lang === next));
      });
      if (updateUrl) {
        const url = new URL(location.href);
        next === defaultLanguage ? url.searchParams.delete("lang") : url.searchParams.set("lang", next);
        history.replaceState({}, "", url);
      }
      onChange?.(next);
    };
    root.querySelectorAll("button[data-lang]").forEach(button => button.addEventListener("click", () => setLanguage(button.dataset.lang)));
    setLanguage(language, false);
    return { setLanguage, get language() { return language; } };
  }

  function fontAvailable(font) {
    const context = document.createElement("canvas").getContext("2d");
    const sample = "mmmmmmmmlliiWWWÁñ0123456789";
    return ["serif", "sans-serif", "monospace"].some(baseline => {
      context.font = `72px ${baseline}`;
      const reference = context.measureText(sample).width;
      context.font = `72px "${font}", ${baseline}`;
      return Math.abs(context.measureText(sample).width - reference) > .2;
    });
  }

  async function renderFontReport() {
    await document.fonts.ready;
    const rows = [...document.querySelectorAll(`${rootSelector} [data-font-candidate]`)];
    const results = [];
    for (const row of rows) {
      const font = row.dataset.fontCandidate;
      const style = row.dataset.fontStyle || "normal";
      const weight = row.dataset.fontWeight || "400";
      const generic = ["serif", "sans-serif", "monospace", "system-ui", "ui-monospace"].includes(font);
      if (!generic) {
        try { await document.fonts.load(`${style} ${weight} 24px "${font}"`, "España · 2026"); }
        catch { /* A blocked font request is reported through the fallback status below. */ }
      }
      const loaded = !generic && [...document.fonts].some(face =>
        face.family.replace(/^["']|["']$/g, "") === font && face.status === "loaded" && face.style === style
      );
      const available = generic || loaded || fontAvailable(font);
      const status = row.querySelector("[data-font-status]");
      if (status) {
        status.textContent = generic ? "Generic fallback" : loaded ? "Webfont loaded" : style === "italic" && available ? "Local face; italic unverified" : available ? "Available locally" : "Fallback in use";
        status.dataset.available = String(available);
      }
      results.push({ font, style, available, loaded });
    }
    return results;
  }

  function init(root = document) { initReveal(root); initTooltips(root); }
  global[namespace] = { init, initReveal, initTooltips, initLanguageSwitch, renderFontReport };
})(window);
