(() => {
  const $ = (id) => document.getElementById(id);
  const P = PRESETS.c65;
  const video = $('video'), view = $('view'), vctx = view.getContext('2d');
  const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });

  const state = {
    facing: 'environment', zoom: 1, vga: true, stamp: false,
    frozen: null,        // {blob, url} во время просмотра снимка
    screen: 'live',      // live | menu | gallery | photo
    menuIdx: 0, running: false, stream: null,
  };
  const ZOOM_MAX = 4;

  // ---------- камера ----------
  async function startCamera() {
    $('err').textContent = '';
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      $('err').textContent = 'Нет доступа к камере: ' + (e.name || e.message);
      $('start').hidden = false;
      return;
    }
    video.srcObject = state.stream;
    await video.play().catch(() => {});
    $('start').hidden = true;
    if (!state.running) { state.running = true; requestAnimationFrame(loop); }
  }

  // ---------- эффект ----------
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  function drawSource(ctx, w, h) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return false;
    let sw = vw, sh = vw * 3 / 4;
    if (sh > vh) { sh = vh; sw = vh * 4 / 3; }
    sw /= state.zoom; sh /= state.zoom;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.save();
    if (state.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    return true;
  }

  function applyLook(ctx, w, h, k) {
    // k — масштаб эффектов относительно полного размера (шум/резкость на превью слабее)
    const img = ctx.getImageData(0, 0, w, h), d = img.data, src = new Uint8ClampedArray(d);
    const [tr, tg, tb] = P.tint, [sr, sg, sb] = P.shadowTint;
    const mR = 255 / ((1 << P.bitsR) - 1), mG = 255 / ((1 << P.bitsG) - 1), mB = 255 / ((1 << P.bitsB) - 1);
    const qR = (1 << P.bitsR) - 1, qG = (1 << P.bitsG) - 1, qB = (1 << P.bitsB) - 1;
    const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy);
    const sh = P.sharpen;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = src[i], g = src[i + 1], b = src[i + 2];
        // резкость с ореолами (3x3)
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          const l = i - 4, rr = i + 4, u = i - w * 4, dn = i + w * 4;
          r += sh * (4 * r - src[l] - src[rr] - src[u] - src[dn]) * 0.5;
          g += sh * (4 * g - src[l + 1] - src[rr + 1] - src[u + 1] - src[dn + 1]) * 0.5;
          b += sh * (4 * b - src[l + 2] - src[rr + 2] - src[u + 2] - src[dn + 2]) * 0.5;
        }
        // контраст
        r = (r - 128) * P.contrast + 128; g = (g - 128) * P.contrast + 128; b = (b - 128) * P.contrast + 128;
        // насыщенность
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum + (r - lum) * P.saturation; g = lum + (g - lum) * P.saturation; b = lum + (b - lum) * P.saturation;
        // оттенок + тени
        const sf = 1 - Math.min(1, lum / 160);
        r += tr + sr * sf; g += tg + sg * sf; b += tb + sb * sf;
        // bloom на засветах
        if (lum > 200) { const bl = (lum - 200) * P.bloom; r += bl; g += bl; b += bl; }
        // шум
        const n = (Math.random() - 0.5) * P.noise * k;
        r += n + (Math.random() - 0.5) * P.chromaNoise * k;
        g += n + (Math.random() - 0.5) * P.chromaNoise * k;
        b += n + (Math.random() - 0.5) * P.chromaNoise * k;
        // виньетка
        const v = 1 - P.vignette * Math.pow(Math.hypot(x - cx, y - cy) / maxd, 2);
        r *= v; g *= v; b *= v;
        // RGB565
        d[i] = Math.round(clamp(r) / 255 * qR) * mR;
        d[i + 1] = Math.round(clamp(g) / 255 * qG) * mG;
        d[i + 2] = Math.round(clamp(b) / 255 * qB) * mB;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function stampDate(ctx, w, h) {
    const t = new Date(), p = (n) => String(n).padStart(2, '0');
    ctx.font = `${Math.round(h / 14)}px "VT323", monospace`;
    ctx.fillStyle = P.stampColor; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()}`, w - 8, h - 6);
  }

  // ---------- цикл превью ----------
  let lastT = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    if (state.screen !== 'live' || state.frozen || t - lastT < 50) return; // ~20 fps
    lastT = t;
    const [fw, fh] = state.vga ? P.vga : P.qvga;
    const w = Math.round(fw * P.previewScale), h = Math.round(fh * P.previewScale);
    if (work.width !== w) { work.width = w; work.height = h; }
    if (view.width !== w) { view.width = w; view.height = h; }
    if (!drawSource(wctx, w, h)) return;
    applyLook(wctx, w, h, P.previewScale * 2);
    vctx.drawImage(work, 0, 0);
    if (state.stamp) stampDate(vctx, w, h);
  }

  // ---------- съёмка ----------
  let audioCtx;
  function shutterSound() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime, len = audioCtx.sampleRate * 0.12;
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = audioCtx.createBufferSource(); src.buffer = buf;
      const f = audioCtx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200;
      const g = audioCtx.createGain(); g.gain.value = 0.6;
      src.connect(f).connect(g).connect(audioCtx.destination); src.start(now);
      const o = audioCtx.createOscillator(), og = audioCtx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(1800, now + 0.09); o.frequency.setValueAtTime(1200, now + 0.12);
      og.gain.setValueAtTime(0.0001, now); og.gain.setValueAtTime(0.15, now + 0.09); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(og).connect(audioCtx.destination); o.start(now + 0.09); o.stop(now + 0.2);
    } catch (_) {}
  }

  function capture() {
    if (state.frozen || state.screen !== 'live' || !video.videoWidth) return;
    shutterSound();
    const fl = $('flash'); fl.className = 'on'; requestAnimationFrame(() => requestAnimationFrame(() => { fl.className = 'off'; }));
    const [w, h] = state.vga ? P.vga : P.qvga;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    drawSource(ctx, w, h);
    applyLook(ctx, w, h, w / 320);
    if (state.stamp) stampDate(ctx, w, h);
    c.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => {
        state.frozen = { blob, url: reader.result };
        pushGallery(reader.result);
        showPhoto(reader.result, 0);
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', P.jpegQuality);
  }

  function showPhoto(url, idx) {
    state.screen = 'photo'; state.photoIdx = idx;
    let pv = $('photoView');
    if (!pv) { pv = document.createElement('div'); pv.id = 'photoView'; pv.appendChild(document.createElement('img')); $('viewfinder').appendChild(pv); }
    pv.firstChild.src = url; pv.hidden = false;
    setSoft('Опции', 'Назад');
  }

  async function savePhoto() {
    const blob = state.frozen && state.frozen.blob;
    if (!blob) return;
    const name = `IMG_${Date.now()}.jpg`;
    const file = new File([blob], name, { type: 'image/jpeg' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }

  // меню всегда последним в DOM и поверх фото/галереи
  function showMenuLayer() { const m = $('menu'); m.style.zIndex = 10; $('viewfinder').appendChild(m); m.hidden = false; }

  // меню снимка: из галереи — Открыть / Сохранить / Удалить, из просмотра — Сохранить / Удалить
  const photoMenuList = () => state.menuFrom === 'gallery' ? ['Открыть', 'Сохранить', 'Удалить'] : ['Сохранить', 'Удалить'];
  function renderPhotoMenu() {
    const el = $('menu');
    el.innerHTML = '<div class="title">Снимок</div>';
    photoMenuList().forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'item' + (i === state.menuIdx ? ' sel' : '');
      d.textContent = t; d.onclick = () => { state.menuIdx = i; photoMenuSelect(); };
      el.appendChild(d);
    });
  }
  function openPhotoMenu() {
    if (state.screen === 'gallery' && !loadGallery().length) return;
    state.menuFrom = state.screen; state.screen = 'photomenu'; state.menuIdx = 0;
    renderPhotoMenu(); showMenuLayer(); setSoft('Выбор', 'Назад');
  }
  function closePhotoMenu() {
    $('menu').hidden = true; state.screen = state.menuFrom;
    if (state.screen === 'gallery') setSoft('Опции', 'Назад'); else setSoft('Опции', 'Назад');
  }
  async function openFromGallery(idx) {
    const u = loadGallery()[idx]; if (!u) return;
    state.frozen = { url: u, blob: await (await fetch(u)).blob() }; showPhoto(u, idx);
  }
  async function photoMenuSelect() {
    const fromGallery = state.menuFrom === 'gallery';
    const idx = fromGallery ? state.galIdx : state.photoIdx;
    const action = photoMenuList()[state.menuIdx];
    $('menu').hidden = true; state.screen = state.menuFrom;
    if (action === 'Открыть') { await openFromGallery(idx); return; }
    if (action === 'Сохранить') {
      if (fromGallery) { const u = loadGallery()[idx]; state.frozen = { url: u, blob: await (await fetch(u)).blob() }; }
      setSoft('Опции', 'Назад'); await savePhoto(); return;
    }
    const g = loadGallery(); g.splice(idx, 1); storeGallery(g);
    state.galIdx = Math.max(0, Math.min(state.galIdx, g.length - 1));
    if (fromGallery) { openGallery(); return; }
    closePhoto();
    if (galleryOpen) openGallery();
  }

  function closePhoto() {
    state.frozen = null;
    const pv = $('photoView'); if (pv) pv.hidden = true;
    state.screen = galleryOpen ? 'gallery' : 'live';
    if (galleryOpen) { setSoft('Опции', 'Назад'); } else setSoft('Опции', 'Галерея');
  }

  // ---------- галерея ----------
  let galleryOpen = false;
  const GKEY = 'c65gallery';
  function loadGallery() { try { return JSON.parse(localStorage.getItem(GKEY)) || []; } catch (_) { return []; } }
  function pushGallery(url) {
    const g = loadGallery(); g.unshift(url); storeGallery(g);
  }
  function storeGallery(g) {
    while (true) { try { localStorage.setItem(GKEY, JSON.stringify(g)); break; } catch (_) { if (!g.length) break; g.pop(); } }
  }
  function openGallery() {
    galleryOpen = true; state.screen = 'gallery';
    const g = loadGallery(), el = $('gallery');
    el.innerHTML = '<div class="title">Галерея</div>' + (g.length ? '<div class="grid"></div>' : '<div class="empty">Нет снимков</div>');
    const grid = el.querySelector('.grid');
    state.galIdx = Math.max(0, Math.min(state.galIdx || 0, g.length - 1));
    g.forEach((u, idx) => {
      const im = document.createElement('img'); im.src = u;
      if (idx === state.galIdx) im.className = 'sel';
      im.onclick = () => {
        if (state.galIdx === idx) { openFromGallery(idx); return; }
        grid.querySelectorAll('img').forEach((n, k) => n.classList.toggle('sel', k === idx)); state.galIdx = idx;
      };
      grid.appendChild(im);
    });
    el.hidden = false; setSoft(g.length ? 'Опции' : '', 'Назад');
  }
  function closeGallery() { galleryOpen = false; $('gallery').hidden = true; state.screen = 'live'; setSoft('Опции', 'Галерея'); }

  // ---------- меню ----------
  const menuItems = () => [
    ['Разрешение', state.vga ? 'VGA' : 'QVGA'],
    ['Дата на фото', state.stamp ? 'Вкл' : 'Выкл'],
    ['Камера', state.facing === 'user' ? 'Фронт.' : 'Основная'],
  ];
  function renderMenu() {
    const el = $('menu');
    el.innerHTML = '<div class="title">Опции камеры</div>';
    menuItems().forEach(([a, b], i) => {
      const d = document.createElement('div'); d.className = 'item' + (i === state.menuIdx ? ' sel' : '');
      d.innerHTML = `<span>${a}</span><span>${b}</span>`;
      d.onclick = () => { state.menuIdx = i; menuSelect(); };
      el.appendChild(d);
    });
  }
  function openMenu() { state.screen = 'menu'; renderMenu(); showMenuLayer(); setSoft('Выбор', 'Назад'); }
  function closeMenu() { $('menu').hidden = true; state.screen = 'live'; setSoft('Опции', 'Галерея'); updateHud(); }
  function menuSelect() {
    const i = state.menuIdx;
    if (i === 0) state.vga = !state.vga;
    if (i === 1) state.stamp = !state.stamp;
    if (i === 2) { state.facing = state.facing === 'user' ? 'environment' : 'user'; startCamera(); }
    renderMenu();
  }

  // ---------- UI ----------
  function setSoft(l, r) { $('skLeft').textContent = l; $('skRight').textContent = r; }
  function updateHud() { $('hudRes').textContent = state.vga ? 'VGA' : 'QVGA'; $('hudZoom').textContent = state.zoom.toFixed(1).replace('.0', '') + 'x'; }
  function setZoom(z) { state.zoom = Math.min(ZOOM_MAX, Math.max(1, Math.round(z * 10) / 10)); updateHud(); }

  $('startBtn').onclick = startCamera;
  $('shutter').onclick = capture;
  $('zoomIn').onclick = () => state.screen === 'photomenu' ? (state.menuIdx = (state.menuIdx + photoMenuList().length - 1) % photoMenuList().length, renderPhotoMenu()) : state.screen === 'menu' ? (state.menuIdx = (state.menuIdx + 2) % 3, renderMenu()) : setZoom(state.zoom + 0.5);
  $('zoomOut').onclick = () => state.screen === 'photomenu' ? (state.menuIdx = (state.menuIdx + 1) % photoMenuList().length, renderPhotoMenu()) : state.screen === 'menu' ? (state.menuIdx = (state.menuIdx + 1) % 3, renderMenu()) : setZoom(state.zoom - 0.5);
  $('skLeft').onclick = () => {
    if (state.screen === 'live') openMenu();
    else if (state.screen === 'menu') menuSelect();
    else if (state.screen === 'photo' || state.screen === 'gallery') openPhotoMenu();
    else if (state.screen === 'photomenu') photoMenuSelect();
  };
  $('skRight').onclick = () => {
    if (state.screen === 'live') openGallery();
    else if (state.screen === 'menu') closeMenu();
    else if (state.screen === 'gallery') closeGallery();
    else if (state.screen === 'photo') closePhoto();
    else if (state.screen === 'photomenu') closePhotoMenu();
  };

  // pinch-to-zoom
  let pd = 0, pz = 1;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  $('viewfinder').addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pd = dist(e); pz = state.zoom; } }, { passive: true });
  $('viewfinder').addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pd && state.screen === 'live') { e.preventDefault(); setZoom(pz * dist(e) / pd); } }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // часы
  function tick() { const t = new Date(); $('clock').textContent = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); }
  if (document.fonts) document.fonts.load('16px VT323');
  tick(); setInterval(tick, 20000); updateHud();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.stream && !state.stream.active) startCamera();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
