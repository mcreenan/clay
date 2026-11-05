// Hand-drawn SVG concepts. Rebuild with node scripts/clay-icon-sheet.mjs, then vp fmt docs/design/clay-icons/index.html.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "docs/design/clay-icons");
mkdirSync(output, { recursive: true });
const sizes = [128, 96, 64, 48, 32, 24, 16];

const concepts = [
  {
    id: "a",
    name: "Pinch",
    description: "A soft clay ball with a thumb mark and two curious eyes.",
    note: "The uneven edge gives it character. At 16 px, the eyes and outline remain clear.",
    colors: ["#E4AA83", "#C77756", "#8F4935"],
    large: `<path d="M21 43C27 29 36 24 49 23C54 13 66 13 74 20C91 16 105 29 107 44C120 59 116 80 106 91C99 106 81 113 63 111C46 115 26 108 20 94C7 84 9 64 16 54C15 49 17 45 21 43Z" fill="url(#body)"/>
      <path d="M27 44C32 32 45 29 52 30C55 23 61 21 67 23" fill="none" stroke="#F5C9A5" stroke-width="5" stroke-linecap="round" opacity=".65"/>
      <path d="M91 90C84 99 70 102 58 100" fill="none" stroke="#8B4936" stroke-width="4" stroke-linecap="round" opacity=".28"/>
      <path d="M80 28C83 28 87 30 88 33" fill="none" stroke="#9F573F" stroke-width="3" stroke-linecap="round" opacity=".45"/>
      <ellipse cx="48" cy="61" rx="11" ry="14" fill="#FFF0DA" transform="rotate(-6 48 61)"/>
      <ellipse cx="79" cy="61" rx="11" ry="14" fill="#FFF0DA" transform="rotate(6 79 61)"/>
      <rect x="47" y="55" width="7" height="14" rx="3.5" fill="#392A25"/>
      <rect x="78" y="55" width="7" height="14" rx="3.5" fill="#392A25"/>`,
    small: `<path d="M3 5C4 3 5 3 6 3C7 1 9 2 10 3C13 2 14 5 14 7C16 10 13 14 10 14C6 16 2 13 2 11C0 9 2 6 3 5Z" fill="#CC8762"/>
      <rect x="5" y="6" width="2" height="4" rx="1" fill="#392A25"/>
      <rect x="9" y="6" width="2" height="4" rx="1" fill="#392A25"/>`,
  },
  {
    id: "b",
    name: "Pebble",
    description: "A smooth green clay ball with a dark panel for its eyes.",
    note: "Selected for Clay. The dark panel makes the agent easy to identify at small sizes.",
    colors: ["#BED1AA", "#8EA67F", "#5B755B"],
    large: `<path d="M61 16C88 12 109 31 114 55C119 79 105 104 81 111C57 119 30 109 18 89C5 67 14 40 31 26C39 20 51 17 61 16Z" fill="url(#body)"/>
      <path d="M30 40C37 30 50 24 63 24" fill="none" stroke="#DFE8C9" stroke-width="5" stroke-linecap="round" opacity=".7"/>
      <path d="M34 48C45 43 83 43 94 48C99 51 101 58 99 66C97 76 91 79 83 80C72 82 53 82 43 79C33 77 29 71 29 63C29 56 30 51 34 48Z" fill="#293D34"/>
      <rect x="44" y="53" width="10" height="19" rx="5" fill="#ECF4DC"/>
      <rect x="74" y="53" width="10" height="19" rx="5" fill="#ECF4DC"/>
      <path d="M83 99C76 102 68 104 61 103" fill="none" stroke="#49664C" stroke-width="4" stroke-linecap="round" opacity=".35"/>`,
    small: `<path d="M8 2C12 1 15 5 15 8C15 12 12 15 8 15C4 15 1 12 1 8C1 5 4 2 8 2Z" fill="#9AAF87"/>
      <rect x="3.5" y="5.5" width="9" height="4.5" rx="2.25" fill="#293D34"/>
      <rect x="5.5" y="6.5" width="1.25" height="2.5" rx=".625" fill="#ECF4DC"/>
      <rect x="9.25" y="6.5" width="1.25" height="2.5" rx=".625" fill="#ECF4DC"/>`,
  },
  {
    id: "c",
    name: "Coil",
    description: "A ball made from a coil of purple clay, with a quiet face.",
    note: "The coil makes the material clear at large sizes. Small sizes keep one broad fold.",
    colors: ["#D8C7E7", "#B09BCB", "#7A6697"],
    large: `<path d="M62 15C87 13 109 32 113 56C120 82 101 108 78 113C49 120 20 106 14 81C6 53 25 24 49 18C53 16 58 15 62 15Z" fill="url(#body)"/>
      <path d="M26 45C35 23 73 18 91 36C108 51 107 77 90 88C78 97 58 99 43 89" fill="none" stroke="#7C6895" stroke-width="12" stroke-linecap="round" opacity=".38"/>
      <path d="M25 41C37 20 72 20 90 36C105 49 103 74 89 83C76 93 58 93 45 86" fill="none" stroke="#D6C4E7" stroke-width="10" stroke-linecap="round"/>
      <path d="M25 74C29 93 49 106 72 104" fill="none" stroke="#DFD1EC" stroke-width="6" stroke-linecap="round" opacity=".65"/>
      <rect x="43" y="49" width="10" height="20" rx="5" fill="#382E48"/>
      <rect x="70" y="49" width="10" height="20" rx="5" fill="#382E48"/>`,
    small: `<path d="M8 1C12 1 15 4 15 8C16 12 12 15 8 15C4 16 1 12 1 9C0 5 4 1 8 1Z" fill="#B7A2D0"/>
      <path d="M4 11C7 14 12 12 13 10" fill="none" stroke="#E2D3EE" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="5" y="5" width="2" height="4" rx="1" fill="#382E48"/>
      <rect x="9" y="5" width="2" height="4" rx="1" fill="#382E48"/>`,
  },
  {
    id: "d",
    name: "Fold",
    description: "A thick piece of yellow clay, folded into a small companion.",
    note: "A more compact shape. Its folded corner is distinct in a dock or a tab.",
    colors: ["#F1D18A", "#DFB658", "#AD7E31"],
    large: `<path d="M29 25C46 19 81 16 98 25C107 31 109 46 109 62C112 79 106 99 93 105C76 113 43 114 27 103C15 95 14 75 15 58C14 43 18 29 29 25Z" fill="url(#body)"/>
      <path d="M24 41C24 31 45 29 57 28" fill="none" stroke="#FFF0BF" stroke-width="5" stroke-linecap="round" opacity=".7"/>
      <path d="M101 78C94 71 82 72 78 83C74 96 86 105 94 103C103 100 109 88 101 78Z" fill="#AB7A2F" opacity=".65"/>
      <path d="M103 75C95 70 84 72 80 81C76 92 83 98 89 96C95 94 96 87 93 84" fill="none" stroke="#F2D18A" stroke-width="10" stroke-linecap="round"/>
      <rect x="39" y="49" width="10" height="20" rx="5" fill="#4D3924" transform="rotate(-4 44 59)"/>
      <rect x="66" y="48" width="10" height="20" rx="5" fill="#4D3924" transform="rotate(4 71 58)"/>`,
    small: `<path d="M4 2C6 1 11 1 13 2C15 3 14 7 15 10C15 13 13 15 10 15C7 15 3 15 2 13C1 11 1 6 2 4C2 3 3 2 4 2Z" fill="#E7BD64"/>
      <path d="M12 10C10 9 10 12 11 13" fill="none" stroke="#A27330" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="4" y="5" width="2" height="4" rx="1" fill="#4D3924"/>
      <rect x="8" y="5" width="2" height="4" rx="1" fill="#4D3924"/>`,
  },
];

function svg(concept, size) {
  const small = size <= 24;
  const [light, mid, dark] = concept.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${small ? 16 : 128} ${small ? 16 : 128}" role="img" aria-label="Clay ${concept.name} icon"><defs><radialGradient id="body" cx=".32" cy=".2" r=".92"><stop stop-color="${light}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs>${small ? concept.small : concept.large}</svg>`;
}

const dataUri = (source) => `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
const files = Object.fromEntries(
  concepts.map((concept) => [
    concept.id,
    Object.fromEntries(
      sizes.map((size) => {
        const source = svg(concept, size);
        writeFileSync(path.join(output, `${concept.id}-${concept.name.toLowerCase()}-${size}.svg`), `${source}\n`);
        return [size, dataUri(source)];
      }),
    ),
  ]),
);

const rows = concepts
  .map(
    (concept) => `<section id="${concept.id}" aria-labelledby="heading-${concept.id}">
      <div class="concept-heading"><h2 id="heading-${concept.id}">${concept.id.toUpperCase()}. ${concept.name}</h2><label class="pick"><input type="radio" name="choice" value="${concept.id}" ${concept.id === "b" ? "checked" : ""}/> Select ${concept.id.toUpperCase()}</label></div>
      <p class="description">${concept.description}</p>
      <div class="samples">${["light", "dark"]
        .map(
          (theme) =>
            `<div class="sample ${theme}"><span class="theme-label">${theme === "light" ? "Light" : "Dark"}</span><div class="size-row">${sizes
              .map(
                (size) =>
                  `<figure><a href="${files[concept.id][size]}" download="clay-${concept.name.toLowerCase()}-${size}.svg" aria-label="Download ${concept.name} at ${size} pixels as SVG"><img src="${files[concept.id][size]}" width="${size}" height="${size}" alt="${concept.name}, ${size} pixels"/></a><figcaption>${size}</figcaption></figure>`,
              )
              .join("")}</div></div>`,
        )
        .join("")}</div>
      <div class="concept-footer"><p>${concept.note}</p><div class="exports"><label class="sr-only" for="size-${concept.id}">PNG size for ${concept.name}</label><select id="size-${concept.id}">${sizes.map((size) => `<option value="${size}">${size} px</option>`).join("")}</select><button type="button" data-export="${concept.id}">Save PNG</button></div></div>
    </section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Clay icon studies</title>
<style>
:root{--bg:#faf9f6;--fg:#1f2328;--muted:#5f6672;--card:#fff;--line:#e6e3dc;--accent:#2457c5;--sans:"Inter",ui-sans-serif,system-ui,sans-serif;--serif:"Iowan Old Style","Charter",Georgia,serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;color:var(--foreground,var(--fg));font:15px/1.6 var(--sans)}.layout{max-width:1490px;margin:auto}main{min-width:0;max-width:1240px}h1,h2{font-family:var(--serif);font-weight:600;letter-spacing:-.01em}h1{font-size:2.3rem;line-height:1.15;margin:0 0 14px}h2{font-size:1.6rem;line-height:1.2;margin:0}.lede{font-size:1.12rem;margin:0 0 10px}.meta{color:var(--muted-foreground,var(--muted));font-size:.88rem;margin:0}.toc{display:flex;gap:20px;flex-wrap:wrap;padding:18px 0 24px}.toc a{color:var(--muted-foreground,var(--muted));text-decoration:none;text-underline-offset:4px}.toc a:hover{color:var(--accent);text-decoration:underline}section{margin:24px 0 0;padding-top:24px;border-top:1px solid var(--border,var(--line));scroll-margin-top:24px}.concept-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.description{margin:8px 0 16px;color:var(--muted-foreground,var(--muted))}.pick{display:flex;align-items:center;gap:7px;font-size:13px;white-space:nowrap;cursor:pointer}.pick input{accent-color:var(--accent);width:16px;height:16px}section:has(input:checked) .pick{color:var(--accent)}.samples{display:grid;gap:8px}.sample{position:relative;padding:12px 16px 10px;border-radius:12px;overflow-x:auto;border:1px solid transparent}.sample.light{background:#faf9f6;color:#5f6672;border-color:#e6e3dc}.sample.dark{background:#171a20;color:#a8afb9;border-color:#303640}.sample:before{content:"";position:absolute;inset:0;opacity:.035;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.6'/%3E%3C/svg%3E")}.theme-label{display:block;font-size:11px;margin-bottom:4px}.size-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;min-width:480px;max-width:900px;position:relative}figure{margin:0;text-align:center;flex:none}figure a{display:block;line-height:0;border-radius:6px}figure img{display:block;max-width:none}figcaption{font:11px/1.5 var(--mono);margin-top:5px}.concept-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:10px}.concept-footer p{font-size:12px;color:var(--muted-foreground,var(--muted));margin:0}.exports{display:flex;gap:6px;flex:none}button,select{font:12px var(--sans);border:1px solid var(--border,var(--line));border-radius:7px;background:var(--card,#fff);color:var(--card-foreground,var(--fg));padding:7px 9px;cursor:pointer}button:hover{border-color:var(--accent)}:focus-visible{outline:2px solid var(--accent);outline-offset:4px}::selection{background:#dce6fc;color:#1f2328}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}footer{border-top:1px solid var(--border,var(--line));margin-top:28px;padding:16px 0;color:var(--muted-foreground,var(--muted));font-size:12px}#status{min-height:20px}a{color:var(--accent)}
@media(min-width:1000px){.layout{display:grid;grid-template-columns:250px minmax(0,1fr)}.toc{position:sticky;top:0;height:fit-content;display:grid;gap:12px;padding:56px 24px;border-right:1px solid var(--line)}main{padding:56px}section{margin-top:40px;padding-top:32px}.samples{grid-template-columns:1fr}.sample{padding:16px 22px}}
@media(max-width:540px){h1{font-size:2rem}.concept-footer{align-items:flex-start;flex-direction:column;gap:10px}.size-row{justify-content:flex-start;gap:12px}.pick{font-size:12px}.sample{padding-left:12px;padding-right:12px}}
@media print{.toc,.pick,.exports,#status{display:none}.layout{display:block}main{padding:0}section{break-inside:avoid}body{color:var(--fg)}.sample{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="layout"><nav class="toc" aria-label="Icon concepts">${concepts.map((concept) => `<a href="#${concept.id}">${concept.id.toUpperCase()}. ${concept.name}</a>`).join("")}</nav><main><header><h1>Clay icon studies</h1><p class="lede">Compare four clay forms with agent eyes.</p><p class="meta">128, 96, 64, 48, 32, 24, and 16 px. All samples use their actual size.</p><p class="meta">The 24 and 16 px icons use simpler shapes. Click a size sample to download its SVG.</p></header>${rows}<footer><div id="status" aria-live="polite">B. Pebble is the Clay app icon.</div><span>Hand-drawn SVG. Transparent backgrounds. PNG export uses the selected pixel size.</span></footer></main></div><script>
const files=${JSON.stringify(files)};
const names=${JSON.stringify(Object.fromEntries(concepts.map((c) => [c.id, c.name])))};
document.querySelectorAll('input[name="choice"]').forEach(input=>input.addEventListener('change',()=>{document.getElementById('status').textContent='Selected '+input.value.toUpperCase()+'. '+names[input.value]+'. Tell your agent to apply this icon.'}));
document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.export;const size=Number(document.getElementById('size-'+id).value);try{const img=new Image();img.src=files[id][size];await img.decode();const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;canvas.getContext('2d').drawImage(img,0,0,size,size);const link=document.createElement('a');link.download='clay-'+names[id].toLowerCase()+'-'+size+'.png';link.href=canvas.toDataURL('image/png');link.click();document.getElementById('status').textContent='Exported '+names[id]+' at '+size+' pixels.'}catch{document.getElementById('status').textContent='PNG export failed. Select an icon to save its SVG.'}}));
</script></body></html>`;

writeFileSync(path.join(output, "index.html"), html);
console.log(`Wrote ${concepts.length * sizes.length} SVG icons and ${path.relative(root, output)}/index.html`);
