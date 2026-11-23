// Writes docs/critters-preview.html: every animated avatar, idle and working, in each colour.
// Open the file in a browser to see the motion. Usage: node scripts/critter-preview.mjs
import {writeFile} from 'node:fs/promises';
import {CRITTER_IDS,BOT_COLORS,avatarSvg} from '../src/avatar.mjs';
const cell=(shape,color,mode,theme)=>`<figure><img width="96" height="96" alt="${shape} ${mode}" src="${avatarSvg(shape+'-'+color.id,color[theme],shape,mode)}"><figcaption>${shape}</figcaption></figure>`;
const section=(theme,bg,fg)=>`<section style="background:${bg};color:${fg}"><h2>${theme} theme</h2>${['idle','streaming'].map(mode=>`<h3>${mode==='idle'?'Idle':'Working'}</h3><div class="row">${CRITTER_IDS.map((shape,i)=>cell(shape,BOT_COLORS[i%BOT_COLORS.length],mode,theme)).join('')}</div>`).join('')}</section>`;
const html=`<!doctype html><meta charset="utf-8"><title>Gravis critters</title><style>body{margin:0;font:14px system-ui}section{padding:24px 32px}.row{display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;text-align:center}figcaption{opacity:.7;margin-top:4px}h2,h3{margin:12px 0 8px}</style>${section('dark','#1d2321','#e8efed')}${section('light','#f6f7f4','#1d2321')}`;
await writeFile(new URL('../docs/critters-preview.html',import.meta.url),html);console.log('wrote docs/critters-preview.html');
