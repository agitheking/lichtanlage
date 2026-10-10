// Die eine 3D-Ansicht der App. Sie wird zwischen den Tabs umgehängt (attach),
// damit es nur einen WebGL-Kontext gibt.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h } from '../util/dom.js';
import { arcT } from '../util/fixture.js';
import { buildScenery } from './scenery.js';
import { FixtureLayer } from './fixtures3d.js';

export class StageView {
  constructor() {
    this.el = h('div', { class: 'viewport' });
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.el.append(this.renderer.domElement);

    this.labelsEl = h('div', { class: 'labels' });
    this.hintEl = h('div', { class: 'hint', hidden: true });
    this.tooltipEl = h('div', { class: 'tooltip3d', hidden: true });
    this.roomLight = h('input', { type: 'range', min: 0, max: 100, value: 35, title: 'Raumlicht (nur Vorschau)' });
    this.labelToggle = h('input', { type: 'checkbox', checked: true });
    this.el.append(
      this.labelsEl, this.hintEl, this.tooltipEl,
      h('div', { class: 'overlay' },
        h('label', { class: 'row' }, 'Raumlicht', this.roomLight),
        h('label', { class: 'row' }, this.labelToggle, 'Nummern'),
        h('button', { class: 'btn small', onclick: () => this.resetCamera(), title: 'Ansicht zurücksetzen' }, '⟲'),
        h('button', { class: 'btn small', onclick: () => this.frontView(), title: 'Frontansicht' }, 'Front')),
    );

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050506');
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 14;
    this.controls.minDistance = 1;
    this.controls.maxPolarAngle = Math.PI * 0.62;

    this.hemi = new THREE.HemisphereLight('#fff6e8', '#3a3326', 1);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.1);
    this.scene.add(this.hemi, this.ambient);
    this.roomLight.addEventListener('input', () => this.applyRoomLight());
    this.applyRoomLight();

    this.fixtures = new FixtureLayer(this.scene);
    this.scenery = null;
    this.labels = new Map();
    this.labelToggle.addEventListener('change', () => { this.labelsEl.hidden = !this.labelToggle.checked; });

    // Callbacks (vom jeweiligen Tab gesetzt)
    this.onPickFixture = null; // (id, event)
    this.onPickEmpty = null;
    this.onPickPoint = null; // (THREE.Vector3, objectName) im Modus 'point'
    this.onPickArc = null; // (t) im Modus 'arc'
    this.mode = 'select';
    this.tooltipFor = null; // (id) → Text

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.setupPointer();
    this.resetCamera();

    new ResizeObserver(() => this.resize()).observe(this.el);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  attach(host) {
    if (this.el.parentElement !== host) host.append(this.el);
    this.resize();
  }

  applyRoomLight() {
    const k = this.roomLight.value / 100;
    this.hemi.intensity = 0.05 + k * 1.6;
    this.ambient.intensity = 0.02 + k * 0.25;
  }

  resetCamera() {
    this.camera.position.set(0.2, 1.8, 4.3);
    this.controls.target.set(0, 1.0, -2.0);
    this.controls.update();
  }

  frontView() {
    this.camera.position.set(0, 1.6, 3.6);
    this.controls.target.set(0, 1.9, -1.5);
    this.controls.update();
  }

  setStage(stage) {
    if (this.scenery) {
      this.scene.remove(this.scenery.root);
      this.scenery.root.traverse((o) => o.geometry?.dispose());
    }
    this.stage = stage;
    this.scenery = buildScenery(stage);
    this.scene.add(this.scenery.root);
  }

  setFixtures(fixtures, types) {
    if (!this.stage) return;
    this.fixtures.build(fixtures, types, this.stage);
    this.labelsEl.replaceChildren();
    this.labels.clear();
    fixtures.forEach((fx) => {
      const el = h('div', { class: 'fx-label' + (fx.verified ? '' : ' unverified') }, fx.id.replace(/^f0?/, ''));
      el.title = fx.name;
      this.labelsEl.append(el);
      this.labels.set(fx.id, el);
    });
    this.applyLabelClasses();
  }

  setSelection(ids) {
    this.fixtures.setSelection(ids);
    this.applyLabelClasses();
  }

  setFocus(id) {
    const changed = id !== this.fixtures.focusId;
    this.fixtures.setFocus(id);
    this.applyLabelClasses();
    if (changed && id) this.panTo(this.fixtures.positionOf(id));
  }

  /** Kamera seitlich verschieben, sodass x im Bild liegt (Blickrichtung bleibt). */
  panTo(pos) {
    if (!pos) return;
    const dx = pos.x * 0.6 - this.controls.target.x;
    this.camera.position.x += dx;
    this.controls.target.x += dx;
    this.controls.update();
  }

  applyLabelClasses() {
    for (const [id, el] of this.labels) {
      el.classList.toggle('sel', this.fixtures.selection.has(id));
      el.classList.toggle('focus', id === this.fixtures.focusId);
    }
  }

  setHint(text) {
    this.hintEl.hidden = !text;
    this.hintEl.textContent = text ?? '';
  }

  setMode(mode) {
    this.mode = mode;
    this.renderer.domElement.style.cursor = mode === 'select' ? '' : 'crosshair';
  }

  // ---------------------------------------------------------------- Picking

  setupPointer() {
    const c = this.renderer.domElement;
    let down = null;
    c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      down = null;
      this.pick(e);
    });
    c.addEventListener('pointermove', (e) => this.hover(e));
    c.addEventListener('pointerleave', () => { this.tooltipEl.hidden = true; });
  }

  ray(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pick(e) {
    this.ray(e);
    if (this.mode === 'point') {
      const hit = this.raycaster.intersectObjects(this.scenery.pickables, false)[0];
      if (hit) this.onPickPoint?.(hit.point, hit.object.name);
      return;
    }
    if (this.mode === 'arc') {
      const hit = this.raycaster.intersectObject(this.scenery.arcMesh, false)[0];
      if (hit) this.onPickArc?.(arcT(this.stage, hit.point.x, hit.point.z));
      else {
        // Klick knapp daneben: nächster Punkt auf dem Bogenkreis in Höhe des Rohrs
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.stage.lightArc.y);
        const p = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(plane, p)) this.onPickArc?.(arcT(this.stage, p.x, p.z));
      }
      return;
    }
    const hit = this.raycaster.intersectObjects(this.fixtures.hitMeshes, false)[0];
    if (hit) this.onPickFixture?.(hit.object.userData.fixtureId, e);
    else this.onPickEmpty?.(e);
  }

  hover(e) {
    if (e.buttons) return;
    this.ray(e);
    const hit = this.mode === 'select' ? this.raycaster.intersectObjects(this.fixtures.hitMeshes, false)[0] : null;
    const id = hit?.object.userData.fixtureId;
    const text = id && this.tooltipFor?.(id);
    if (text) {
      const r = this.el.getBoundingClientRect();
      this.tooltipEl.hidden = false;
      this.tooltipEl.textContent = text;
      this.tooltipEl.style.left = `${e.clientX - r.left}px`;
      this.tooltipEl.style.top = `${e.clientY - r.top}px`;
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.tooltipEl.hidden = true;
      if (this.mode === 'select') this.renderer.domElement.style.cursor = '';
    }
  }

  // ---------------------------------------------------------------- Render

  resize() {
    const w = this.el.clientWidth, hgt = this.el.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    // Hochformat: vertikales Sichtfeld so weit öffnen, dass die Bühnenbreite sichtbar bleibt
    const minHfov = THREE.MathUtils.degToRad(80);
    const vfov = 2 * Math.atan(Math.tan(minHfov / 2) / this.camera.aspect);
    this.camera.fov = Math.min(95, Math.max(55, THREE.MathUtils.radToDeg(vfov)));
    this.camera.updateProjectionMatrix();
  }

  frame() {
    if (!this.el.isConnected || !this.el.offsetParent) return;
    this.controls.update();
    this.fixtures.tick(this.clock.getElapsedTime());
    this.renderer.render(this.scene, this.camera);
    if (!this.labelsEl.hidden) this.updateLabels();
  }

  updateLabels() {
    const w = this.el.clientWidth, hgt = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const [id, el] of this.labels) {
      const p = this.fixtures.positionOf(id);
      if (!p) continue;
      v.copy(p).add(new THREE.Vector3(0, 0.22, 0)).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -100%)`;
    }
  }
}
