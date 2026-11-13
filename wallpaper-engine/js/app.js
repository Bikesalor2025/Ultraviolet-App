/* Lumen Wallpaper Engine — engine + interface */
(function () {
	"use strict";
	const { WALLPAPERS, mediaDef } = window.WE;
	const $ = (s, r = document) => r.querySelector(s);
	const $$ = (s, r = document) => [...r.querySelectorAll(s)];

	/* ---------- icons ---------- */
	const ICONS = {
		search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
		play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
		pause: '<path d="M7 4v16M17 4v16" stroke-width="3.2"/>',
		prev: '<path d="M19 20L9 12l10-8zM5 19V5"/>',
		next: '<path d="M5 4l10 8-10 8zM19 5v14"/>',
		grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
		sliders:
			'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
		camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
		maximize:
			'<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
		eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
		heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		x: '<path d="M18 6L6 18M6 6l12 12"/>',
		trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
		reset: '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
		shuffle:
			'<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
		upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
	};
	const icon = (n) => `<svg viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;
	const hydrate = (root) =>
		$$("i[data-icon]", root).forEach(
			(i) => (i.innerHTML = icon(i.dataset.icon))
		);
	function h(tag, attrs, ...kids) {
		const el = document.createElement(tag);
		for (const k in attrs || {}) {
			const v = attrs[k];
			if (k === "class") el.className = v;
			else if (k === "html") el.innerHTML = v;
			else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
			else if (v !== false && v != null) el.setAttribute(k, v);
		}
		for (const kid of kids.flat())
			if (kid != null) el.append(kid.nodeType ? kid : String(kid));
		return el;
	}
	const ico = (n) => h("i", { "data-icon": n, html: icon(n) });

	/* ---------- state ---------- */
	const STORE = "lumen.we.v1";
	const DEFAULTS = {
		current: "aurora",
		chip: "All",
		params: {},
		favorites: [],
		presets: {},
		display: {
			speed: 1,
			brightness: 100,
			contrast: 100,
			saturation: 100,
			hue: 0,
			blur: 0,
			vignette: 25,
			scale: "auto",
			fps: 60,
			transition: 900,
		},
		clock: {
			on: false,
			style: "digital",
			pos: "center",
			size: 100,
			h24: false,
			seconds: false,
			date: true,
			color: "#ffffff",
		},
		audio: { sens: 1.5 },
		playlist: { on: false, interval: 300, order: "sequential", source: "all" },
		panels: { library: true, inspector: true },
	};
	const state = structuredClone(DEFAULTS);
	try {
		const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
		for (const k in DEFAULTS) {
			if (!(k in saved)) continue;
			if (
				DEFAULTS[k] &&
				typeof DEFAULTS[k] === "object" &&
				!Array.isArray(DEFAULTS[k])
			)
				Object.assign(state[k], saved[k]);
			else state[k] = saved[k];
		}
	} catch {
		/* corrupt or unavailable storage: start fresh */
	}
	let saveTimer = 0;
	function save() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(STORE, JSON.stringify(state));
			} catch {
				/* storage full or blocked */
			}
		}, 200);
	}

	let defs = [...WALLPAPERS];
	const byId = (id) => defs.find((d) => d.id === id);
	const defaultParams = (def) =>
		Object.fromEntries(def.params.map((p) => [p.key, p.default]));
	function paramsFor(def) {
		const p = (state.params[def.id] = state.params[def.id] || {});
		for (const d of def.params) if (!(d.key in p)) p[d.key] = d.default;
		return p;
	}

	/* ---------- toasts ---------- */
	function toast(msg) {
		const t = h("div", { class: "toast" }, msg);
		$("#toasts").append(t);
		setTimeout(() => t.classList.add("out"), 2200);
		setTimeout(() => t.remove(), 2600);
	}

	/* ---------- media storage (IndexedDB) ---------- */
	const idb = {
		db: null,
		open() {
			return new Promise((res, rej) => {
				const r = indexedDB.open("lumen-we", 1);
				r.onupgradeneeded = () =>
					r.result.createObjectStore("media", { keyPath: "id" });
				r.onsuccess = () => res((this.db = r.result));
				r.onerror = () => rej(r.error);
			});
		},
		tx(mode, fn) {
			return new Promise((res, rej) => {
				if (!this.db) return rej(new Error("no database"));
				const t = this.db.transaction("media", mode);
				const rq = fn(t.objectStore("media"));
				t.oncomplete = () => res(rq.result);
				t.onerror = t.onabort = () => rej(t.error);
			});
		},
		all() {
			return this.tx("readonly", (s) => s.getAll());
		},
		put(v) {
			return this.tx("readwrite", (s) => s.put(v));
		},
		del(id) {
			return this.tx("readwrite", (s) => s.delete(id));
		},
	};

	/* ---------- engine ---------- */
	const stage = $("#stage");
	const engine = {
		layers: [],
		time: 0,
		paused: false,
		last: 0,
		fps: 0,
		mouse: { x: 0.5, y: 0.5, active: false },
		audio: 0,
		analyser: null,
		audioBuf: null,
		audioStream: null,
		cycle: 0,
		scale() {
			const s = state.display.scale;
			return s === "auto"
				? Math.min(window.devicePixelRatio || 1, 2)
				: +s || 1;
		},
		size() {
			const s = this.scale();
			return [
				Math.max(1, Math.round(innerWidth * s)),
				Math.max(1, Math.round(innerHeight * s)),
			];
		},
		env(layer) {
			return {
				params: layer.params,
				mouse: this.mouse,
				audio: this.audio,
				px: this.scale(),
			};
		},
		show(def, instant) {
			const canvas = document.createElement("canvas");
			[canvas.width, canvas.height] = this.size();
			let inst;
			try {
				inst = def.create(canvas);
			} catch (e) {
				console.error(e);
				toast(`Couldn't start “${def.name}” on this device`);
				return false;
			}
			const layer = { def, canvas, inst, params: paramsFor(def) };
			const old = this.layers.slice();
			const dur = instant ? 0 : state.display.transition;
			canvas.style.opacity = 0;
			canvas.style.transition = `opacity ${dur}ms ease`;
			stage.append(canvas);
			this.layers.push(layer);
			try {
				inst.frame(this.time, 0.016, this.env(layer));
			} catch (e) {
				console.error(e);
			}
			void canvas.offsetWidth;
			canvas.style.opacity = 1;
			setTimeout(() => {
				for (const l of old) {
					const i = this.layers.indexOf(l);
					if (i < 0) continue;
					this.layers.splice(i, 1);
					l.inst.destroy();
					l.canvas.remove();
				}
			}, dur + 60);
			return true;
		},
		resize() {
			const [W, H] = this.size();
			for (const l of this.layers) {
				if (l.canvas.width === W && l.canvas.height === H) continue;
				l.canvas.width = W;
				l.canvas.height = H;
				if (l.inst.resize) l.inst.resize();
			}
			$("#st-res").textContent = `${W} × ${H}`;
		},
		setPaused(p) {
			this.paused = p;
			document.body.classList.toggle("paused", p);
			for (const l of this.layers) if (l.inst.setPaused) l.inst.setPaused(p);
			const b = $("#btn-play");
			b.firstElementChild.innerHTML = icon(p ? "play" : "pause");
			b.dataset.tip = (p ? "Play" : "Pause") + " (Space)";
			b.setAttribute("aria-label", p ? "Play" : "Pause");
		},
		draw(dt) {
			for (const l of this.layers) {
				try {
					l.inst.frame(this.time, dt, this.env(l));
				} catch (e) {
					if (!l.failed) console.error(e);
					l.failed = true;
				}
			}
		},
		tick(now) {
			requestAnimationFrame((t) => this.tick(t));
			const cap = state.display.fps;
			const real = now - this.last;
			if (cap && real < 1000 / cap - 2) return;
			this.last = now;
			const rdt = Math.min(real / 1000, 0.1);
			this.fps += (1000 / Math.max(real, 1) - this.fps) * 0.08;
			if (this.analyser) {
				this.analyser.getByteFrequencyData(this.audioBuf);
				let s = 0;
				for (let i = 0; i < 24; i++) s += this.audioBuf[i];
				const target = Math.min(1, (s / 24 / 255) * state.audio.sens);
				this.audio += (target - this.audio) * 0.3;
			} else this.audio = 0;
			if (this.paused) return;
			const dt = rdt * state.display.speed;
			this.time += dt;
			this.draw(dt);
			if (state.playlist.on) {
				this.cycle += rdt;
				if (this.cycle >= state.playlist.interval) step(1, true);
			}
		},
		async audioOn() {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			const AC = window.AudioContext || window.webkitAudioContext;
			const ac = (this.ac = new AC());
			const an = ac.createAnalyser();
			an.fftSize = 256;
			an.smoothingTimeConstant = 0.7;
			ac.createMediaStreamSource(stream).connect(an);
			this.audioStream = stream;
			this.audioBuf = new Uint8Array(an.frequencyBinCount);
			this.analyser = an;
		},
		audioOff() {
			if (this.audioStream)
				this.audioStream.getTracks().forEach((t) => t.stop());
			if (this.ac) this.ac.close();
			this.analyser = this.audioStream = this.ac = null;
		},
	};

	/* ---------- selecting wallpapers ---------- */
	function select(id, opts = {}) {
		const def = byId(id) || defs[0];
		if (!opts.force && engine.layers.at(-1)?.def === def) return;
		if (!engine.show(def, opts.instant)) return;
		state.current = def.id;
		engine.cycle = 0;
		save();
		$("#st-name").textContent = def.name;
		document.title = `${def.name} — Lumen`;
		$$(".card").forEach((c) =>
			c.classList.toggle("active", c.dataset.id === def.id)
		);
		renderWallpaperTab();
	}
	function playlistPool() {
		let pool = defs;
		if (state.playlist.source === "favorites") {
			const f = defs.filter((d) => state.favorites.includes(d.id));
			if (f.length) pool = f;
		}
		return pool;
	}
	function step(dir, auto) {
		const pool = auto ? playlistPool() : visibleDefs();
		const list = pool.length ? pool : defs;
		let i = list.findIndex((d) => d.id === state.current);
		if (auto && state.playlist.order === "shuffle" && list.length > 1) {
			let j;
			do j = (Math.random() * list.length) | 0;
			while (j === i);
			i = j;
		} else i = (i + dir + list.length) % list.length;
		engine.cycle = 0;
		select(list[i].id);
	}
	function toggleFav(id) {
		const i = state.favorites.indexOf(id);
		if (i < 0) state.favorites.push(id);
		else state.favorites.splice(i, 1);
		save();
		renderGrid();
		if (id === state.current) renderWallpaperTab();
	}

	/* ---------- thumbnails ---------- */
	const thumbs = new Map();
	async function makeThumb(def) {
		if (def.thumb) return def.thumb();
		const c = document.createElement("canvas");
		c.width = 480;
		c.height = 300;
		const inst = def.create(c);
		const env = {
			params: defaultParams(def),
			mouse: { x: 0.5, y: 0.5, active: false },
			audio: 0,
			px: 0.8,
		};
		let t = def.t0 || 0;
		for (let i = 0; i < (def.warm || 1); i++) {
			t += 1 / 30;
			inst.frame(t, 1 / 30, env);
		}
		const url = c.toDataURL("image/jpeg", 0.82);
		inst.destroy();
		return url;
	}
	let thumbQueue = Promise.resolve();
	function requestThumb(def) {
		if (thumbs.has(def.id)) return;
		thumbs.set(def.id, null);
		thumbQueue = thumbQueue.then(async () => {
			await new Promise((r) => setTimeout(r, 30));
			try {
				const url = await makeThumb(def);
				thumbs.set(def.id, url);
				const card = $(`.card[data-id="${CSS.escape(def.id)}"]`);
				if (card) applyThumb(card, url);
			} catch (e) {
				console.warn("thumbnail failed", def.id, e);
			}
		});
	}
	function applyThumb(card, url) {
		const img = $("img", card);
		img.onload = () => card.classList.add("ready");
		img.src = url;
	}

	/* ---------- library ---------- */
	let query = "";
	function visibleDefs() {
		const q = query.trim().toLowerCase();
		return defs.filter((d) => {
			if (state.chip === "Favorites" && !state.favorites.includes(d.id))
				return false;
			if (
				state.chip !== "All" &&
				state.chip !== "Favorites" &&
				d.category !== state.chip
			)
				return false;
			return (
				!q || `${d.name} ${d.category} ${d.tags}`.toLowerCase().includes(q)
			);
		});
	}
	function renderChips() {
		const cats = ["All", "Favorites", ...new Set(defs.map((d) => d.category))];
		if (!cats.includes(state.chip)) state.chip = "All";
		$("#chips").replaceChildren(
			...cats.map((c) =>
				h(
					"button",
					{
						class: "chip" + (c === state.chip ? " active" : ""),
						role: "tab",
						onclick: () => {
							state.chip = c;
							save();
							renderChips();
							renderGrid();
						},
					},
					c
				)
			)
		);
	}
	function renderGrid() {
		const list = visibleDefs();
		$("#lib-count").textContent = list.length;
		const grid = $("#grid");
		if (!list.length) {
			const fav = state.chip === "Favorites" && !query;
			grid.replaceChildren(
				h(
					"div",
					{ class: "empty" },
					h("b", null, fav ? "No favorites yet" : "Nothing found"),
					fav
						? "Tap the heart on any wallpaper to keep it here."
						: "Try a different search or category."
				)
			);
			return;
		}
		grid.replaceChildren(
			...list.map((def) => {
				const fav = state.favorites.includes(def.id);
				const card = h(
					"div",
					{
						class: "card" + (def.id === state.current ? " active" : ""),
						"data-id": def.id,
						role: "button",
						tabindex: 0,
						"aria-label": def.name,
						onclick: () => select(def.id),
						onkeydown: (e) => {
							if (e.target !== card) return;
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								select(def.id);
							}
						},
					},
					h("img", { alt: "", draggable: "false" }),
					h(
						"div",
						{ class: "card-info" },
						h("div", { class: "card-name" }, def.name),
						h("div", { class: "card-cat" }, def.category)
					),
					h(
						"button",
						{
							class: "card-btn fav" + (fav ? " on" : ""),
							"aria-label": fav ? "Remove favorite" : "Add favorite",
							onclick: (e) => {
								e.stopPropagation();
								toggleFav(def.id);
							},
						},
						ico("heart")
					),
					def.mediaId
						? h(
								"button",
								{
									class: "card-btn del",
									"aria-label": "Delete",
									onclick: (e) => {
										e.stopPropagation();
										removeMedia(def);
									},
								},
								ico("trash")
							)
						: null
				);
				const url = thumbs.get(def.id);
				if (url) applyThumb(card, url);
				else requestThumb(def);
				return card;
			})
		);
	}

	/* ---------- importing media ---------- */
	async function importFiles(files) {
		const ok = [...files].filter((f) => /^(image|video)\//.test(f.type));
		if (!ok.length) return toast("Only images and videos can be imported");
		let last;
		for (const f of ok) {
			const item = {
				id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
				name: f.name.replace(/\.[^.]+$/, "") || "Untitled",
				blob: f,
			};
			try {
				await idb.put(item);
			} catch {
				/* kept for this session only */
			}
			last = mediaDef(item);
			defs.push(last);
		}
		state.chip = "All";
		renderChips();
		renderGrid();
		select(last.id);
		toast(ok.length > 1 ? `Added ${ok.length} wallpapers` : `Added “${last.name}”`);
	}
	function removeMedia(def) {
		idb.del(def.mediaId).catch(() => {});
		defs = defs.filter((d) => d !== def);
		delete state.params[def.id];
		delete state.presets[def.id];
		state.favorites = state.favorites.filter((f) => f !== def.id);
		if (state.current === def.id) select(defs[0].id);
		setTimeout(() => URL.revokeObjectURL(def.url), 3000);
		save();
		renderChips();
		renderGrid();
		toast(`Removed “${def.name}”`);
	}

	/* ---------- generic controls ---------- */
	function control(def, value, onChange) {
		if (def.type === "range") {
			const out = h("output");
			const inp = h("input", {
				type: "range",
				min: def.min,
				max: def.max,
				step: def.step,
				"aria-label": def.label,
			});
			const dec = (String(def.step).split(".")[1] || "").length;
			const sync = () => {
				const v = +inp.value;
				out.textContent = def.fmt ? def.fmt(v) : v.toFixed(dec);
				inp.style.setProperty(
					"--p",
					((v - def.min) / (def.max - def.min)) * 100 + "%"
				);
			};
			inp.value = value;
			sync();
			inp.addEventListener("input", () => {
				sync();
				onChange(+inp.value);
			});
			inp.addEventListener("dblclick", () => {
				if (def.default == null) return;
				inp.value = def.default;
				sync();
				onChange(+inp.value);
			});
			return h(
				"div",
				{ class: "ctl" },
				h("div", { class: "ctl-head" }, h("label", null, def.label), out),
				inp
			);
		}
		let widget;
		if (def.type === "color") {
			const hex = h("span", null, value);
			const inp = h("input", { type: "color", "aria-label": def.label });
			inp.value = value;
			inp.addEventListener("input", () => {
				hex.textContent = inp.value;
				onChange(inp.value);
			});
			widget = h("label", { class: "color" }, inp, hex);
		} else if (def.type === "toggle") {
			widget = h("button", {
				class: "switch",
				role: "switch",
				"aria-checked": String(!!value),
				"aria-label": def.label,
				onclick: async () => {
					const next = widget.getAttribute("aria-checked") !== "true";
					if ((await onChange(next)) === false) return;
					widget.setAttribute("aria-checked", String(next));
				},
			});
		} else {
			widget = h(
				"select",
				{ "aria-label": def.label },
				def.options.map(([v, l]) => h("option", { value: v }, l))
			);
			widget.value = String(value);
			widget.addEventListener("change", () =>
				onChange(def.options[widget.selectedIndex][0])
			);
		}
		return h(
			"div",
			{ class: "ctl ctl-inline" },
			h("label", null, def.label),
			widget
		);
	}
	function section(title, ...kids) {
		return h(
			"div",
			{ class: "section" },
			title ? h("h4", null, title) : null,
			...kids
		);
	}
	const bind = (obj, defsList, after) =>
		defsList.map((d) =>
			control(d, obj[d.key], (v) => {
				obj[d.key] = v;
				save();
				if (after) after(d.key, v);
			})
		);

	/* ---------- inspector: wallpaper tab ---------- */
	function randomColor() {
		const hue = Math.random() * 360,
			s = 0.55 + Math.random() * 0.4,
			l = 0.3 + Math.random() * 0.4;
		const f = (n) => {
			const k = (n + hue / 30) % 12;
			const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
			return Math.round(c * 255)
				.toString(16)
				.padStart(2, "0");
		};
		return `#${f(0)}${f(8)}${f(4)}`;
	}
	function renderWallpaperTab() {
		const def = byId(state.current);
		if (!def) return;
		const P = paramsFor(def);
		const fav = state.favorites.includes(def.id);
		const presets = (state.presets[def.id] = state.presets[def.id] || []);
		const nameInput = h("input", {
			class: "text-input",
			placeholder: "Preset name",
			maxlength: 28,
			"aria-label": "Preset name",
		});
		const savePreset = () => {
			const name = nameInput.value.trim() || `Preset ${presets.length + 1}`;
			presets.push({ name, values: { ...P } });
			save();
			renderWallpaperTab();
			toast(`Saved “${name}”`);
		};
		nameInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") savePreset();
		});
		const apply = (values) => {
			Object.assign(P, values);
			save();
			renderWallpaperTab();
		};
		$("#tab-wallpaper").replaceChildren(
			h(
				"div",
				{ class: "hero" },
				h("h3", null, def.name),
				h("p", null, def.desc),
				h(
					"div",
					{ class: "hero-actions" },
					h(
						"button",
						{
							class: "btn small" + (fav ? " on" : ""),
							onclick: () => toggleFav(def.id),
						},
						ico("heart"),
						fav ? "Saved" : "Favorite"
					),
					h(
						"button",
						{
							class: "btn small",
							onclick: () => {
								const v = {};
								for (const p of def.params) {
									if (p.type === "color") v[p.key] = randomColor();
									else if (p.type === "range" && !/count|layers/.test(p.key)) {
										const r = p.min + Math.random() * (p.max - p.min);
										v[p.key] = +(
											p.default +
											(r - p.default) * 0.5
										).toFixed(3);
									}
								}
								apply(v);
							},
						},
						ico("shuffle"),
						"Randomize"
					),
					h(
						"button",
						{
							class: "btn small",
							onclick: () => apply(defaultParams(def)),
						},
						ico("reset"),
						"Reset"
					)
				)
			),
			section("Properties", ...bind(P, def.params)),
			section(
				"Presets",
				h(
					"div",
					{ class: "preset-form" },
					nameInput,
					h("button", { class: "btn accent", onclick: savePreset }, "Save")
				),
				presets.length
					? h(
							"div",
							{ class: "presets" },
							presets.map((p, i) =>
								h(
									"span",
									{ class: "preset" },
									h(
										"button",
										{ title: "Apply preset", onclick: () => apply(p.values) },
										p.name
									),
									h(
										"button",
										{
											"aria-label": `Delete ${p.name}`,
											onclick: () => {
												presets.splice(i, 1);
												save();
												renderWallpaperTab();
											},
										},
										ico("x")
									)
								)
							)
						)
					: h(
							"p",
							{ class: "hint" },
							"Save the current look to recall it later. Double-click a slider to reset it."
						)
			)
		);
	}

	/* ---------- inspector: display / widgets / playlist ---------- */
	const pct = (v) => v + "%";
	function applyDisplay() {
		const d = state.display,
			f = [];
		if (d.brightness !== 100) f.push(`brightness(${d.brightness}%)`);
		if (d.contrast !== 100) f.push(`contrast(${d.contrast}%)`);
		if (d.saturation !== 100) f.push(`saturate(${d.saturation}%)`);
		if (d.hue) f.push(`hue-rotate(${d.hue}deg)`);
		if (d.blur) f.push(`blur(${d.blur}px)`);
		stage.style.filter = f.join(" ") || "none";
		stage.style.setProperty("--blur", d.blur + "px");
		document.body.style.setProperty("--vignette", d.vignette / 100);
		return f;
	}
	function renderDisplayTab() {
		const d = state.display;
		const R = (key, label, min, max, step, fmt) => ({
			key,
			label,
			type: "range",
			min,
			max,
			step,
			fmt,
			default: DEFAULTS.display[key],
		});
		$("#tab-display").replaceChildren(
			section(
				"Motion",
				...bind(d, [
					R("speed", "Animation speed", 0, 3, 0.05, (v) => v.toFixed(2) + "×"),
					R("transition", "Crossfade", 0, 3000, 50, (v) =>
						v ? (v / 1000).toFixed(2) + " s" : "Off"
					),
				])
			),
			section(
				"Picture",
				...bind(
					d,
					[
						R("brightness", "Brightness", 30, 150, 1, pct),
						R("contrast", "Contrast", 50, 150, 1, pct),
						R("saturation", "Saturation", 0, 200, 1, pct),
						R("hue", "Hue shift", 0, 360, 1, (v) => v + "°"),
						R("blur", "Blur", 0, 30, 1, (v) => v + " px"),
						R("vignette", "Vignette", 0, 100, 1, pct),
					],
					applyDisplay
				),
				h(
					"button",
					{
						class: "btn small",
						style: "margin-top:8px",
						onclick: () => {
							Object.assign(d, DEFAULTS.display);
							save();
							applyDisplay();
							engine.resize();
							renderDisplayTab();
						},
					},
					ico("reset"),
					"Reset display"
				)
			),
			section(
				"Performance",
				...bind(
					d,
					[
						{
							key: "scale",
							label: "Quality",
							type: "select",
							options: [
								["auto", "High (native)"],
								[1, "Balanced"],
								[0.5, "Performance"],
							],
						},
						{
							key: "fps",
							label: "Frame rate",
							type: "select",
							options: [
								[0, "Unlimited"],
								[60, "60 fps"],
								[30, "30 fps"],
								[15, "15 fps"],
							],
						},
					],
					() => engine.resize()
				)
			),
			section(
				"Keyboard",
				h(
					"div",
					{ class: "keys" },
					...[
						["Space", "Play / pause"],
						["← →", "Previous / next wallpaper"],
						["H", "Hide or show controls"],
						["F", "Fullscreen"],
						["S", "Save current frame as PNG"],
						["L", "Favorite current wallpaper"],
						["/", "Search"],
					].flatMap(([k, d]) => [h("kbd", null, k), h("span", null, d)])
				)
			)
		);
	}

	const clockEl = $("#clock");
	function applyClock() {
		const c = state.clock;
		clockEl.hidden = !c.on;
		clockEl.dataset.pos = c.pos;
		clockEl.dataset.style = c.style;
		clockEl.style.setProperty("--clock-scale", c.size / 100);
		clockEl.style.setProperty("--clock-color", c.color);
		tickClock();
	}
	function tickClock() {
		const c = state.clock;
		if (!c.on) return;
		const now = new Date();
		const two = (n) => String(n).padStart(2, "0");
		let hr = now.getHours();
		const suffix = c.h24 ? "" : hr < 12 ? " AM" : " PM";
		if (!c.h24) hr = hr % 12 || 12;
		const hh = c.h24 ? two(hr) : String(hr),
			mm = two(now.getMinutes()),
			ss = two(now.getSeconds());
		let text;
		if (c.style === "stacked")
			text = `${two(hr)}\n${mm}${c.seconds ? "\n" + ss : ""}`;
		else text = `${hh}:${mm}${c.seconds ? ":" + ss : ""}`;
		const time = $(".clock-time", clockEl),
			date = $(".clock-date", clockEl);
		const ampm = c.style === "stacked" || c.h24 ? "" : suffix;
		if (time.dataset.t !== text + ampm) {
			time.dataset.t = text + ampm;
			time.replaceChildren(text, h("span", { class: "ampm" }, ampm));
		}
		const dateText = c.date
			? now.toLocaleDateString(undefined, {
					weekday: "long",
					month: "long",
					day: "numeric",
				})
			: "";
		date.hidden = !dateText;
		if (date.textContent !== dateText) date.textContent = dateText;
	}
	let meterEl;
	function renderWidgetsTab() {
		meterEl = h("b");
		$("#tab-widgets").replaceChildren(
			section(
				"Clock",
				...bind(
					state.clock,
					[
						{ key: "on", label: "Show clock", type: "toggle" },
						{
							key: "style",
							label: "Style",
							type: "select",
							options: [
								["digital", "Bold"],
								["thin", "Light"],
								["stacked", "Stacked"],
							],
						},
						{
							key: "pos",
							label: "Position",
							type: "select",
							options: [
								["center", "Center"],
								["top-left", "Top left"],
								["top", "Top"],
								["top-right", "Top right"],
								["left", "Left"],
								["right", "Right"],
								["bottom-left", "Bottom left"],
								["bottom", "Bottom"],
								["bottom-right", "Bottom right"],
							],
						},
						{
							key: "size",
							label: "Size",
							type: "range",
							min: 40,
							max: 200,
							step: 1,
							fmt: pct,
							default: 100,
						},
						{ key: "color", label: "Color", type: "color" },
						{ key: "h24", label: "24-hour time", type: "toggle" },
						{ key: "seconds", label: "Show seconds", type: "toggle" },
						{ key: "date", label: "Show date", type: "toggle" },
					],
					applyClock
				)
			),
			section(
				"Audio reactive",
				control(
					{ label: "React to microphone", type: "toggle" },
					!!engine.analyser,
					async (on) => {
						if (!on) return engine.audioOff();
						try {
							await engine.audioOn();
							toast("Listening — wallpapers now react to sound");
						} catch {
							toast("Microphone access was not granted");
							return false;
						}
					}
				),
				...bind(state.audio, [
					{
						key: "sens",
						label: "Sensitivity",
						type: "range",
						min: 0.2,
						max: 4,
						step: 0.1,
						fmt: (v) => v.toFixed(1) + "×",
						default: 1.5,
					},
				]),
				h("div", { class: "meter" }, meterEl),
				h(
					"p",
					{ class: "hint" },
					"Audio is analysed on this device only and never recorded or sent anywhere."
				)
			)
		);
	}
	function renderPlaylistTab() {
		$("#tab-playlist").replaceChildren(
			section(
				"Auto-change",
				...bind(
					state.playlist,
					[
						{ key: "on", label: "Cycle wallpapers", type: "toggle" },
						{
							key: "interval",
							label: "Change every",
							type: "select",
							options: [
								[15, "15 seconds"],
								[30, "30 seconds"],
								[60, "1 minute"],
								[300, "5 minutes"],
								[900, "15 minutes"],
								[1800, "30 minutes"],
								[3600, "1 hour"],
							],
						},
						{
							key: "order",
							label: "Order",
							type: "select",
							options: [
								["sequential", "In order"],
								["shuffle", "Shuffle"],
							],
						},
						{
							key: "source",
							label: "Include",
							type: "select",
							options: [
								["all", "All wallpapers"],
								["favorites", "Favorites only"],
							],
						},
					],
					() => {
						engine.cycle = 0;
						$("#st-progress").hidden = !state.playlist.on;
					}
				),
				h(
					"p",
					{ class: "hint" },
					"The timer pauses with playback. If you have no favorites, every wallpaper is included."
				)
			)
		);
		$("#st-progress").hidden = !state.playlist.on;
	}

	/* ---------- actions ---------- */
	function snapshot() {
		const top = engine.layers.at(-1);
		if (!top) return;
		try {
			top.inst.frame(engine.time, 0, engine.env(top));
		} catch {
			/* draw what's there */
		}
		const W = top.canvas.width,
			H = top.canvas.height;
		const c = document.createElement("canvas");
		c.width = W;
		c.height = H;
		const x = c.getContext("2d");
		const d = state.display,
			s = engine.scale();
		const f = applyDisplay().map((p) =>
			p.startsWith("blur") ? `blur(${d.blur * s}px)` : p
		);
		x.filter = f.join(" ") || "none";
		x.drawImage(top.canvas, 0, 0);
		x.filter = "none";
		if (d.vignette) {
			x.save();
			x.translate(W / 2, H / 2);
			x.scale(W * 0.7071, H * 0.7071);
			const g = x.createRadialGradient(0, 0, 0.45, 0, 0, 1);
			g.addColorStop(0, "rgba(0,0,0,0)");
			g.addColorStop(1, `rgba(0,0,0,${d.vignette / 100})`);
			x.fillStyle = g;
			x.fillRect(-1, -1, 2, 2);
			x.restore();
		}
		c.toBlob((blob) => {
			if (!blob) return toast("Couldn't save the image");
			const a = h("a", {
				href: URL.createObjectURL(blob),
				download: `lumen-${top.def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${W}x${H}.png`,
			});
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 5000);
			toast(`Saved ${W} × ${H} image`);
		}, "image/png");
	}
	function fullscreen() {
		if (document.fullscreenElement) document.exitFullscreen();
		else
			document.documentElement
				.requestFullscreen()
				.catch(() => toast("Fullscreen isn't available here"));
	}
	let idleTimer = 0;
	function wake() {
		document.body.classList.remove("idle");
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => document.body.classList.add("idle"),
			2500
		);
	}
	function setHidden(hide) {
		document.body.classList.toggle("ui-hidden", hide);
		if (hide) wake();
	}
	function setPanel(name, open) {
		state.panels[name] = open;
		// On narrow screens only one panel fits at a time.
		if (open && innerWidth < 760)
			state.panels[name === "library" ? "inspector" : "library"] = false;
		for (const n of ["library", "inspector"]) {
			document.body.classList.toggle("no-" + n, !state.panels[n]);
			$("#btn-" + n).classList.toggle("on", state.panels[n]);
		}
		save();
	}

	/* ---------- wiring ---------- */
	hydrate(document);
	$("#btn-prev").onclick = () => step(-1);
	$("#btn-next").onclick = () => step(1);
	$("#btn-play").onclick = () => engine.setPaused(!engine.paused);
	$("#btn-snap").onclick = snapshot;
	$("#btn-full").onclick = fullscreen;
	$("#btn-hide").onclick = () => setHidden(true);
	$("#reveal").onclick = () => setHidden(false);
	$("#btn-library").onclick = () => setPanel("library", !state.panels.library);
	$("#btn-inspector").onclick = () =>
		setPanel("inspector", !state.panels.inspector);
	$("#btn-import").onclick = () => $("#file").click();
	$("#file").onchange = (e) => {
		importFiles(e.target.files);
		e.target.value = "";
	};
	$("#search").addEventListener("input", (e) => {
		query = e.target.value;
		renderGrid();
	});
	$("#tabs").addEventListener("click", (e) => {
		const b = e.target.closest("[data-tab]");
		if (!b) return;
		$$("#tabs button").forEach((t) => t.classList.toggle("active", t === b));
		$$(".tab-body").forEach(
			(t) => (t.hidden = t.id !== "tab-" + b.dataset.tab)
		);
	});

	addEventListener("resize", () => engine.resize());
	addEventListener("pointermove", (e) => {
		engine.mouse.x = e.clientX / innerWidth;
		engine.mouse.y = e.clientY / innerHeight;
		engine.mouse.active = true;
		if (document.body.classList.contains("ui-hidden")) wake();
	});
	document.addEventListener("pointerleave", () => (engine.mouse.active = false));
	stage.addEventListener("dblclick", () =>
		setHidden(!document.body.classList.contains("ui-hidden"))
	);
	addEventListener("dblclick", (e) => {
		if (e.target === document.body || e.target.id === "ui")
			setHidden(!document.body.classList.contains("ui-hidden"));
	});

	addEventListener("keydown", (e) => {
		const t = e.target;
		const typing =
			t.tagName === "SELECT" ||
			(t.tagName === "INPUT" && t.type !== "range" && t.type !== "color");
		if (e.key === "Escape") {
			if (typing) t.blur();
			else setHidden(false);
			return;
		}
		if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key.toLowerCase();
		const onRange = t.tagName === "INPUT" && t.type === "range";
		if (k === " " && t.tagName !== "BUTTON" && !t.classList.contains("card")) {
			e.preventDefault();
			engine.setPaused(!engine.paused);
		} else if (k === "arrowright" && !onRange) step(1);
		else if (k === "arrowleft" && !onRange) step(-1);
		else if (k === "h")
			setHidden(!document.body.classList.contains("ui-hidden"));
		else if (k === "f") fullscreen();
		else if (k === "s") snapshot();
		else if (k === "l") toggleFav(state.current);
		else if (k === "/") {
			e.preventDefault();
			setHidden(false);
			setPanel("library", true);
			$("#search").focus();
		}
	});

	// drag & drop import
	let dragDepth = 0;
	const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
	addEventListener("dragenter", (e) => {
		if (!hasFiles(e)) return;
		dragDepth++;
		$("#drop").classList.add("show");
	});
	addEventListener("dragleave", (e) => {
		if (!hasFiles(e)) return;
		if (--dragDepth <= 0) $("#drop").classList.remove("show");
	});
	addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
	addEventListener("drop", (e) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		dragDepth = 0;
		$("#drop").classList.remove("show");
		importFiles(e.dataTransfer.files);
	});

	// status bar
	setInterval(() => {
		$("#st-fps").textContent = engine.paused
			? "Paused"
			: Math.round(engine.fps) + " fps";
		if (state.playlist.on)
			$("#st-progress b").style.width =
				Math.min(100, (engine.cycle / state.playlist.interval) * 100) + "%";
		if (meterEl) meterEl.style.width = engine.audio * 100 + "%";
		tickClock();
	}, 250);

	/* ---------- boot ---------- */
	async function boot() {
		if (innerWidth < 760) state.panels.library = state.panels.inspector = false;
		setPanel("library", state.panels.library);
		setPanel("inspector", state.panels.inspector);
		applyDisplay();
		applyClock();
		renderDisplayTab();
		renderWidgetsTab();
		renderPlaylistTab();
		try {
			await idb.open();
			for (const item of await idb.all()) defs.push(mediaDef(item));
		} catch {
			/* imports will last for this session only */
		}
		renderChips();
		renderGrid();
		select(state.current, { instant: true, force: true });
		engine.resize();
		requestAnimationFrame((t) => {
			engine.last = t;
			engine.tick(t);
		});
	}
	boot();
})();
