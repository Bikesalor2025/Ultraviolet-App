"use strict";

// Playlist from the screenshot. Audio files are added by the user.
const SEED = [
	["Self Aware", "Temper City"],
	["a good man with a broken...", "LoVibe."],
	["Stuntman", "Connor Price & Nic D"],
	["ROXANNE", "Arizona Zervas"],
	["Thing for Ya", "Chri$tian Gate$"],
	["Too Easy", "Connor Price & Nic D"],
	["God's Plan", "Drake"],
	["Not Like Us", "Kendrick Lamar"],
	["MONACO", "Bad Bunny"],
	["White Keys", "Dominic Fike"],
	["What's up", "Nic D"],
	["Brazil", "Declan McKenna"],
].map(([title, artist], i) => ({ id: "s" + (i + 1), title, artist, hasFile: false }));

const $ = (id) => document.getElementById(id);
const audio = $("audio");

// ---------- storage ----------

const store = {
	get(key, fallback) {
		try {
			const v = localStorage.getItem(key);
			return v ? JSON.parse(v) : fallback;
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {}
	},
};

const dbReady = new Promise((resolve, reject) => {
	const req = indexedDB.open("playlist-player", 1);
	req.onupgradeneeded = () => req.result.createObjectStore("files");
	req.onsuccess = () => resolve(req.result);
	req.onerror = () => reject(req.error);
});

async function idb(mode, fn) {
	const db = await dbReady;
	return new Promise((resolve, reject) => {
		const tx = db.transaction("files", mode);
		const req = fn(tx.objectStore("files"));
		tx.oncomplete = () => resolve(req && req.result);
		tx.onerror = () => reject(tx.error);
	});
}

// ---------- state ----------

let tracks = store.get("tracks", SEED);
let shuffle = store.get("shuffle", false);
let repeat = store.get("repeat", "off"); // off | all | one
let order = []; // playback order of track ids
let pos = -1; // index of the current track in `order`
let upNext = []; // user queue, played before `order` continues
let currentId = null;
let objectUrl = null;
let menuTrackId = null;

const byId = (id) => tracks.find((t) => t.id === id);
const playable = () => tracks.filter((t) => t.hasFile).map((t) => t.id);
const saveTracks = () => store.set("tracks", tracks);

function shuffled(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// ---------- playback ----------

function buildOrder(startId) {
	let ids = playable();
	if (shuffle) {
		ids = shuffled(ids.filter((id) => id !== startId));
		if (startId) ids.unshift(startId);
	}
	order = ids;
	pos = startId ? order.indexOf(startId) : 0;
}

async function load(id, autoplay) {
	const blob = await idb("readonly", (s) => s.get(id));
	const t = byId(id);
	if (!blob || !t) {
		if (t) {
			t.hasFile = false;
			saveTracks();
		}
		toast("File missing — skipped");
		return render();
	}
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = URL.createObjectURL(blob);
	audio.src = objectUrl;
	currentId = id;
	if (autoplay) audio.play().catch(() => {});
	updateMediaSession(t);
	render();
}

function playFromLibrary(id) {
	buildOrder(id);
	load(id, true);
}

function stop() {
	audio.pause();
	audio.removeAttribute("src");
	audio.load();
	currentId = null;
	render();
}

function next(auto = false) {
	if (auto && repeat === "one") {
		audio.currentTime = 0;
		audio.play();
		return;
	}
	if (upNext.length) return load(upNext.shift(), true);
	if (!order.length) buildOrder(null), (pos = -1);
	if (!order.length) return;
	if (pos + 1 < order.length) {
		pos++;
		return load(order[pos], true);
	}
	// End of the list: wrap around, keep playing only if repeat-all is on.
	if (shuffle) order = shuffled(order);
	pos = 0;
	load(order[0], repeat === "all");
}

function prev() {
	if (!currentId) return;
	if (audio.currentTime > 3) {
		audio.currentTime = 0;
		return;
	}
	// Current track came from the user queue: go back to where the list was.
	if (order[pos] && order[pos] !== currentId) return load(order[pos], true);
	if (pos > 0) pos--;
	else if (repeat === "all") pos = order.length - 1;
	else {
		audio.currentTime = 0;
		return;
	}
	load(order[pos], true);
}

function togglePlay() {
	if (!currentId) {
		if (!playable().length) return toast("Add music files first");
		return next();
	}
	audio.paused ? audio.play() : audio.pause();
}

function toggleShuffle() {
	shuffle = !shuffle;
	store.set("shuffle", shuffle);
	if (order.length) {
		if (shuffle) {
			const rest = shuffled(order.filter((id) => id !== currentId));
			order = currentId ? [currentId, ...rest] : rest;
		} else {
			order = playable();
		}
		pos = currentId ? order.indexOf(currentId) : -1;
	}
	toast(shuffle ? "Shuffle on" : "Shuffle off");
	render();
}

function cycleRepeat() {
	repeat = { off: "all", all: "one", one: "off" }[repeat];
	store.set("repeat", repeat);
	toast({ off: "Repeat off", all: "Repeat all", one: "Repeat one" }[repeat]);
	render();
}

function playNext(id) {
	upNext.unshift(id);
	toast("Playing next");
	render();
}

function addToQueue(id) {
	upNext.push(id);
	toast("Added to queue");
	render();
}

// ---------- files ----------

const norm = (s) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[^a-z0-9]/g, "");

function matchTrack(fileName) {
	const n = norm(fileName.replace(/\.[^.]+$/, ""));
	let best = null;
	for (const t of tracks) {
		const key = norm(t.title);
		if (key && n.includes(key) && (!best || key.length > norm(best.title).length)) best = t;
	}
	return best;
}

async function addFiles(files, targetId) {
	let matched = 0;
	let added = 0;
	for (const [i, file] of [...files].entries()) {
		let t = targetId ? byId(targetId) : matchTrack(file.name);
		if (t) matched++;
		else {
			t = {
				id: "t" + Date.now() + "_" + i,
				title: file.name.replace(/\.[^.]+$/, ""),
				artist: "Unknown artist",
				hasFile: false,
				custom: true,
			};
			tracks.push(t);
			added++;
		}
		await idb("readwrite", (s) => s.put(file, t.id));
		t.hasFile = true;
		if (order.length && !order.includes(t.id)) order.push(t.id);
	}
	saveTracks();
	navigator.storage?.persist?.();
	toast(targetId ? "File replaced" : `${matched} matched, ${added} new`);
	render();
}

async function removeFile(id) {
	await idb("readwrite", (s) => s.delete(id));
	const t = byId(id);
	if (t.custom) tracks = tracks.filter((x) => x !== t);
	else t.hasFile = false;
	saveTracks();
	upNext = upNext.filter((x) => x !== id);
	const idx = order.indexOf(id);
	if (idx !== -1) {
		order.splice(idx, 1);
		if (idx < pos) pos--;
	}
	if (currentId === id) stop();
	render();
}

// ---------- UI ----------

const ICONS = {
	play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
	pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
	next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 6l9 6-9 6zM16 6h2.5v12H16z"/></svg>',
	prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6l-9 6 9 6zM5.5 6H8v12H5.5z"/></svg>',
	shuffle:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.6 0 2.8-1.6 3.9-3.5M14 9.5C15.2 7.6 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
	repeat:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12V9a2 2 0 0 1 2-2h13M16 4l3 3-3 3M20 12v3a2 2 0 0 1-2 2H5M8 20l-3-3 3-3"/></svg>',
	queue:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h8"/><path d="M16 14v7l5-3.5z" fill="currentColor"/></svg>',
};

function esc(s) {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function rowHtml(t, i, extra = "") {
	return `<li class="row${t.hasFile ? "" : " missing"}${t.id === currentId ? " current" : ""}" data-id="${t.id}">
		<div class="art">${i}</div>
		<button class="info" data-act="play">
			<div class="title">${esc(t.title)}</div>
			<div class="muted">${t.hasFile ? esc(t.artist) : esc(t.artist) + " · no file"}</div>
		</button>
		${extra}
	</li>`;
}

function render() {
	$("library").innerHTML = tracks
		.map((t, i) => rowHtml(t, i + 1, '<button class="more" data-act="menu" aria-label="More">•••</button>'))
		.join("");

	const ready = playable().length;
	$("summary").textContent = `${tracks.length} songs · ${ready} ready to play`;

	const t = byId(currentId);
	$("nowTitle").textContent = t ? t.title : "Not playing";
	$("nowArtist").textContent = t ? t.artist : "";
	$("playBtn").innerHTML = audio.paused ? ICONS.play : ICONS.pause;
	$("shuffleBtn").classList.toggle("on", shuffle);
	$("repeatBtn").classList.toggle("on", repeat !== "off");
	$("repeatBtn").innerHTML = ICONS.repeat + (repeat === "one" ? '<span class="badge">1</span>' : "");

	if ($("queuePanel").open) renderQueue();
}

function renderQueue() {
	const now = byId(currentId);
	const later = order.slice(pos + 1).map(byId).filter(Boolean);
	const moveBtns = (i) =>
		`<button class="qbtn" data-q="up" data-i="${i}" aria-label="Move up">↑</button>
		<button class="qbtn" data-q="down" data-i="${i}" aria-label="Move down">↓</button>
		<button class="qbtn" data-q="remove" data-i="${i}" aria-label="Remove">✕</button>`;

	$("queueBody").innerHTML = `
		<h3>Now playing</h3>
		<ul class="list">${now ? rowHtml(now, "▶") : '<li class="muted">Nothing</li>'}</ul>
		<h3>Up next ${upNext.length ? '<button data-q="clear">Clear</button>' : ""}</h3>
		<ul class="list">${
			upNext.length
				? upNext.map((id, i) => rowHtml(byId(id), i + 1, moveBtns(i)).replace("<li ", `<li data-src="up" data-i="${i}" `)).join("")
				: '<li class="muted">Use ••• → Play next / Add to queue</li>'
		}</ul>
		<h3>${shuffle ? "Then (shuffled)" : "Then"}</h3>
		<ul class="list">${
			later.length
				? later.map((t, i) => rowHtml(t, i + 1).replace("<li ", `<li data-src="order" data-i="${pos + 1 + i}" `)).join("")
				: `<li class="muted">${repeat === "all" ? "Playlist repeats from the start" : "End of playlist"}</li>`
		}</ul>`;
}

function openMenu(id) {
	const t = byId(id);
	menuTrackId = id;
	$("menuTitle").textContent = t.title;
	const items = t.hasFile
		? [
				["playnext", "Play next"],
				["queue", "Add to queue"],
				["replace", "Replace file"],
				["remove", t.custom ? "Remove song" : "Remove file", "danger"],
			]
		: [["replace", "Choose file for this song"]];
	$("menuButtons").innerHTML = items
		.map(([act, label, cls]) => `<button data-m="${act}" class="${cls || ""}">${label}</button>`)
		.join("") + '<button data-m="cancel">Cancel</button>';
	$("trackMenu").showModal();
}

let toastTimer;
function toast(msg) {
	const el = $("toast");
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

function updateMediaSession(t) {
	if (!("mediaSession" in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "My Playlist" });
}

// ---------- events ----------

$("library").addEventListener("click", (e) => {
	const btn = e.target.closest("[data-act]");
	if (!btn) return;
	const id = btn.closest("[data-id]").dataset.id;
	const t = byId(id);
	if (btn.dataset.act === "menu") return openMenu(id);
	if (!t.hasFile) {
		menuTrackId = id;
		return $("replaceInput").click();
	}
	playFromLibrary(id);
});

$("menuButtons").addEventListener("click", (e) => {
	const act = e.target.dataset.m;
	if (!act) return;
	$("trackMenu").close();
	const id = menuTrackId;
	if (act === "playnext") playNext(id);
	else if (act === "queue") addToQueue(id);
	else if (act === "replace") $("replaceInput").click();
	else if (act === "remove") removeFile(id);
});

$("queueBody").addEventListener("click", (e) => {
	const q = e.target.closest("[data-q]");
	if (q) {
		const i = +q.dataset.i;
		const act = q.dataset.q;
		if (act === "clear") upNext = [];
		else if (act === "remove") upNext.splice(i, 1);
		else {
			const j = act === "up" ? i - 1 : i + 1;
			if (j >= 0 && j < upNext.length) [upNext[i], upNext[j]] = [upNext[j], upNext[i]];
		}
		return render();
	}
	const row = e.target.closest("[data-src]");
	if (!row || !e.target.closest(".info")) return;
	const i = +row.dataset.i;
	if (row.dataset.src === "up") load(upNext.splice(i, 1)[0], true);
	else {
		pos = i;
		load(order[pos], true);
	}
});

$("trackMenu").addEventListener("click", (e) => {
	if (e.target === $("trackMenu")) $("trackMenu").close();
});
$("queuePanel").addEventListener("click", (e) => {
	if (e.target === $("queuePanel")) $("queuePanel").close();
});

$("fileInput").addEventListener("change", (e) => {
	addFiles(e.target.files);
	e.target.value = "";
});
$("replaceInput").addEventListener("change", (e) => {
	if (e.target.files[0]) addFiles(e.target.files, menuTrackId);
	e.target.value = "";
});

$("playAll").onclick = () => {
	if (!playable().length) return toast("Add music files first");
	if (shuffle) toggleShuffle();
	playFromLibrary(playable()[0]);
};
$("shuffleAll").onclick = () => {
	if (!playable().length) return toast("Add music files first");
	shuffle = true;
	store.set("shuffle", true);
	buildOrder(null);
	load(order[0], true);
};

$("shuffleBtn").innerHTML = ICONS.shuffle;
$("prevBtn").innerHTML = ICONS.prev;
$("nextBtn").innerHTML = ICONS.next;
$("queueBtn").innerHTML = ICONS.queue;

$("playBtn").onclick = togglePlay;
$("nextBtn").onclick = () => next();
$("prevBtn").onclick = prev;
$("shuffleBtn").onclick = toggleShuffle;
$("repeatBtn").onclick = cycleRepeat;
$("queueBtn").onclick = () => {
	renderQueue();
	$("queuePanel").showModal();
};
$("closeQueue").onclick = () => $("queuePanel").close();

const seek = $("seek");
let seeking = false;
seek.addEventListener("input", () => {
	seeking = true;
	$("curTime").textContent = fmt(+seek.value);
});
seek.addEventListener("change", () => {
	audio.currentTime = +seek.value;
	seeking = false;
});

audio.addEventListener("loadedmetadata", () => {
	seek.max = audio.duration || 0;
	$("durTime").textContent = fmt(audio.duration);
});
audio.addEventListener("timeupdate", () => {
	if (seeking) return;
	seek.value = audio.currentTime;
	$("curTime").textContent = fmt(audio.currentTime);
});
audio.addEventListener("play", render);
audio.addEventListener("pause", render);
audio.addEventListener("ended", () => next(true));

if ("mediaSession" in navigator) {
	const ms = navigator.mediaSession;
	ms.setActionHandler("play", () => audio.play());
	ms.setActionHandler("pause", () => audio.pause());
	ms.setActionHandler("nexttrack", () => next());
	ms.setActionHandler("previoustrack", prev);
	try {
		ms.setActionHandler("seekto", (d) => (audio.currentTime = d.seekTime));
	} catch {}
}

// Sync the saved track list with the files actually stored.
idb("readonly", (s) => s.getAllKeys())
	.then((keys) => {
		const have = new Set(keys);
		tracks.forEach((t) => (t.hasFile = have.has(t.id)));
		saveTracks();
	})
	.catch(() => toast("Storage unavailable — files won't be saved"))
	.finally(render);

render();
