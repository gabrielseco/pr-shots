// One self-contained page that shows a run's screenshots as a carousel:
// arrow keys, a thumbnail strip, and #3 in the URL to open on the third.
// A pull request's description can't run scripts, so its thumbnails link here.

export const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );

/** A screenshot's name as its caption: `paid-with` reads "Paid with". */
export const label = (name) =>
  name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#16181d;color:#e8eaee;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;gap:16px;align-items:baseline;padding:12px 16px;border-bottom:1px solid #2a2e37}
h1{flex:1;min-width:0;margin:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
h1 small{margin-left:10px;font-weight:400;font-size:13px;color:#9aa1ae}
#count{color:#9aa1ae;font-variant-numeric:tabular-nums;white-space:nowrap}
header a{color:#9aa1ae;white-space:nowrap}
main{position:relative;min-height:0}
#stage{height:100%;overflow:auto;display:flex;padding:16px}
#shot{margin:auto;max-width:100%;max-height:100%;border-radius:6px;background:#fff;cursor:zoom-in}
.zoomed #shot{max-height:none;cursor:zoom-out}
main button{position:absolute;top:50%;translate:0 -50%;width:40px;height:64px;border:0;border-radius:8px;background:#000a;color:#fff;font-size:28px;line-height:1;cursor:pointer}
main button:hover{background:#000d}
main button:disabled{opacity:.25;cursor:default}
#prev{left:12px}
#next{right:24px}
nav{display:flex;gap:8px;padding:10px 16px;overflow-x:auto;border-top:1px solid #2a2e37}
nav a{flex:none;width:112px;height:70px;border-radius:6px;overflow:hidden;outline:2px solid transparent;outline-offset:1px;opacity:.55;background:#fff}
nav a:hover{opacity:.85}
nav a[aria-current]{opacity:1;outline-color:#6ea8ff}
nav img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
:focus-visible{outline:2px solid #6ea8ff;outline-offset:2px}
@media (max-width:600px){header a{display:none}nav a{width:80px;height:50px}}
`;

// Runs in the page. Moving between images replaces the history entry, so one
// Back returns to the pull request however many images were looked at.
function carousel() {
  const links = [...document.querySelectorAll('nav a')];
  const shot = document.getElementById('shot');
  const caption = document.getElementById('caption');
  const count = document.getElementById('count');
  const full = document.getElementById('full');
  const stage = document.getElementById('stage');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  let current = -1;

  const clamp = (index) => Math.min(Math.max(index, 0), links.length - 1);
  const fromHash = () => clamp((parseInt(location.hash.slice(1), 10) || 1) - 1);

  function show(index, { replace = true } = {}) {
    index = clamp(index);
    if (index === current) return;
    current = index;
    const link = links[index];
    shot.src = full.href = link.dataset.src;
    shot.alt = caption.textContent = link.title;
    count.textContent = `${index + 1} / ${links.length}`;
    links.forEach((other) => other.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'true');
    link.scrollIntoView({ block: 'nearest', inline: 'center' });
    prev.disabled = index === 0;
    next.disabled = index === links.length - 1;
    stage.scrollTo(0, 0);
    if (replace) history.replaceState(null, '', `#${index + 1}`);
    // The neighbours, so the next arrow press is instant.
    for (const near of [links[index + 1], links[index - 1]])
      if (near) new Image().src = near.dataset.src;
  }

  links.forEach((link, index) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      show(index);
    })
  );
  prev.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  shot.addEventListener('click', () =>
    document.body.classList.toggle('zoomed')
  );
  addEventListener('hashchange', () => show(fromHash(), { replace: false }));
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const to = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: links.length - 1,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    show(to);
  });

  show(fromHash(), { replace: false });
}

/** The page for `shots` (`{ name, url }`, in the order they are shown). */
export function galleryHtml({ title, shots }) {
  const strip = shots
    .map(
      ({ name, url }, index) =>
        `<a href="#${index + 1}" title="${escapeHtml(label(name))}" data-src="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="" loading="lazy"></a>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}<small id="caption"></small></h1>
<span id="count"></span>
<a id="full" target="_blank" rel="noopener">Open image</a>
</header>
<main>
<div id="stage"><img id="shot" alt=""></div>
<button id="prev" aria-label="Previous screenshot">&#8249;</button>
<button id="next" aria-label="Next screenshot">&#8250;</button>
</main>
<nav aria-label="Screenshots">
${strip}
</nav>
<script>(${carousel})()</script>
</body>
</html>
`;
}
