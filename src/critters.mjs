// Cute animated critters for bot avatars. Original drawings made of a few basic shapes.
//
// Each avatar is a self-contained SVG whose motion is CSS inside the file, so it animates anywhere it
// is shown as an <img> (bot tiles, chat, the picker) with no script. The motion:
//   idle     a slow bob, and the eyes blink every few seconds
//   working  a quicker bob, eyes glancing side to side, the mouth chatters, three thinking dots pulse
// Everything stops under the OS "reduce motion" setting, and `phase` offsets the timing so a row of
// critters does not move in lockstep.

export const CRITTER_IDS = Object.freeze(['cat', 'bunny', 'bear', 'fox', 'owl', 'robot', 'ghost', 'frog', 'penguin', 'octopus']);
const CRITTER_SET = new Set(CRITTER_IDS);
export const isCritter = shape => CRITTER_SET.has(shape);

const luma = hex => {
  const h = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const CREAM = '#fffaf0', PINK = '#ff8fa3', BEAK = '#f2b64d';

function face(c, { xs, y, r = 4.2, mouth, cheeks = true, whites = false }) {
  const eye = x => `${whites ? `<circle cx="${x}" cy="${y}" r="${r * 2.1}" fill="${CREAM}"/>` : ''}<g class="eye"><circle cx="${x}" cy="${y}" r="${r}" fill="${c.dark}"/><circle cx="${x + r * 0.32}" cy="${y - r * 0.34}" r="${r * 0.32}" fill="#fff"/></g>`;
  const cheek = x => `<circle cx="${x}" cy="${y + 8}" r="3.6" fill="${PINK}" opacity=".5"/>`;
  const smile = mouth ? `<path class="mouth" d="M${mouth[0] - 4.5} ${mouth[1]}q4.5 4.5 9 0" fill="none" stroke="${c.dark}" stroke-width="2.4" stroke-linecap="round"/>` : '';
  return `${cheeks ? xs.map((x, i) => cheek(i === 0 ? x - 6 : x + 6)).join('') : ''}<g class="look">${xs.map(eye).join('')}</g>${smile}`;
}

const DRAW = {
  cat: c => `<path d="M24 52 26 26l18 12q6-2 12 0l18-12 2 26q2 26-26 26T24 52Z" fill="${c.ink}"/><path d="m30 40 1-8 7 5Zm40 0-1-8-7 5Z" fill="${PINK}" opacity=".7"/>`
    + face(c, {xs: [40, 60], y: 56, mouth: [50, 67]})
    + `<path d="M47.5 62h5L50 65Z" fill="${PINK}"/><path d="M22 60h10M22 66l9-2M78 60H68M78 66l-9-2" stroke="${c.dark}" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>`,
  bunny: c => `<ellipse cx="38" cy="30" rx="7" ry="17" fill="${c.ink}"/><ellipse cx="62" cy="30" rx="7" ry="17" fill="${c.ink}"/><ellipse cx="38" cy="31" rx="3.4" ry="11" fill="${PINK}" opacity=".6"/><ellipse cx="62" cy="31" rx="3.4" ry="11" fill="${PINK}" opacity=".6"/><ellipse cx="50" cy="64" rx="25" ry="20" fill="${c.ink}"/>`
    + face(c, {xs: [40, 60], y: 62, mouth: [50, 70]}) + `<circle cx="50" cy="67" r="2.2" fill="${PINK}"/>`,
  bear: c => `<circle cx="30" cy="38" r="10" fill="${c.ink}"/><circle cx="70" cy="38" r="10" fill="${c.ink}"/><circle cx="30" cy="38" r="5" fill="${PINK}" opacity=".5"/><circle cx="70" cy="38" r="5" fill="${PINK}" opacity=".5"/><circle cx="50" cy="58" r="27" fill="${c.ink}"/><ellipse cx="50" cy="67" rx="11" ry="8" fill="${CREAM}" opacity=".85"/>`
    + face(c, {xs: [39, 61], y: 52, mouth: [50, 69]}) + `<ellipse cx="50" cy="62.5" rx="3.6" ry="2.7" fill="${c.dark}"/>`,
  fox: c => `<path d="M20 52 24 26l18 14q8-3 16 0l18-14 4 26q-2 24-30 28-28-4-30-28Z" fill="${c.ink}"/><path d="m27 38 1-8 8 6Zm46 0-1-8-8 6Z" fill="${c.dark}" opacity=".45"/><path d="M33 62q17-8 34 0-6 17-17 17T33 62Z" fill="${CREAM}" opacity=".92"/>`
    + face(c, {xs: [38, 62], y: 54, mouth: [50, 74], cheeks: false}) + `<ellipse cx="50" cy="67" rx="3.6" ry="2.7" fill="${c.dark}"/>`,
  owl: c => `<path d="m26 44 2-20 14 10Zm48 0-2-20-14 10Z" fill="${c.ink}"/><ellipse cx="50" cy="58" rx="27" ry="26" fill="${c.ink}"/>`
    + face(c, {xs: [39, 61], y: 52, r: 4.4, whites: true, cheeks: false}) + `<path d="M46 60h8l-4 8Z" fill="${BEAK}"/><path d="M38 76q4 3 8 0m8 0q4 3 8 0" fill="none" stroke="${c.dark}" stroke-width="1.8" stroke-linecap="round" opacity=".4"/>`,
  robot: c => `<path d="M50 32V21" stroke="${c.ink}" stroke-width="3.4" stroke-linecap="round"/><circle class="blip" cx="50" cy="19" r="4.4" fill="${PINK}"/><rect x="18" y="47" width="8" height="15" rx="3.5" fill="${c.ink}"/><rect x="74" y="47" width="8" height="15" rx="3.5" fill="${c.ink}"/><rect x="24" y="32" width="52" height="46" rx="14" fill="${c.ink}"/><rect x="31" y="41" width="38" height="27" rx="10" fill="${c.dark}" opacity=".16"/>`
    + face(c, {xs: [42, 58], y: 53, r: 3.8, mouth: [50, 62], cheeks: false}),
  ghost: c => `<path d="M26 80V50a24 24 0 0 1 48 0v30l-8-6-8 6-8-6-8 6-8-6Z" fill="${c.ink}"/>`
    + face(c, {xs: [40, 60], y: 46}) + `<ellipse class="mouth" cx="50" cy="58" rx="3.2" ry="3.8" fill="${c.dark}"/>`,
  frog: c => `<ellipse cx="50" cy="63" rx="31" ry="19" fill="${c.ink}"/><circle cx="34" cy="45" r="12" fill="${c.ink}"/><circle cx="66" cy="45" r="12" fill="${c.ink}"/>`
    + face(c, {xs: [34, 66], y: 45, r: 4.8, whites: true, cheeks: false}) + `<path class="mouth" d="M33 66q17 15 34 0" fill="none" stroke="${c.dark}" stroke-width="2.6" stroke-linecap="round"/><circle cx="30" cy="68" r="3.6" fill="${PINK}" opacity=".5"/><circle cx="70" cy="68" r="3.6" fill="${PINK}" opacity=".5"/>`,
  penguin: c => `<ellipse cx="25" cy="58" rx="5.5" ry="14" transform="rotate(14 25 58)" fill="${c.ink}"/><ellipse cx="75" cy="58" rx="5.5" ry="14" transform="rotate(-14 75 58)" fill="${c.ink}"/><ellipse cx="40" cy="85" rx="8" ry="3.4" fill="${BEAK}"/><ellipse cx="60" cy="85" rx="8" ry="3.4" fill="${BEAK}"/><ellipse cx="50" cy="56" rx="25" ry="29" fill="${c.ink}"/><ellipse cx="50" cy="63" rx="16" ry="21" fill="${CREAM}" opacity=".92"/>`
    + face(c, {xs: [41, 59], y: 46, cheeks: false}) + `<path d="M45 53h10l-5 8Z" fill="${BEAK}"/>`,
  octopus: c => `<path d="M25 50h50q2 22-6 28-6-8-9 0-5-8-10 0-5-8-10 0-3-8-9 0-8-6-6-28Z" fill="${c.ink}"/><circle cx="50" cy="46" r="26" fill="${c.ink}"/>`
    + face(c, {xs: [40, 60], y: 46, mouth: [50, 57]}),
};

const CSS = `.bob{transform-box:fill-box;transform-origin:50% 100%;animation:bob 3.4s ease-in-out infinite;animation-delay:var(--d)}
.eye{transform-box:fill-box;transform-origin:center;animation:blink 5s infinite;animation-delay:var(--d)}
.blip{animation:blip 1.8s ease-in-out infinite}
.dot{animation:dot 1.1s ease-in-out infinite}.dot:nth-child(2){animation-delay:.18s}.dot:nth-child(3){animation-delay:.36s}
.working .bob{animation-duration:.8s}
.working .look{animation:look 1.5s ease-in-out infinite}
.working .mouth{transform-box:fill-box;transform-origin:center;animation:talk .42s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-2.4px)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
@keyframes look{0%,100%{transform:translateX(0)}30%{transform:translateX(2.2px)}70%{transform:translateX(-2.2px)}}
@keyframes talk{50%{transform:scaleY(1.5)}}
@keyframes blip{50%{opacity:.35}}
@keyframes dot{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-3px);opacity:1}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}`;

/** Full SVG markup (not URL-encoded) for a critter. `ink` must already be a validated #hex colour. */
export function critterSvg(shape, ink, { mode = 'idle', phase = 0 } = {}) {
  const c = {ink, dark: luma(ink) > 0.55 ? '#1f2b29' : '#fbf7ee'};
  const working = mode === 'streaming';
  const dots = working ? `<g fill="${ink}"><circle class="dot" cx="38" cy="13" r="3"/><circle class="dot" cx="50" cy="13" r="3"/><circle class="dot" cx="62" cy="13" r="3"/></g>` : '';
  const delay = `-${(phase % 40) / 10}s`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" class="${working ? 'working' : 'idle'}" style="--d:${delay}"><style>${CSS}</style>`
    + `<rect x="4" y="4" width="92" height="92" rx="24" fill="${ink}" fill-opacity=".16"/><g class="bob">${DRAW[shape](c)}</g>${dots}</svg>`;
}
