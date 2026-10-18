/*
 * Page furniture for every .sheet, so the documents themselves stay content.
 *
 *   ?mode=print   → 230 × 317 mm sheet: trim + 3 mm bleed + crop marks + slug
 *   ?mode=screen  → the 210 × 297 mm trim alone (bleed clipped)
 *   (no mode)     → preview in a browser: trim pages on grey
 *
 * Also numbers the running footers (.folio .pg) in page order.
 */
(function () {
  var mode = (new URLSearchParams(location.search).get('mode')) || 'preview';
  document.documentElement.classList.add(mode);
  var doc = document.body.getAttribute('data-doc') || '';
  var rev = document.body.getAttribute('data-rev') || '';
  var sheets = document.querySelectorAll('.sheet');
  var NS = 'http://www.w3.org/2000/svg';
  sheets.forEach(function (sheet, i) {
    var n = String(i + 1).padStart(2, '0');
    var pg = sheet.querySelector('.folio .pg');
    if (pg) pg.textContent = n;
    // Crop marks: at the trim lines, from 3 mm outside the trim (the bleed
    // edge) to 9 mm outside it. Sheet 230 × 317, trim at 10 / 220 and 10 / 307.
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'marks');
    svg.setAttribute('viewBox', '0 0 230 317');
    svg.setAttribute('width', '230mm');
    svg.setAttribute('height', '317mm');
    [[10, 1, 10, 7], [220, 1, 220, 7], [10, 310, 10, 316], [220, 310, 220, 316],
     [1, 10, 7, 10], [223, 10, 229, 10], [1, 307, 7, 307], [223, 307, 229, 307]].forEach(function (c) {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', c[0]); l.setAttribute('y1', c[1]); l.setAttribute('x2', c[2]); l.setAttribute('y2', c[3]);
      l.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(l);
    });
    sheet.appendChild(svg);
    var slug = document.createElement('div');
    slug.className = 'slug';
    slug.textContent = doc + '  ·  page ' + n + ' of ' + String(sheets.length).padStart(2, '0') + '  ·  ' + rev + '  ·  A4 210 × 297 mm, 3 mm bleed';
    sheet.appendChild(slug);
  });
})();
