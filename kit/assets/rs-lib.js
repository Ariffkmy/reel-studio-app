/* Reel Studio scene library (c) Reel Studio. Helpers for scene functions in assets/scenes.js.
 *
 *   RS.scene("hook", (s) => { ... });
 *
 * `s` gives you:
 *   s.root  the scene's 1080x1920 root element        s.tl    the scene's paused GSAP timeline
 *   s.w(i)  time (s, scene-local) of the scene's i-th spoken word (0-based, clamped)
 *   s.find("word", from=0)  index of the first scene word that matches (case/punctuation-insensitive), or -1
 *   s.words the scene's words                          s.dur   the scene's length in seconds
 *
 * Everything below only adds tweens to s.tl, so it is seek-safe (renders jump to any frame).
 * Element helpers return the element so you can keep animating it with s.tl.
 */
(function () {
  "use strict";
  const RS = (window.RS = window.RS || {});
  RS.scenes = RS.scenes || {};
  RS.scene = (id, fn) => { RS.scenes[id] = fn; };

  const clean = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

  // A plain object whose property writes update the DOM. GSAP tweens the object; the setter draws.
  // Works while seeking (no onUpdate callbacks needed).
  function driver(init, draw) {
    const o = {}; let v = init;
    Object.defineProperty(o, "v", { get: () => v, set: (x) => { v = x; draw(x); }, enumerable: true });
    draw(v);
    return o;
  }

  const ENTER = {
    up:    [{ autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, ease: "power3.out" }],
    down:  [{ autoAlpha: 0, y: -60 }, { autoAlpha: 1, y: 0, ease: "power3.out" }],
    left:  [{ autoAlpha: 0, x: -120 }, { autoAlpha: 1, x: 0, ease: "power3.out" }],
    right: [{ autoAlpha: 0, x: 120 }, { autoAlpha: 1, x: 0, ease: "power3.out" }],
    pop:   [{ autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, ease: "back.out(2)" }],
    drop:  [{ autoAlpha: 0, y: -220, rotation: -6 }, { autoAlpha: 1, y: 0, rotation: 0, ease: "bounce.out" }],
    fade:  [{ autoAlpha: 0 }, { autoAlpha: 1, ease: "power1.out" }],
    zoom:  [{ autoAlpha: 0, scale: 1.25, filter: "blur(10px)" }, { autoAlpha: 1, scale: 1, filter: "blur(0px)", ease: "power3.out" }],
    wipe:  [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", ease: "power2.inOut" }],
    rise:  [{ clipPath: "inset(100% 0 0 0)", y: 30 }, { clipPath: "inset(0% 0 0 0)", y: 0, ease: "power3.out" }],
    spin:  [{ autoAlpha: 0, rotation: -90, scale: 0.4 }, { autoAlpha: 1, rotation: 0, scale: 1, ease: "back.out(1.6)" }],
  };
  const LEAVE = {
    up:   { autoAlpha: 0, y: -60, ease: "power2.in" },
    down: { autoAlpha: 0, y: 60, ease: "power2.in" },
    left: { autoAlpha: 0, x: -140, ease: "power2.in" },
    right:{ autoAlpha: 0, x: 140, ease: "power2.in" },
    pop:  { autoAlpha: 0, scale: 0.6, ease: "back.in(2)" },
    fade: { autoAlpha: 0, ease: "power1.in" },
    shrink: { autoAlpha: 0, scale: 0.2, ease: "power3.in" },
  };

  function kit(root, tl, ctx) {
    const W = ctx.W || [], words = ctx.words || [];
    const w = (i) => (W.length ? W[Math.max(0, Math.min(i | 0, W.length - 1))] : 0);
    const s = { root, tl, words, dur: ctx.dur, w, ctx };

    s.find = (word, from = 0) => {
      const q = clean(word);
      for (let i = Math.max(0, from); i < words.length; i++) if (clean(words[i]) === q) return i;
      return -1;
    };
    // time of a word given as index or text ("million" -> its first occurrence)
    s.t = (x, shift = 0) => (typeof x === "number" ? w(x) : Math.max(0, w(Math.max(0, s.find(x))))) + shift;

    // ---- making elements -------------------------------------------------------------------
    // s.el('<div class="card">..</div>', {x, y, w, h, z, cls, css, parent})  or  s.el("div", {...})
    s.el = (htmlOrTag, o = {}) => {
      let e;
      if (/^\s*</.test(htmlOrTag)) {
        const t = document.createElement("template"); t.innerHTML = htmlOrTag.trim(); e = t.content.firstElementChild;
      } else e = document.createElement(htmlOrTag || "div");
      if (o.cls) e.className += (e.className ? " " : "") + o.cls;
      if (o.html != null) e.innerHTML = o.html;
      if (o.text != null) e.textContent = o.text;
      const st = e.style;
      if (o.x != null || o.y != null) { st.position = "absolute"; if (o.x != null) st.left = o.x + "px"; if (o.y != null) st.top = o.y + "px"; }
      if (o.w != null) st.width = o.w + "px";
      if (o.h != null) st.height = o.h + "px";
      if (o.z != null) st.zIndex = o.z;
      if (o.center) { st.position = "absolute"; st.left = "70px"; st.right = "70px"; st.textAlign = "center"; }
      if (o.css) st.cssText += ";" + o.css;
      (o.parent || root).appendChild(e);
      return e;
    };
    s.$ = (sel) => root.querySelector(sel);
    s.$$ = (sel) => Array.from(root.querySelectorAll(sel));

    // ---- motion ---------------------------------------------------------------------------
    // s.enter(el|[els], at, "up"|"pop"|..., {d, stagger, ...extra to-vars})
    s.enter = (el, at, kind = "up", o = {}) => {
      const [from, to] = ENTER[kind] || ENTER.up;
      const { d = 0.55, stagger = 0, ...extra } = o;
      tl.fromTo(el, { ...from }, { ...to, duration: d, stagger, ...extra }, Math.max(0, at));
      return el;
    };
    s.leave = (el, at, kind = "fade", o = {}) => {
      const { d = 0.35, stagger = 0, ...extra } = o;
      tl.to(el, { ...(LEAVE[kind] || LEAVE.fade), duration: d, stagger, ...extra }, Math.max(0, at));
      return el;
    };
    // hidden until `at` (no motion), visible after
    s.show = (el, at) => { tl.set(el, { autoAlpha: 0 }, 0); tl.set(el, { autoAlpha: 1 }, Math.max(0, at)); return el; };
    s.hide = (el, at) => { tl.set(el, { autoAlpha: 0 }, Math.max(0, at)); return el; };
    // swap stacked elements: a visible until at, then b
    s.swap = (a, b, at) => { tl.set(b, { autoAlpha: 0 }, 0); tl.set(a, { autoAlpha: 0 }, at); tl.set(b, { autoAlpha: 1 }, at); };
    // short emphasis on a word: scale bump
    s.punch = (el, at, k = 1.12) => { tl.to(el, { keyframes: [{ scale: k, duration: 0.12, ease: "power2.out" }, { scale: 1, duration: 0.18, ease: "power2.in" }] }, Math.max(0, at)); return el; };
    s.shake = (el, at, px = 14) => { tl.to(el, { keyframes: [{ x: -px, duration: 0.08 }, { x: px, duration: 0.08 }, { x: -px / 2, duration: 0.08 }, { x: 0, duration: 0.08 }], ease: "none" }, Math.max(0, at)); return el; };
    // camera-like push on a container
    s.push = (el, at, to = 1.08, d = 1.6) => { tl.fromTo(el, { scale: 1 }, { scale: to, duration: d, ease: "sine.inOut" }, Math.max(0, at)); return el; };
    // idle life: gentle bob / sway for the whole scene (uses the CSS `translate`/`rotate` properties,
    // so it never fights GSAP's transform tweens on the same element)
    s.idle = (el, o = {}) => {
      const { amp = 10, period = 2.4, rot = 0, phase = 0 } = o;
      const els = Array.isArray(el) ? el : [el];
      els.forEach((e, k) => {
        const d = driver(0, (t) => {
          const p = (t / period + phase + k * 0.37) * Math.PI * 2;
          e.style.translate = `0 ${(Math.sin(p) * amp).toFixed(2)}px`;
          if (rot) e.style.rotate = `${(Math.sin(p * 0.5) * rot).toFixed(2)}deg`;
        });
        tl.fromTo(d, { v: 0 }, { v: s.dur, duration: s.dur, ease: "none" }, 0);
      });
      return el;
    };
    // move along points [[x,y],...] (element's left/top stay, uses x/y offsets)
    s.path = (el, at, pts, d = 1.2, ease = "sine.inOut") => {
      tl.to(el, { keyframes: pts.map(([x, y]) => ({ x, y })), duration: d, ease }, Math.max(0, at));
      return el;
    };

    // ---- text -----------------------------------------------------------------------------
    // Headline revealed word by word with the voice. text: "Save *RM500* a month" (*x* = accent).
    // from: index of the scene word that matches the first headline word (default: found by text).
    s.headline = (text, o = {}) => {
      const parts = text.trim().split(/\s+/);
      const box = s.el("div", { cls: "rs-head " + (o.cls || ""), center: o.x == null, x: o.x, y: o.y != null ? o.y : 420, w: o.w, css: o.css || "" });
      if (o.size) box.style.fontSize = o.size + "px";
      let from = o.from != null ? o.from : s.find(parts[0].replace(/\*/g, ""));
      if (from < 0) from = 0;
      const spans = parts.map((p, k) => {
        const hi = /^\*.*\*[.,!?:;]*$/.test(p);
        const sp = document.createElement("span");
        sp.className = "rs-w" + (hi ? " rs-hi" : "");
        sp.textContent = p.replace(/\*/g, "");
        box.appendChild(sp); box.appendChild(document.createTextNode(" "));
        const at = o.at ? o.at + k * (o.gap || 0.12) : w(from + k) - 0.05;
        tl.fromTo(sp, { autoAlpha: 0, y: 40, scale: 0.92 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(2)" }, Math.max(0, at));
        return sp;
      });
      box.words = spans;
      return box;
    };
    // count from a to b. fmt: {prefix, suffix, dec, sep:","}
    s.count = (el, at, a, b, d = 1.2, fmt = {}) => {
      const { prefix = "", suffix = "", dec = 0, sep = "," } = fmt;
      const show = (v) => {
        let n = Number(v).toFixed(dec);
        if (sep) { const [i, f] = n.split("."); n = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? "." + f : ""); }
        el.textContent = prefix + n + suffix;
      };
      const d0 = driver(a, show);
      tl.fromTo(d0, { v: a }, { v: b, duration: d, ease: fmt.ease || "power2.out" }, Math.max(0, at));
      return el;
    };
    // typewriter: reveal `text` into el, cps characters per second, with a caret
    s.type = (el, at, text, cps = 22, o = {}) => {
      const caret = o.caret !== false;
      const d0 = driver(0, (n) => {
        const k = Math.round(n);
        el.textContent = text.slice(0, k);
        if (caret) { const c = document.createElement("span"); c.className = "rs-caret"; el.appendChild(c); }
      });
      tl.fromTo(d0, { v: 0 }, { v: text.length, duration: text.length / cps, ease: "none" }, Math.max(0, at));
      return el;
    };
    // strike through an element (adds a line that wipes across)
    s.strike = (el, at, color) => {
      const line = document.createElement("i"); line.className = "rs-strike"; if (color) line.style.background = color;
      el.style.position = el.style.position || "relative"; el.appendChild(line);
      tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, Math.max(0, at));
      return line;
    };
    // marker highlight behind text (animated background on the element itself)
    s.mark = (el, at, color) => {
      const c = color || "color-mix(in srgb, var(--rs-accent) 32%, transparent)";
      el.style.backgroundImage = `linear-gradient(${c}, ${c})`;
      el.style.backgroundRepeat = "no-repeat"; el.style.backgroundPosition = "0 85%";
      tl.fromTo(el, { backgroundSize: "0% 70%" }, { backgroundSize: "100% 70%", duration: 0.35, ease: "power2.out" }, Math.max(0, at));
      return el;
    };

    // ---- svg ------------------------------------------------------------------------------
    // draw an SVG path/line/circle stroke on
    s.draw = (path, at, d = 0.8, ease = "power2.inOut") => {
      const ps = Array.isArray(path) ? path : [path];
      ps.forEach((p) => {
        const L = p.getTotalLength ? p.getTotalLength() : 1000;
        p.style.strokeDasharray = L; tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: d, ease }, Math.max(0, at));
      });
      return path;
    };

    // ---- ready-made pieces (styled by themes.css; colours follow the reel's theme) ---------
    // card: s.card({x,y,w,h, title, body, icon}) -> element
    s.card = (o = {}) => s.el(`<div class="rs-card ${o.cls || ""}">${o.icon ? `<div class="rs-ico">${o.icon}</div>` : ""}${o.title ? `<div class="rs-ct">${o.title}</div>` : ""}${o.body ? `<div class="rs-cb">${o.body}</div>` : ""}</div>`, o);
    s.chip = (text, o = {}) => s.el(`<div class="rs-chip ${o.cls || ""}">${text}</div>`, o);
    // stat: big number + label; counts up at `at` if o.to given
    s.stat = (o = {}) => {
      const e = s.el(`<div class="rs-stat ${o.cls || ""}"><div class="rs-num">${o.prefix || ""}${o.from != null ? o.from : o.to != null ? o.to : ""}${o.suffix || ""}</div><div class="rs-lab">${o.label || ""}</div></div>`, o);
      if (o.to != null && o.at != null) s.count(e.querySelector(".rs-num"), o.at, o.from || 0, o.to, o.d || 1.2, o);
      return e;
    };
    // terminal window; returns {box, body}; use s.type(body, at, "...")
    s.term = (o = {}) => {
      const box = s.el(`<div class="rs-term ${o.cls || ""}"><div class="rs-tbar"><i></i><i></i><i></i><span>${o.title || ""}</span></div><pre class="rs-tbody"></pre></div>`, o);
      return { box, body: box.querySelector(".rs-tbody") };
    };
    // checklist: items appear and tick at times ats[]
    s.checklist = (items, ats, o = {}) => {
      const box = s.el(`<div class="rs-list ${o.cls || ""}">${items.map((t) => `<div class="rs-li"><span class="rs-box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span><span>${t}</span></div>`).join("")}</div>`, o);
      box.querySelectorAll(".rs-li").forEach((li, k) => {
        const at = ats[k] != null ? ats[k] : ats[ats.length - 1] + k * 0.3;
        s.enter(li, at - 0.25, "left", { d: 0.4 });
        const p = li.querySelector("path"); s.draw(p, at, 0.3);
        tl.fromTo(li.querySelector(".rs-box"), { backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "var(--rs-accent)", duration: 0.2 }, at);
      });
      return box;
    };
    // bars: values [{label, v}], grows at `at` with stagger
    s.bars = (data, at, o = {}) => {
      const max = o.max || Math.max(...data.map((d) => d.v));
      const box = s.el(`<div class="rs-bars ${o.cls || ""}">${data.map((d) => `<div class="rs-bar"><b style="height:${(d.v / max) * 100}%"${d.hi ? ' class="hi"' : ""}></b><span>${d.label}</span></div>`).join("")}</div>`, o);
      tl.fromTo(box.querySelectorAll(".rs-bar b"), { scaleY: 0 }, { scaleY: 1, duration: 0.6, ease: "power3.out", stagger: o.stagger || 0.12 }, Math.max(0, at));
      return box;
    };
    // progress bar filling from 0 to pct over d
    s.progress = (o = {}) => {
      const box = s.el(`<div class="rs-prog ${o.cls || ""}"><b></b></div>`, o);
      tl.fromTo(box.firstChild, { scaleX: 0 }, { scaleX: (o.pct == null ? 100 : o.pct) / 100, duration: o.d || 1, ease: o.ease || "power1.inOut" }, Math.max(0, o.at || 0));
      return box;
    };
    // phone frame; returns {box, screen}
    s.phone = (o = {}) => {
      const box = s.el(`<div class="rs-phone ${o.cls || ""}"><div class="rs-screen">${o.html || ""}</div></div>`, o);
      return { box, screen: box.querySelector(".rs-screen") };
    };
    // chat bubbles: [{who:"me"|"them", text, at}]
    s.chat = (msgs, o = {}) => {
      const box = s.el(`<div class="rs-chat ${o.cls || ""}"></div>`, o);
      msgs.forEach((m) => {
        const b = document.createElement("div"); b.className = "rs-msg " + (m.who === "me" ? "me" : "them"); b.innerHTML = m.text; box.appendChild(b);
        s.enter(b, m.at, m.who === "me" ? "right" : "left", { d: 0.4 });
      });
      return box;
    };
    // arrow svg from (x1,y1) to (x2,y2), drawn at `at`
    s.arrow = (x1, y1, x2, y2, at, o = {}) => {
      const mx = (x1 + x2) / 2 + (o.bend || 0), my = (y1 + y2) / 2 - Math.abs(o.bend || 0);
      const svg = s.el(`<svg class="rs-arrow" width="1080" height="1920" viewBox="0 0 1080 1920" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none"><path d="M${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}"/><path class="hd" d="M0 0"/></svg>`, { z: o.z });
      const p = svg.querySelector("path"); s.draw(p, at, o.d || 0.6);
      const ang = Math.atan2(y2 - my, x2 - mx), L = 26;
      const hd = svg.querySelector(".hd");
      hd.setAttribute("d", `M${x2 - L * Math.cos(ang - 0.5)} ${y2 - L * Math.sin(ang - 0.5)} L${x2} ${y2} L${x2 - L * Math.cos(ang + 0.5)} ${y2 - L * Math.sin(ang + 0.5)}`);
      s.show(hd, at + (o.d || 0.6) - 0.05);
      return svg;
    };
    // particles burst from (x,y) at `at` (deterministic)
    s.burst = (x, y, at, o = {}) => {
      const n = o.n || 14, r = o.r || 220;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (k % 3) * 0.2, dist = r * (0.6 + ((k * 37) % 10) / 25);
        const p = s.el("i", { cls: "rs-dot", x: x - 8, y: y - 8, z: o.z || 5 });
        if (o.color) p.style.background = o.color;
        tl.fromTo(p, { autoAlpha: 1, x: 0, y: 0, scale: 1 }, { x: Math.cos(a) * dist, y: Math.sin(a) * dist, scale: 0.2, autoAlpha: 0, duration: 0.8, ease: "power3.out" }, Math.max(0, at));
      }
    };
    // presenter character (assets/presenter.js) -> element with parts {head, eyes, mouth, arm, wave}
    s.presenter = (o = {}) => {
      const id = (o.id || "pr") + "-" + Math.random().toString(36).slice(2, 6);
      const e = s.el(`<div class="rs-presenter">${window.presenter ? window.presenter({ ...o, id }) : ""}</div>`, o);
      const q = (k) => e.querySelector("#" + id + "-" + k);
      e.parts = { head: q("head"), eyes: q("eyes"), mouth: q("mouth-o"), arm: q("arm"), wave: q("wave"), body: q("body") };
      return e;
    };
    return s;
  }

  // called by each scene composition
  RS.build = (id, root, ctx) => {
    const tl = gsap.timeline({ paused: true });
    const s = kit(root, tl, ctx);
    const fn = RS.scenes[id];
    if (fn) {
      try { fn(s); } catch (e) {
        console.error("[scene " + id + "]", e);
        root.insertAdjacentHTML("beforeend", `<div style="position:absolute;left:70px;right:70px;top:600px;font:700 40px/1.3 monospace;color:#c00;background:#fff;padding:24px">scene "${id}" error: ${String(e.message || e).replace(/</g, "&lt;")}</div>`);
      }
    } else console.warn("[RS] no scene function for", id);
    tl.set({}, {}, ctx.dur); // timeline spans the whole scene
    return tl;
  };
})();
