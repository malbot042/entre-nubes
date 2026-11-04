// Pantalla de armamento y tiro (I o botón de la barra): esquema de la aeronave
// con sus cargas en los soportes, selección del arma que dispara Z (cohetes,
// misil aire-tierra o aire-aire), modos de tiro del cañón y salva de cohetes, y
// estado del blanco fijado (si es válido para el arma elegida). El juego sigue
// en marcha con la ventana abierta.

const SALVOS = [[0, 'Continua'], [1, '1'], [2, '2'], [4, '4'], [8, '8']];

export class Armory {
  constructor({ combat, targeting, getSpec, onChange }) {
    this.combat = combat; this.targeting = targeting; this.getSpec = getSpec; this.onChange = onChange;
    this.el = document.getElementById('armory');
    this.cards = document.getElementById('arm-cards');
    this.tgtEl = document.getElementById('arm-target');
    this.cv = document.getElementById('arm-diagram');
    this.g = this.cv.getContext('2d');
    this.isOpen = false; this.t = 0; this.html = '';
    // al pulsar (no al soltar): el contenido se regenera varias veces por segundo
    this.cards.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-sel],[data-opt]');
      if (!b) return;
      const pr = this.combat.prefs;
      if (b.dataset.sel) this.combat.selectWeapon(b.dataset.sel);
      else if (b.dataset.opt === 'salvo') { pr.salvo = +b.dataset.val; this.combat.selectWeapon('rkt'); }
      else pr[b.dataset.opt] = b.dataset.val === '1';
      this.onChange?.();
      this.render(true);
    });
  }

  open() { if (!this.combat.player) return; this.isOpen = true; this.el.classList.remove('hidden'); this.render(true); }
  close() { this.isOpen = false; this.el.classList.add('hidden'); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  update(dt) {
    if (!this.isOpen) return;
    if (this.el.classList.contains('hidden')) { this.isOpen = false; return; } // cerrada con su ✕
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.2; this.render(); }
  }

  // estado del blanco fijado respecto a un arma
  readiness(w) {
    const tg = this.targeting, t = tg.target;
    if (w.n <= 0) return ['SIN MUNICIÓN', 'bad'];
    if (w.id === 'rkt') return tg.locked ? ['GUIADOS AL BLANCO FIJADO', 'ok'] : ['SIN GUÍA: APUNTA CON EL MORRO', ''];
    if (!t || !tg.locked) return [`FIJA UN BLANCO ${w.vs === 'air' ? 'AÉREO' : 'TERRESTRE'}`, 'warn'];
    if ((w.vs === 'air') !== !!t.air) return [`EL BLANCO NO ES ${w.vs === 'air' ? 'AÉREO' : 'TERRESTRE'}`, 'bad'];
    return ['LISTO PARA LANZAR', 'ok'];
  }

  render(force = false) {
    const c = this.combat, p = c.player, spec = this.getSpec();
    if (!p || !spec?.arms) return;
    const pr = c.prefs, a = spec.arms, sel = pr.sel;
    const opt = (key, val, label, on) => `<button data-opt="${key}" data-val="${val}" class="${on ? 'on' : ''}">${label}</button>`;
    const bar = (n, max) => `<div class="arm-bar"><i style="width:${Math.round(n / max * 100)}%"></i></div>`;
    let html = `<div class="arm-card gun">
      <div class="arm-h"><span>Cañón</span><b>${p.ammo} / ${a.gun.ammo}</b></div>${bar(p.ammo, a.gun.ammo)}
      <div class="arm-sub">Espacio · ${a.gun.rps * 60} disparos/min</div>
      <div class="arm-opts"><span>Tiro</span>${opt('burst', 0, 'Continuo', !pr.burst)}${opt('burst', 1, 'Ráfagas 0,4 s', pr.burst)}</div>
      <div class="arm-opts"><span>Puntería</span>${opt('aim', 1, 'Automática', pr.aim)}${opt('aim', 0, 'Eje del morro', !pr.aim)}</div>
    </div>`;
    for (const w of c.weapons()) {
      const [st, cls] = this.readiness(w);
      html += `<div class="arm-card${w.id === sel ? ' sel' : ''}" data-sel="${w.id}">
        <div class="arm-h"><span>${w.name}</span><b>${w.n} / ${w.max}</b></div>${bar(w.n, w.max)}
        <div class="arm-sub">${w.id === sel ? '<em>SELECCIONADA · Z</em>' : 'Clic para seleccionar'} · ${w.id === 'rkt' ? 'no guiados; guiados con blanco fijado' : w.vs === 'air' ? 'guiado infrarrojo contra aeronaves' : 'guiado contra vehículos y búnkeres'}</div>
        ${w.id === 'rkt' ? `<div class="arm-opts"><span>Salva</span>${SALVOS.map(([v, l]) => opt('salvo', v, l, pr.salvo === v)).join('')}</div>` : ''}
        <div class="arm-st ${cls}">${st}</div>
      </div>`;
    }
    if (force || html !== this.html) { this.cards.innerHTML = html; this.html = html; }
    const tg = this.targeting, cur = tg.cur;
    this.tgtEl.innerHTML = cur
      ? `<span>Blanco</span> <b>${tg.idText()}</b> · ${cur.range < 1000 ? Math.round(cur.range) + ' m' : (cur.range / 1000).toFixed(1) + ' km'} · ${tg.locked ? '<b class="lock">FIJADO</b>' : cur.far ? 'fuera de alcance' : 'fijando…'}`
      : '<span>Blanco</span> ninguno · Tab para elegir uno o J para el mapa';
    this.diagram(spec, p, sel);
  }

  // esquema en planta con las cargas: llenas las que quedan, huecas las gastadas
  diagram(spec, p, sel) {
    const g = this.g, W = this.cv.width, H = this.cv.height, cx = W / 2, heli = spec.type === 'heli';
    g.clearRect(0, 0, W, H);
    g.strokeStyle = '#8ea4b8'; g.fillStyle = 'rgba(142,164,184,0.12)'; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    if (heli) {
      g.ellipse(cx, H * 0.42, 16, 60, 0, 0, Math.PI * 2);
      g.moveTo(cx - 5, H * 0.62); g.lineTo(cx - 4, H * 0.95); g.lineTo(cx + 4, H * 0.95); g.lineTo(cx + 5, H * 0.62);
      g.rect(cx - 110, H * 0.4, 220, 12);                       // alas cortas
    } else {
      g.moveTo(cx, H * 0.04); g.lineTo(cx + 14, H * 0.3); g.lineTo(cx + 150, H * 0.62); g.lineTo(cx + 150, H * 0.7);
      g.lineTo(cx + 16, H * 0.62); g.lineTo(cx + 14, H * 0.82); g.lineTo(cx + 55, H * 0.95); g.lineTo(cx - 55, H * 0.95);
      g.lineTo(cx - 14, H * 0.82); g.lineTo(cx - 16, H * 0.62); g.lineTo(cx - 150, H * 0.7); g.lineTo(cx - 150, H * 0.62);
      g.lineTo(cx - 14, H * 0.3); g.closePath();
    }
    g.fill(); g.stroke();
    if (heli) { g.setLineDash([5, 7]); g.beginPath(); g.arc(cx, H * 0.42, 100, 0, Math.PI * 2); g.globalAlpha = 0.4; g.stroke(); g.globalAlpha = 1; g.setLineDash([]); }
    // soportes por tipo: distancia al eje y fila
    const a = spec.arms;
    const st = heli
      ? { rkt: [48, H * 0.46], ag: [82, H * 0.46], aa: [110, H * 0.36] }
      : { ag: [45, H * 0.6], rkt: [80, H * 0.64], aa: [146, H * 0.6] };
    const draw = (id, n, max, shape) => {
      if (!max) return;
      const [dx, y] = st[id], per = Math.ceil(max / 2), on = id === sel;
      const col = on ? '#62ff86' : '#e6edf3';
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
      for (const side of [-1, 1]) {
        if (shape === 'pod') {
          // lanzacohetes: uno por lado, lleno mientras quedan cohetes
          g.beginPath(); g.ellipse(cx + side * dx, y + 8, 6, 15, 0, 0, Math.PI * 2);
          if (n > 0) g.fill(); g.stroke();
          continue;
        }
        // raíles de misiles: uno por misil, mitad a cada lado
        const left = side < 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
        for (let i = 0; i < per; i++) {
          g.beginPath(); g.rect(cx + side * (dx + (i - (per - 1) / 2) * 7) - 2, y - 10, 4, 22);
          if (i < left) g.fill(); else g.stroke();
        }
      }
    };
    draw('rkt', p.rockets, a.rockets, 'pod');
    if (a.ag) draw('ag', p.ag, a.ag.n, 'rail');
    if (a.aa) draw('aa', p.aa, a.aa.n, 'rail');
    // leyenda: munición de cada arma, la seleccionada en verde
    const rows = [['GUN', p.ammo, false], ['RKT', p.rockets, sel === 'rkt']];
    if (a.ag) rows.push([a.ag.short, p.ag, sel === 'ag']);
    if (a.aa) rows.push([a.aa.short, p.aa, sel === 'aa']);
    g.font = 'bold 11px "Share Tech Mono", monospace'; g.textAlign = 'left';
    rows.forEach(([l, n, on], i) => { g.fillStyle = on ? '#62ff86' : '#e6edf3'; g.fillText(`${on ? '▸ ' : '  '}${l} ${n}`, 8, 16 + i * 14); });
    g.fillStyle = '#8ea4b8'; g.textAlign = 'center';
    g.fillText(spec.name, cx, H - 6);
  }
}
