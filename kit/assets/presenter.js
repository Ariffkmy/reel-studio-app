/* Original cartoon presenter for the "Halftone poster" style (Reel Studio). Flat, half-body, 400x520.
   presenter({id, shirt, hair, skin, phones}) -> SVG string. Animatable parts (ids prefixed with `${id}-`):
   head (nod/tilt, origin 200 300), eyes (blink: scaleY, origin 200 214), mouth-o (open mouth, toggle opacity),
   arm (pointing arm, rotate around shoulder 300 400), wave (other hand), body.
   Mirror him by putting scaleX(-1) on the inner <svg>, never on the element GSAP animates. */
window.presenter = function (o) {
  o = o || {};
  const id = o.id || "pr", K = "#171513", S = 'stroke="' + K + '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"';
  const shirt = o.shirt || "#F2B33D", hair = o.hair || "#2A211C", skin = o.skin || "#F2C29C", ph = o.phones || "#2FB5A6";
  return `<svg viewBox="0 0 400 520" width="${o.w || 400}" height="${o.h || 520}" style="overflow:visible">
  <g id="${id}-body">
    <path d="M58 522 C 58 420 104 368 200 362 C 296 368 342 420 342 522 Z" fill="${shirt}" ${S}/>
    <path d="M150 372 C 168 410 232 410 250 372" fill="none" ${S}/>
    <path d="M178 420 L 178 470 M222 420 L 222 470" ${S} fill="none"/>
    <circle cx="178" cy="476" r="6" fill="${K}"/><circle cx="222" cy="476" r="6" fill="${K}"/>
    <path d="M120 360 C 120 410 280 410 280 360" fill="none" stroke="${ph}" stroke-width="16" stroke-linecap="round"/>
    <rect x="98" y="342" width="40" height="52" rx="16" fill="${ph}" ${S}/><rect x="262" y="342" width="40" height="52" rx="16" fill="${ph}" ${S}/>
  </g>
  <g id="${id}-wave"><path d="M88 500 C 72 466 66 440 72 412" fill="none" stroke="${K}" stroke-width="56" stroke-linecap="round"/>
    <path d="M88 500 C 72 466 66 440 72 412" fill="none" stroke="${shirt}" stroke-width="44" stroke-linecap="round"/>
    <circle cx="74" cy="404" r="25" fill="${skin}" ${S}/></g>
  <g id="${id}-head">
    <rect x="178" y="300" width="44" height="58" rx="14" fill="${skin}" ${S}/>
    <circle cx="112" cy="222" r="20" fill="${skin}" ${S}/><circle cx="288" cy="222" r="20" fill="${skin}" ${S}/>
    <ellipse cx="200" cy="214" rx="90" ry="98" fill="${skin}" ${S}/>
    <path d="M108 200 C 98 118 160 92 214 100 C 262 106 300 134 294 196 C 280 160 252 140 214 150 C 196 128 170 120 150 134 C 150 160 128 178 108 200 Z" fill="${hair}" ${S}/>
    <path d="M150 192 C 162 184 176 184 186 190 M214 190 C 224 184 240 184 250 192" fill="none" ${S}/>
    <g id="${id}-eyes"><ellipse cx="166" cy="214" rx="9" ry="12" fill="${K}"/><ellipse cx="234" cy="214" rx="9" ry="12" fill="${K}"/>
      <circle cx="169" cy="209" r="3" fill="#fff"/><circle cx="237" cy="209" r="3" fill="#fff"/></g>
    <ellipse cx="146" cy="250" rx="15" ry="9" fill="#EE8C79" opacity=".55"/><ellipse cx="254" cy="250" rx="15" ry="9" fill="#EE8C79" opacity=".55"/>
    <path d="M200 226 C 196 238 198 244 206 244" fill="none" ${S}/>
    <path id="${id}-mouth" d="M172 262 C 186 282 214 282 228 262" fill="none" ${S}/>
    <path id="${id}-mouth-o" d="M178 260 C 182 292 218 292 222 260 Z" fill="#7A2E24" ${S} opacity="0"/>
  </g>
  <g id="${id}-arm">
    <path d="M300 410 C 336 380 352 330 350 270" fill="none" stroke="${K}" stroke-width="58" stroke-linecap="round"/>
    <path d="M300 410 C 336 380 352 330 350 270" fill="none" stroke="${shirt}" stroke-width="46" stroke-linecap="round"/>
    <path d="M330 262 C 326 238 336 230 346 232 L 352 178 C 353 166 368 166 368 178 L 366 236 C 380 232 390 244 384 262 C 380 282 344 290 330 262 Z" fill="${skin}" ${S}/>
  </g>
</svg>`;
};
