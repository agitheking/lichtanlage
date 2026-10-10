// Scheinwerfer im 3D-Modell: Gehäuse, SpotLight, sichtbarer Lichtkegel, Zielmarker.
import * as THREE from 'three';
import { beamAngle, fixturePosition, fixtureShape, lightColor, lightLevel } from '../util/fixture.js';

// Lichtstärke der Vorschau in Candela bei 100 % (Kellerbühne, 2–4 m Wurfweite)
const CANDELA = 22;

const coneVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const coneFragment = /* glsl */ `
  uniform vec3 color;
  uniform float level;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float edge = pow(abs(dot(vNormal, vView)), 1.6);
    float fade = pow(vAlong, 1.4);
    gl_FragColor = vec4(color * level * edge * fade * 0.35, 1.0);
  }`;

function coneMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1, 1, 1) }, level: { value: 0 } },
    vertexShader: coneVertex,
    fragmentShader: coneFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function bodyFor(shape, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3 });
  const g = new THREE.Group();
  let lensR, lensZ;
  if (shape === 'round') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.22, 24), mat);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    lensR = 0.14; lensZ = 0.111;
  } else if (shape === 'profile') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.5, 18), mat);
    m.rotation.x = -Math.PI / 2;
    g.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.16), mat);
    back.position.z = -0.25;
    g.add(back);
    lensR = 0.075; lensZ = 0.251;
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.14), mat));
    // Torblenden
    const barn = new THREE.MeshStandardMaterial({ color: '#111', side: THREE.DoubleSide, roughness: 0.8 });
    for (const [x, y, rz, w, hgt] of [[0, 0.11, 0, 0.26, 0.1], [0, -0.11, 0, 0.26, 0.1], [0.13, 0, Math.PI / 2, 0.22, 0.1], [-0.13, 0, Math.PI / 2, 0.22, 0.1]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), barn);
      p.rotation.x = Math.PI / 2;
      p.rotation.y = rz;
      p.position.set(x * 1.1, y * 1.1, 0.12);
      g.add(p);
    }
    lensR = 0.09; lensZ = 0.071;
  }
  const lensMat = new THREE.MeshBasicMaterial({ color: '#222', toneMapped: false });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(lensR, 24), lensMat);
  lens.position.z = lensZ + 0.002;
  g.add(lens);
  return { group: g, mat, lensMat };
}

export class FixtureLayer {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'fixtures';
    scene.add(this.root);
    this.items = new Map();
    this.hitMeshes = [];
    this.showTargets = false;
    this.selection = new Set();
    this.focusId = null;
  }

  /** Baut alle Scheinwerfer neu (Rig/Typen/Bühne geändert). */
  build(fixtures, types, stage) {
    for (const it of this.items.values()) {
      this.root.remove(it.group, it.light, it.light.target, it.marker, it.yoke);
      it.light.dispose();
      it.group.traverse((o) => { o.geometry?.dispose(); });
    }
    this.items.clear();
    this.hitMeshes = [];
    for (const fx of fixtures) {
      const type = types[fx.typeId];
      const pos = new THREE.Vector3(...fixturePosition(stage, fx));
      const target = new THREE.Vector3(...fx.target);
      const angle = THREE.MathUtils.degToRad(beamAngle(fx, type));
      const shape = fixtureShape(fx, type);

      const group = new THREE.Group();
      group.position.copy(pos);
      group.lookAt(target);
      const body = bodyFor(shape, type?.render?.color ?? '#1c1c1c');
      group.add(body.group);

      // Bügel zur Aufhängung (zeigt immer nach oben)
      const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2), new THREE.MeshStandardMaterial({ color: '#333' }));
      yoke.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));

      const dist = pos.distanceTo(target);
      const len = dist * 1.02;
      const coneGeo = new THREE.ConeGeometry(Math.tan(angle / 2) * len, len, 40, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      coneGeo.translate(0, 0, len / 2);
      const cone = new THREE.Mesh(coneGeo, coneMaterial());
      cone.renderOrder = 10;
      group.add(cone);

      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.fixtureId = fx.id;
      group.add(hit);
      this.hitMeshes.push(hit);

      const light = new THREE.SpotLight(0xffffff, 0, 0, angle / 2, 0.45, 2);
      light.position.copy(pos);
      light.target.position.copy(target);

      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.12, 24),
        new THREE.MeshBasicMaterial({ color: '#4aa3ff', side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.copy(target).add(new THREE.Vector3(0, 0.01, 0));
      marker.renderOrder = 20;
      marker.visible = this.showTargets === true || this.showTargets === fx.id;

      this.root.add(group, light, light.target, marker, yoke);
      this.items.set(fx.id, { fx, type, group, body, cone, light, marker, yoke, pos, level: 0, color: [1, 1, 1] });
    }
    this.applySelection();
  }

  /** Lichtzustand übernehmen (aus Store-Levels oder Rohwerten). */
  update(levelsState, levelOf) {
    for (const it of this.items.values()) {
      const lv = levelOf(it.fx.id);
      const level = it.fx.enabled ? lightLevel(it.type, lv, levelsState) : 0;
      this.setLight(it.fx.id, level, lightColor(it.type, lv));
    }
  }

  setLight(id, level, rgb) {
    const it = this.items.get(id);
    if (!it) return;
    it.level = level;
    it.color = rgb;
    const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    it.light.color.copy(c);
    it.light.intensity = CANDELA * level;
    it.light.visible = level > 0.001;
    it.cone.material.uniforms.color.value.copy(c);
    it.cone.material.uniforms.level.value = level;
    it.cone.visible = level > 0.001;
    it.body.lensMat.color.setRGB(0.12 + rgb[0] * level * 3, 0.12 + rgb[1] * level * 3, 0.12 + rgb[2] * level * 3);
  }

  /** Zielmarker zeigen: true = alle, eine ID = nur dieser, false = keiner. */
  setShowTargets(on) {
    this.showTargets = on;
    for (const [id, it] of this.items) it.marker.visible = on === true || on === id;
  }

  setSelection(ids) {
    this.selection = new Set(ids);
    this.applySelection();
  }

  setFocus(id) {
    this.focusId = id;
    this.applySelection();
  }

  applySelection() {
    for (const [id, it] of this.items) {
      const sel = this.selection.has(id);
      it.body.mat.emissive.set(sel ? '#1d5fa8' : '#000000');
      it.marker.material.color.set(id === this.focusId ? '#ffc94a' : sel ? '#4aa3ff' : '#8a8f99');
    }
  }

  /** Pulsieren des gerade eingerichteten Scheinwerfers. */
  tick(time) {
    const it = this.items.get(this.focusId);
    if (!it) return;
    const k = 0.5 + 0.5 * Math.sin(time * 6);
    it.body.mat.emissive.setRGB(0.9 * k, 0.65 * k, 0.1 * k);
  }

  positionOf(id) {
    return this.items.get(id)?.pos;
  }
}
