// Kulisse des Kellertheaters, erzeugt aus stage.json (keine Modelldateien nötig).
// Koordinaten: x = links→rechts aus Publikumssicht, y = oben, z = zum Publikum.
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** Querschnitt (x, y) entlang z von z0 nach z1 ziehen → Innenfläche eines Gewölbes. */
function sweepProfile(points, z0, z1) {
  const pos = [];
  const uv = [];
  const idx = [];
  points.forEach(([x, y], i) => {
    pos.push(x, y, z0, x, y, z1);
    uv.push(i / (points.length - 1), 0, i / (points.length - 1), 1);
  });
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function plasterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 200 + Math.random() * 45;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 14},0.35)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 14, 1 + Math.random() * 6, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function volcanoTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 384;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 384);
  sky.addColorStop(0, '#5b2d2a');
  sky.addColorStop(1, '#3a1c1a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 128, 384);
  ctx.fillStyle = '#d4552b';
  ctx.beginPath();
  ctx.moveTo(10, 384); ctx.lineTo(56, 150); ctx.lineTo(74, 150); ctx.lineTo(120, 384);
  ctx.fill();
  ctx.fillStyle = '#f2a03a';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    const x = 50 + Math.random() * 30;
    ctx.moveTo(x, 160); ctx.lineTo(x - 15 + Math.random() * 30, 384); ctx.lineTo(x + 6, 384);
    ctx.fill();
  }
  ctx.strokeStyle = '#ffe07a';
  ctx.lineWidth = 3;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(65, 150);
    ctx.quadraticCurveTo(40 + Math.random() * 50, 60, 20 + Math.random() * 90, 40 + Math.random() * 80);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Geraffter Vorhangstreifen: Ebene mit Wellen in z-Richtung. */
function curtain(width, height, color, folds = 7) {
  const g = new THREE.PlaneGeometry(width, height, folds * 6, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin((x / width + 0.5) * folds * Math.PI * 2) * 0.05);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, std(color, { side: THREE.DoubleSide, roughness: 0.95 }));
}

export function buildScenery(stage) {
  const root = new THREE.Group();
  root.name = 'scenery';
  const pickables = [];
  const H = stage.stageHeight;
  const halfW = stage.stageWidth / 2;
  const zBack = -stage.stageDepth;
  const v = stage.vault;
  const plaster = std('#ffffff', { map: plasterTexture(), roughness: 1, side: THREE.DoubleSide });
  const black = std('#151515', { roughness: 0.9 });
  const flat = std('#1d1f22', { roughness: 0.95 });

  // Saalboden
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), std('#bfbd84', { roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 2;
  floor.name = 'Saalboden';
  root.add(floor);
  pickables.push(floor);

  // Bühnenpodest mit gebogener Vorderkante
  const fa = stage.frontArc;
  const phiF = Math.asin(Math.min(1, halfW / fa.r));
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, -zBack);
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const phi = -phiF + (2 * phiF * i) / steps;
    const x = fa.cx + fa.r * Math.sin(phi);
    const z = fa.cz + fa.r * Math.cos(phi);
    shape.lineTo(x, -z);
  }
  shape.lineTo(halfW, -zBack);
  shape.closePath();
  const podGeo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false, curveSegments: 48 });
  podGeo.rotateX(-Math.PI / 2);
  const podium = new THREE.Mesh(podGeo, [std('#1a1a1a', { roughness: 0.55 }), std('#8a5a33', { roughness: 0.8 })]);
  podium.name = 'Bühnenboden';
  root.add(podium);
  pickables.push(podium);

  // Gewölbe (Tonnengewölbe, Achse entlang z)
  const prof = [[-v.halfWidth, 0]];
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI - (Math.PI * i) / 40;
    prof.push([v.halfWidth * Math.cos(a), v.springY + (v.apexY - v.springY) * Math.sin(a)]);
  }
  prof.push([v.halfWidth, 0]);
  const vault = new THREE.Mesh(sweepProfile(prof, zBack - 0.05, Math.max(v.zFront, 9)), plaster);
  vault.name = 'Gewölbe';
  root.add(vault);
  pickables.push(vault);

  // Rückwand hinter den Flats (Gewölbequerschnitt)
  const backShape = new THREE.Shape(prof.map(([x, y]) => new THREE.Vector2(x, y)));
  const backWall = new THREE.Mesh(new THREE.ShapeGeometry(backShape), std('#2a2724'));
  backWall.position.z = zBack - 0.05;
  root.add(backWall);

  // Portal: schwarze Blende über der Bühnenöffnung und seitliche Blenden
  root.add(box(halfW * 2 + 0.2, 0.7, 0.12, black, 0, 1.95, -0.75));
  root.add(box(0.5, 2.6 - H, 0.12, black, -halfW + 0.15, H, -1.0));
  root.add(box(0.5, 2.6 - H, 0.12, black, halfW - 0.4, H, -1.1));

  // Stellwände (Flats) an der Rückwand
  const yb = H;
  const addFlat = (x0, x1, h, mat, z = zBack + 0.05) => {
    const m = box(x1 - x0, h, 0.06, mat, (x0 + x1) / 2, yb, z);
    m.name = 'Rückwand';
    root.add(m);
    pickables.push(m);
    return m;
  };
  addFlat(-halfW, -1.6, 2.2, flat);
  addFlat(-1.6, 0.4, 2.2, std('#26292d'));
  // Kamin-/Durchreiche-Öffnung
  root.add(box(0.8, 0.45, 0.08, std('#050505'), -0.6, yb + 0.9, zBack + 0.09));
  root.add(box(0.95, 0.06, 0.12, std('#2f3236'), -0.6, yb + 1.35, zBack + 0.09));
  // Tür mit Vulkanbild
  const volcano = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.9), std('#ffffff', { map: volcanoTexture(), roughness: 0.7 }));
  volcano.position.set(0.65, yb + 1.0, zBack + 0.1);
  volcano.name = 'Vulkan-Tür';
  root.add(volcano);
  pickables.push(volcano);
  addFlat(0.4, 0.9, 2.2, flat, zBack + 0.03);
  // Weitere Tür (hell) mit Knauf
  const door = addFlat(1.0, 1.6, 1.95, std('#d9d4c4'), zBack + 0.08);
  door.name = 'Tür';
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035), std('#c8a440', { metalness: 0.7, roughness: 0.3 }));
  knob.position.set(1.5, yb + 1.0, zBack + 0.15);
  root.add(knob);
  // Schräge graue Wand rechts hinten
  const slant = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), std('#3b3d40', { side: THREE.DoubleSide }));
  slant.position.set(2.35, yb + 1.05, zBack + 0.75);
  slant.rotation.y = -Math.PI / 4;
  slant.name = 'Seitenwand';
  root.add(slant);
  pickables.push(slant);
  root.add(box(1.0, 1.0, 0.05, std('#55585c'), 2.6, yb, -3.1));
  // Kleine Treppe links hinten
  root.add(box(0.7, 0.18, 0.35, std('#d8cdb2'), -1.95, yb, zBack + 0.5));
  root.add(box(0.7, 0.36, 0.3, std('#d8cdb2'), -1.95, yb, zBack + 0.2));

  // Vorhänge
  const cl = new THREE.Group();
  [['#c23a2e', 0], ['#4f9b8e', 0.17], ['#e6dcc3', 0.34]].forEach(([c, dx]) => {
    const m = curtain(0.22, 2.25, c, 3);
    m.position.set(-halfW + 0.12 + dx * 0.6, H + 1.1, -0.95 + dx * 0.15);
    cl.add(m);
  });
  root.add(cl);
  const cr = new THREE.Group();
  const yellow = curtain(0.45, 2.2, '#e2a23a', 4);
  yellow.position.set(halfW - 0.5, H + 1.1, -1.05);
  yellow.rotation.y = -0.35;
  const red = curtain(0.35, 2.2, '#b8302a', 4);
  red.position.set(halfW - 0.2, H + 1.1, -0.95);
  red.rotation.y = -0.35;
  cr.add(yellow, red);
  root.add(cr);
  pickables.push(...cl.children, ...cr.children);

  // Lichtbogen (Kabelkanal) mit Abhängern
  const la = stage.lightArc;
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const phi = ((-la.phiMaxDeg - 3 + ((2 * la.phiMaxDeg + 6) * i) / 40) * Math.PI) / 180;
    pts.push(new THREE.Vector3(la.cx + la.r * Math.sin(phi), la.y, la.cz + la.r * Math.cos(phi)));
  }
  const arcCurve = new THREE.CatmullRomCurve3(pts);
  const arc = new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 80, 0.07, 6), std('#7a7a72', { metalness: 0.6, roughness: 0.45 }));
  arc.name = 'Lichtbogen';
  root.add(arc);
  const rodMat = std('#555555', { metalness: 0.5 });
  for (const t of [0.05, 0.3, 0.55, 0.8, 0.98]) {
    const p = arcCurve.getPoint(t);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1), rodMat);
    rod.position.set(p.x, la.y + 0.5, p.z);
    root.add(rod);
  }

  // Lüftungsrohr rechts oben
  const duct = std('#b8b8b0', { metalness: 0.75, roughness: 0.35 });
  const d1 = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 5.2, 24), duct);
  d1.rotation.x = Math.PI / 2;
  d1.position.set(3.05, 2.62, -1.4);
  root.add(d1);
  const d2 = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 24), duct);
  d2.rotation.z = Math.PI / 2;
  d2.rotation.y = -Math.PI / 4;
  d2.position.set(3.5, 2.45, 1.6);
  root.add(d2);

  // Rauchmelder, Deckenträger
  const red2 = std('#d01818', { roughness: 0.4 });
  for (const [x, y, z] of [[-2.5, 2.98, 0.8], [2.2, 3.1, 1.8]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red2);
    s.rotation.x = Math.PI;
    s.position.set(x, y, z);
    root.add(s);
  }
  root.add(box(1.3, 0.04, 0.05, std('#c9c4b3'), 0.9, 2.98, 0.5));

  // Ziegel-Tresen links vorne
  root.add(box(0.8, 0.95, 1.5, std('#a8644a', { roughness: 1 }), -4.0, 0, 0.6));
  root.add(box(0.85, 0.05, 1.55, std('#c08a4a'), -4.0, 0.95, 0.6));

  // Möbel
  for (const p of stage.props ?? []) {
    const obj = buildProp(p);
    obj.position.set(...p.position);
    obj.rotation.y = p.rotationY ?? 0;
    obj.name = p.name || p.kind;
    root.add(obj);
    obj.traverse((o) => { if (o.isMesh) { o.name = obj.name; pickables.push(o); } });
  }

  return { root, pickables, arcMesh: arc };
}

function buildProp(p) {
  const [w, h, d] = p.size;
  const mat = std(p.color);
  const g = new THREE.Group();
  if (p.kind === 'sofa') {
    g.add(box(w, h * 0.5, d, mat, 0, 0.08, 0));
    g.add(box(w, h * 0.5, d * 0.25, mat, 0, h * 0.5, -d * 0.375));
    g.add(box(w * 0.1, h * 0.3, d, mat, -w * 0.45, h * 0.5, 0));
    g.add(box(w * 0.1, h * 0.3, d, mat, w * 0.45, h * 0.5, 0));
    g.add(box(w * 0.95, 0.08, d * 0.9, std('#b08a50'), 0, 0, 0));
  } else if (p.kind === 'armchair') {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.42, h * 0.25, 24), mat);
    seat.position.y = h * 0.5;
    const back = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.48, w * 0.48, h * 0.4, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8), std(p.color, { side: THREE.DoubleSide }));
    back.position.y = h * 0.78;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h * 0.4), std('#5a3a20'));
    foot.position.y = h * 0.2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.35, w * 0.35, 0.04, 5), std('#5a3a20'));
    base.position.y = 0.02;
    g.add(seat, back, foot, base);
  } else if (p.kind === 'rug') {
    g.add(box(w, 0.01, d, mat, 0, 0, 0));
  } else {
    g.add(box(w, h, d, mat, 0, 0, 0));
  }
  return g;
}
