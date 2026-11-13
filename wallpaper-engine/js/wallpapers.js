/* Lumen Wallpaper Engine — wallpaper definitions.
 * Each wallpaper: { id, name, category, tags, desc, params[], warm, create(canvas) }
 * create() returns { frame(t, dt, env), resize?(), setPaused?(bool), destroy() }
 * env = { params, mouse:{x,y,active}, audio:0..1, px:renderScale }
 */
(function () {
	"use strict";
	const WE = (window.WE = window.WE || {});

	/* ---------- helpers ---------- */
	const rgbCache = new Map();
	function hexToRgb(hex) {
		let v = rgbCache.get(hex);
		if (!v) {
			const n = parseInt(String(hex).slice(1), 16) || 0;
			v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
			rgbCache.set(hex, v);
		}
		return v;
	}
	const rgba = (hex, a) => {
		const c = hexToRgb(hex);
		return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
	};
	const mix = (a, b, f, alpha = 1) => {
		const A = hexToRgb(a),
			B = hexToRgb(b);
		return `rgba(${(A[0] + (B[0] - A[0]) * f) | 0},${(A[1] + (B[1] - A[1]) * f) | 0},${(A[2] + (B[2] - A[2]) * f) | 0},${alpha})`;
	};
	const rand = (a, b) => a + Math.random() * (b - a);
	function vnoise(x, y) {
		const xi = Math.floor(x),
			yi = Math.floor(y);
		let xf = x - xi,
			yf = y - yi;
		const h = (a, b) => {
			const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
			return n - Math.floor(n);
		};
		xf = xf * xf * (3 - 2 * xf);
		yf = yf * yf * (3 - 2 * yf);
		const a = h(xi, yi),
			b = h(xi + 1, yi),
			c = h(xi, yi + 1),
			d = h(xi + 1, yi + 1);
		return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
	}
	function vGradient(ctx, H, c1, c2) {
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, c1);
		g.addColorStop(1, c2);
		return g;
	}

	/* ---------- WebGL shader factory ---------- */
	const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
	const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;uniform float u_audio;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.02+vec2(17.3,9.1);a*=.5;}return v;}
`;
	function shader(params, body) {
		return function create(canvas) {
			const gl = canvas.getContext("webgl", {
				antialias: false,
				alpha: false,
				powerPreference: "high-performance",
			});
			if (!gl) throw new Error("WebGL is not available");
			const decl = params
				.map(
					(p) =>
						`uniform ${p.type === "color" ? "vec3" : "float"} u_${p.key};`
				)
				.join("\n");
			const compile = (type, src) => {
				const s = gl.createShader(type);
				gl.shaderSource(s, src);
				gl.compileShader(s);
				if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
					throw new Error(gl.getShaderInfoLog(s));
				return s;
			};
			const prog = gl.createProgram();
			gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
			gl.attachShader(
				prog,
				compile(gl.FRAGMENT_SHADER, HEAD + decl + body)
			);
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
				throw new Error(gl.getProgramInfoLog(prog));
			gl.useProgram(prog);
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([-1, -1, 3, -1, -1, 3]),
				gl.STATIC_DRAW
			);
			const loc = gl.getAttribLocation(prog, "p");
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
			const U = (n) => gl.getUniformLocation(prog, n);
			const u = {
				res: U("u_res"),
				time: U("u_time"),
				mouse: U("u_mouse"),
				audio: U("u_audio"),
			};
			const up = params.map((p) => [p, U("u_" + p.key)]);
			return {
				frame(t, dt, env) {
					gl.viewport(0, 0, canvas.width, canvas.height);
					gl.uniform2f(u.res, canvas.width, canvas.height);
					gl.uniform1f(u.time, t);
					gl.uniform2f(u.mouse, env.mouse.x, 1 - env.mouse.y);
					gl.uniform1f(u.audio, env.audio);
					for (const [p, l] of up) {
						const v = env.params[p.key];
						if (p.type === "color") {
							const c = hexToRgb(v);
							gl.uniform3f(l, c[0] / 255, c[1] / 255, c[2] / 255);
						} else gl.uniform1f(l, +v);
					}
					gl.drawArrays(gl.TRIANGLES, 0, 3);
				},
				destroy() {
					const ext = gl.getExtension("WEBGL_lose_context");
					if (ext) ext.loseContext();
				},
			};
		};
	}

	const R = (key, label, min, max, step, def) => ({
		key,
		label,
		type: "range",
		min,
		max,
		step,
		default: def,
	});
	const C = (key, label, def) => ({ key, label, type: "color", default: def });

	/* ---------- shader wallpapers ---------- */
	const auroraParams = [
		C("c1", "Lower glow", "#2dffb3"),
		C("c2", "Upper glow", "#8a5cff"),
		C("sky", "Sky", "#0a1a3a"),
		R("intensity", "Intensity", 0.2, 2, 0.01, 1),
		R("wave", "Wave motion", 0, 2, 0.01, 1),
		R("height", "Curtain height", 0, 1, 0.01, 0.5),
		R("stars", "Stars", 0, 2, 0.01, 1),
	];
	const aurora = `
void main(){
 vec2 uv=gl_FragCoord.xy/u_res;float asp=u_res.x/u_res.y;vec2 p=vec2(uv.x*asp,uv.y);float t=u_time;
 vec3 col=mix(u_sky,u_sky*0.12,pow(uv.y,0.7));
 vec2 sp=p*210.;float h=hash(floor(sp));
 col+=step(0.994,h)*smoothstep(.45,.05,length(fract(sp)-.5))*(0.55+0.45*sin(t*2.+h*90.))*u_stars*smoothstep(0.25,0.9,uv.y);
 for(int i=0;i<4;i++){float fi=float(i);
  float x=p.x*(0.8+fi*0.25)+fi*3.7;
  float n=fbm(vec2(x*0.9+t*0.04*(1.+fi*.3),t*0.06+fi*5.));
  float base=0.36+fi*0.08+(n-0.5)*0.55*u_wave+(u_mouse.y-.5)*0.05;
  float d=uv.y-base;
  float glow=exp(-d*d*90.)*0.35;
  float curtain=smoothstep(0.,0.025,d)*exp(-d*(6.5-u_height*4.));
  float rays=0.5+0.5*noise(vec2(x*14.+n*6.,t*0.3+fi));
  vec3 c=mix(u_c1,u_c2,clamp(d*3.+fi*0.22,0.,1.));
  col+=c*(glow+curtain*rays*0.8)*u_intensity*(0.55+u_audio*0.9)*(1.-fi*0.13);
 }
 float m=0.09+0.10*fbm(vec2(p.x*2.2,3.))+0.02*noise(vec2(p.x*11.,7.));
 col=mix(col,vec3(0.008,0.012,0.025),smoothstep(m+0.003,m-0.003,uv.y));
 gl_FragColor=vec4(col,1.);
}`;

	const nebulaParams = [
		C("c1", "Deep", "#12062e"),
		C("c2", "Gas", "#ff3d9a"),
		C("c3", "Highlight", "#3dc8ff"),
		R("scale", "Zoom", 0.8, 5, 0.01, 2.2),
		R("glow", "Glow", 0.3, 2, 0.01, 1),
		R("stars", "Stars", 0, 2, 0.01, 1),
	];
	const nebula = `
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;float t=u_time*0.05;
 vec2 p=uv*u_scale+(u_mouse-.5)*0.35;
 vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
 vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*1.5),fbm(p+3.*q+vec2(8.3,2.8)-t*1.2));
 float f=fbm(p+3.*r);
 vec3 col=mix(u_c1,u_c2,clamp(f*f*3.4,0.,1.));
 col=mix(col,u_c3,clamp(length(q)*0.85,0.,1.)*0.65);
 col+=vec3(1.)*pow(r.x,4.)*0.6;
 col*=(f*f*f+0.6*f*f+0.5*f)*1.7*u_glow*(1.+u_audio*0.7);
 vec2 sp=gl_FragCoord.xy/u_res.y*240.;float h=hash(floor(sp));
 col+=step(0.988,h)*smoothstep(.5,.05,length(fract(sp)-.5))*(0.5+0.5*sin(u_time*1.5+h*70.))*u_stars*(1.-f);
 gl_FragColor=vec4(col,1.);
}`;

	const liquidParams = [
		C("c1", "Color A", "#ff5f6d"),
		C("c2", "Color B", "#ffc371"),
		C("c3", "Color C", "#5b3df5"),
		C("c4", "Color D", "#21d4fd"),
		R("warp", "Distortion", 0, 2, 0.01, 1),
		R("zoom", "Zoom", 0.4, 3, 0.01, 1),
		R("grain", "Film grain", 0, 1, 0.01, 0.35),
	];
	const liquid = `
void main(){
 vec2 uv=gl_FragCoord.xy/u_res;float asp=u_res.x/u_res.y;vec2 p=(uv-.5)*vec2(asp,1.)*u_zoom;
 float t=u_time*0.15;p+=(u_mouse-.5)*0.2;
 for(int i=1;i<5;i++){float fi=float(i);
  p+=u_warp*(0.35+u_audio*0.2)/fi*vec2(sin(fi*p.y*1.6+t*1.1+fi*1.3),cos(fi*p.x*1.4-t*0.9+fi*2.1));}
 float a=0.5+0.5*sin(p.x*1.4+t);float b=0.5+0.5*sin(p.y*1.7-t*0.7+1.);
 vec3 col=mix(mix(u_c1,u_c2,a),mix(u_c3,u_c4,a),b);
 col+=(hash(gl_FragCoord.xy+fract(u_time)*61.)-.5)*u_grain*0.09;
 gl_FragColor=vec4(col,1.);
}`;

	const synthParams = [
		C("sky1", "Sky top", "#12002b"),
		C("sky2", "Sky horizon", "#ff2e97"),
		C("sun1", "Sun top", "#ffe94d"),
		C("sun2", "Sun bottom", "#ff3c7d"),
		C("grid", "Grid", "#00e5ff"),
		C("ground", "Ground", "#0b0220"),
		R("gridsize", "Grid density", 1, 6, 0.01, 3),
		R("sunsize", "Sun size", 0.08, 0.34, 0.001, 0.2),
	];
	const synth = `
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;float y=uv.y+0.08;vec3 col;
 if(y>0.){
  col=mix(u_sky2,u_sky1,clamp(pow(y*1.9,0.75),0.,1.));
  vec2 sp=uv*170.;float h=hash(floor(sp));
  col+=step(0.985,h)*smoothstep(.5,.05,length(fract(sp)-.5))*smoothstep(0.1,0.5,y)*(0.5+0.5*sin(u_time*2.+h*80.));
  float r=u_sunsize*(1.+u_audio*0.08);vec2 sc=vec2(uv.x,y-r*0.95);float d=length(sc);
  float sy=(sc.y+r)/(2.*r);
  float w=mix(0.62,0.,clamp(sy*1.7,0.,1.));
  float cut=mix(smoothstep(w-0.04,w+0.04,fract(sc.y/r*4.2-u_time*0.25)),1.,smoothstep(0.1,0.,w));
  col=mix(col,mix(u_sun2,u_sun1,clamp(sy,0.,1.)),smoothstep(r,r-0.004,d)*cut);
  col+=u_sun2*exp(-d*5.5)*0.4;
 }else{
  float depth=0.25/(-y+0.0005);
  vec2 gp=vec2(uv.x*depth*u_gridsize,depth*u_gridsize+u_time*1.4);
  vec2 f=abs(fract(gp)-.5);float lw=0.02+0.012*depth;
  float line=smoothstep(.5-lw,.5-lw*0.35,max(f.x,f.y));
  float fade=smoothstep(0.,0.22,-y);
  col=mix(u_ground,u_grid*(1.+u_audio),line*fade);
  col+=u_grid*exp(y*16.)*0.55+u_sky2*exp(y*7.)*0.25;
 }
 gl_FragColor=vec4(col,1.);
}`;

	/* ---------- canvas 2D wallpapers ---------- */
	function starfield(canvas) {
		const ctx = canvas.getContext("2d");
		const stars = [];
		let first = true;
		const reset = (s, far) => {
			s.x = rand(-1, 1);
			s.y = rand(-1, 1);
			s.z = far ? 1 : rand(0.02, 1);
			return s;
		};
		return {
			resize() {
				first = true;
			},
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height;
				const n = P.count | 0;
				while (stars.length < n) stars.push(reset({}));
				stars.length = n;
				ctx.globalAlpha = 1;
				ctx.fillStyle = first
					? P.bg
					: rgba(P.bg, Math.max(0.08, 1 - P.trail * 0.92));
				first = false;
				ctx.fillRect(0, 0, W, H);
				const cx = W * (0.5 + (env.mouse.x - 0.5) * 0.3),
					cy = H * (0.5 + (env.mouse.y - 0.5) * 0.3);
				const sp = dt * P.warp * 0.35 * (1 + env.audio * 2.5);
				const f = Math.max(W, H) * 0.5;
				ctx.lineCap = "round";
				ctx.strokeStyle = P.color;
				for (const s of stars) {
					const pz = s.z;
					s.z -= sp;
					if (s.z <= 0.003) {
						reset(s, true);
						continue;
					}
					const x1 = cx + (s.x / s.z) * f,
						y1 = cy + (s.y / s.z) * f;
					if (x1 < -60 || x1 > W + 60 || y1 < -60 || y1 > H + 60) {
						reset(s, true);
						continue;
					}
					const a = 1 - s.z;
					ctx.globalAlpha = a;
					ctx.lineWidth = (0.4 + a * 2.2) * P.size * env.px;
					ctx.beginPath();
					ctx.moveTo(cx + (s.x / pz) * f, cy + (s.y / pz) * f);
					ctx.lineTo(x1, y1);
					ctx.stroke();
				}
				ctx.globalAlpha = 1;
			},
			destroy() {},
		};
	}

	function constellation(canvas) {
		const ctx = canvas.getContext("2d");
		const pts = [];
		const mk = () => ({
			x: Math.random(),
			y: Math.random(),
			vx: rand(-1, 1),
			vy: rand(-1, 1),
		});
		return {
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height,
					px = env.px;
				const n = P.count | 0;
				while (pts.length < n) pts.push(mk());
				pts.length = n;
				ctx.globalAlpha = 1;
				ctx.fillStyle = vGradient(ctx, H, P.bg1, P.bg2);
				ctx.fillRect(0, 0, W, H);
				const D = P.link * px * (1 + env.audio * 0.5),
					D2 = D * D;
				const v = P.drift * 22 * px * dt;
				for (const p of pts) {
					p.x += (p.vx * v) / W;
					p.y += (p.vy * v) / H;
					if (p.x < 0 || p.x > 1) p.vx *= -1;
					if (p.y < 0 || p.y > 1) p.vy *= -1;
					p.x = Math.min(1, Math.max(0, p.x));
					p.y = Math.min(1, Math.max(0, p.y));
					p.px = p.x * W;
					p.py = p.y * H;
				}
				ctx.lineWidth = px;
				ctx.strokeStyle = P.line;
				const mx = env.mouse.x * W,
					my = env.mouse.y * H;
				for (let i = 0; i < n; i++) {
					const a = pts[i];
					for (let j = i + 1; j < n; j++) {
						const b = pts[j];
						const dx = a.px - b.px,
							dy = a.py - b.py,
							d2 = dx * dx + dy * dy;
						if (d2 < D2) {
							ctx.globalAlpha = (1 - Math.sqrt(d2) / D) * 0.7;
							ctx.beginPath();
							ctx.moveTo(a.px, a.py);
							ctx.lineTo(b.px, b.py);
							ctx.stroke();
						}
					}
					if (env.mouse.active) {
						const dx = a.px - mx,
							dy = a.py - my,
							d2 = dx * dx + dy * dy,
							M = D * 1.6;
						if (d2 < M * M) {
							ctx.globalAlpha = 1 - Math.sqrt(d2) / M;
							ctx.beginPath();
							ctx.moveTo(a.px, a.py);
							ctx.lineTo(mx, my);
							ctx.stroke();
						}
					}
				}
				ctx.globalAlpha = 1;
				ctx.fillStyle = P.dot;
				const r = P.size * px;
				ctx.beginPath();
				for (const p of pts) {
					ctx.moveTo(p.px + r, p.py);
					ctx.arc(p.px, p.py, r, 0, 6.2832);
				}
				ctx.fill();
			},
			destroy() {},
		};
	}

	function matrix(canvas) {
		const ctx = canvas.getContext("2d");
		let cols = [],
			fs = 0,
			acc = 0,
			lastW = 0;
		const glyph = () =>
			Math.random() < 0.8
				? String.fromCharCode(0xff66 + ((Math.random() * 56) | 0))
				: String((Math.random() * 10) | 0);
		return {
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height;
				const size = Math.max(6, Math.round(P.size * env.px));
				if (size !== fs || W !== lastW) {
					fs = size;
					lastW = W;
					cols = Array.from({ length: Math.ceil(W / fs) }, () => ({
						y: (-Math.random() * (H / fs)) | 0,
						sp: rand(0.45, 1),
						acc: 0,
						ch: glyph(),
					}));
					ctx.fillStyle = P.bg;
					ctx.fillRect(0, 0, W, H);
				}
				acc += dt * P.rate * (1 + env.audio);
				let steps = Math.min(acc | 0, 8);
				acc -= acc | 0;
				ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
				ctx.textBaseline = "top";
				while (steps-- > 0) {
					ctx.fillStyle = rgba(P.bg, P.fade);
					ctx.fillRect(0, 0, W, H);
					for (let i = 0; i < cols.length; i++) {
						const c = cols[i];
						c.acc += c.sp;
						if (c.acc < 1) continue;
						c.acc -= 1;
						ctx.fillStyle = P.color;
						ctx.fillText(c.ch, i * fs, c.y * fs);
						c.y++;
						c.ch = glyph();
						ctx.fillStyle = P.head;
						ctx.fillText(c.ch, i * fs, c.y * fs);
						if (c.y * fs > H && Math.random() > 0.975) c.y = 0;
					}
				}
			},
			destroy() {},
		};
	}

	function waves(canvas) {
		const ctx = canvas.getContext("2d");
		return {
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height;
				ctx.fillStyle = vGradient(ctx, H, P.bg1, P.bg2);
				ctx.fillRect(0, 0, W, H);
				const L = P.layers | 0,
					A = H * 0.06 * P.amp * (1 + env.audio * 1.5),
					step = Math.max(4, W / 160);
				for (let i = 0; i < L; i++) {
					const f = L > 1 ? i / (L - 1) : 1;
					const base =
						H * (0.3 + 0.62 * f) + (env.mouse.y - 0.5) * H * 0.04 * f;
					const k = ((1.2 + i * 0.37) * P.freq * 6.2832) / W;
					ctx.fillStyle = mix(P.c1, P.c2, f, 0.3 + 0.55 * f);
					ctx.beginPath();
					ctx.moveTo(0, H);
					for (let x = 0; x <= W + step; x += step) {
						const y =
							base +
							Math.sin(x * k + t * (0.5 + i * 0.13) + i * 1.7) * A +
							Math.sin(x * k * 2.3 - t * (0.35 + i * 0.07) + i * 4.1) *
								A *
								0.45;
						ctx.lineTo(x, y);
					}
					ctx.lineTo(W, H);
					ctx.fill();
				}
			},
			destroy() {},
		};
	}

	function bokeh(canvas) {
		const ctx = canvas.getContext("2d");
		const orbs = [];
		const mk = () => ({
			x: Math.random(),
			y: Math.random(),
			r: rand(0.35, 1),
			vx: rand(-1, 1),
			vy: rand(-0.6, -0.1),
			f: Math.random(),
			ph: rand(0, 6.28),
		});
		return {
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height;
				const n = P.count | 0;
				while (orbs.length < n) orbs.push(mk());
				orbs.length = n;
				ctx.globalCompositeOperation = "source-over";
				ctx.globalAlpha = 1;
				ctx.fillStyle = vGradient(ctx, H, P.bg1, P.bg2);
				ctx.fillRect(0, 0, W, H);
				ctx.globalCompositeOperation = "lighter";
				const S = Math.min(W, H) * 0.11 * P.size;
				for (const o of orbs) {
					o.x += o.vx * dt * 0.012 * P.drift;
					o.y += o.vy * dt * 0.02 * P.drift;
					if (o.y < -0.2) {
						o.y = 1.2;
						o.x = Math.random();
					}
					if (o.x < -0.2) o.x = 1.2;
					if (o.x > 1.2) o.x = -0.2;
					const r = S * o.r * (1 + env.audio * 0.4);
					const x = o.x * W + (env.mouse.x - 0.5) * W * 0.04 * o.r,
						y = o.y * H;
					const a = (0.35 + 0.3 * Math.sin(t * 0.8 + o.ph)) * P.glow;
					const g = ctx.createRadialGradient(x, y, 0, x, y, r);
					g.addColorStop(0, mix(P.c1, P.c2, o.f, a * 0.55));
					g.addColorStop(0.75, mix(P.c1, P.c2, o.f, a * 0.4));
					g.addColorStop(0.82, mix(P.c1, P.c2, o.f, a * 0.7));
					g.addColorStop(1, mix(P.c1, P.c2, o.f, 0));
					ctx.fillStyle = g;
					ctx.fillRect(x - r, y - r, r * 2, r * 2);
				}
				ctx.globalCompositeOperation = "source-over";
			},
			destroy() {},
		};
	}

	function flowfield(canvas) {
		const ctx = canvas.getContext("2d");
		const ps = [];
		const B = 6;
		let first = true;
		const mk = (p) => {
			p.x = Math.random();
			p.y = Math.random();
			p.life = rand(2, 9);
			return p;
		};
		return {
			resize() {
				first = true;
			},
			frame(t, dt, env) {
				const P = env.params,
					W = canvas.width,
					H = canvas.height;
				const n = P.count | 0;
				while (ps.length < n) ps.push(mk({}));
				ps.length = n;
				ctx.globalAlpha = 1;
				ctx.fillStyle = first ? P.bg : rgba(P.bg, P.fade);
				first = false;
				ctx.fillRect(0, 0, W, H);
				const sc = P.scale * 2.2,
					asp = W / H,
					v = dt * 0.09 * P.flow * (1 + env.audio * 2);
				ctx.lineWidth = P.width * env.px;
				ctx.lineCap = "round";
				for (let b = 0; b < B; b++) {
					ctx.strokeStyle = mix(P.c1, P.c2, b / (B - 1), 0.55);
					ctx.beginPath();
					for (let i = b; i < n; i += B) {
						const p = ps[i];
						const a =
							vnoise(p.x * sc * asp, p.y * sc + t * 0.04) * 12.566 +
							t * 0.05;
						const x0 = p.x * W,
							y0 = p.y * H;
						p.x += (Math.cos(a) * v) / asp;
						p.y += Math.sin(a) * v;
						p.life -= dt;
						ctx.moveTo(x0, y0);
						ctx.lineTo(p.x * W, p.y * H);
						if (p.life < 0 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
							mk(p);
					}
					ctx.stroke();
				}
			},
			destroy() {},
		};
	}

	/* ---------- registry ---------- */
	WE.WALLPAPERS = [
		{
			id: "aurora",
			name: "Aurora",
			category: "Nature",
			tags: "northern lights sky night shader",
			desc: "Northern lights drifting over a mountain ridge.",
			params: auroraParams,
			create: shader(auroraParams, aurora),
			t0: 14,
		},
		{
			id: "nebula",
			name: "Nebula",
			category: "Space",
			tags: "galaxy gas cloud shader",
			desc: "Slow-moving interstellar gas clouds.",
			params: nebulaParams,
			create: shader(nebulaParams, nebula),
			t0: 20,
		},
		{
			id: "liquid",
			name: "Liquid Gradient",
			category: "Abstract",
			tags: "mesh gradient color minimal shader",
			desc: "A soft, constantly melting mesh gradient.",
			params: liquidParams,
			create: shader(liquidParams, liquid),
			t0: 9,
		},
		{
			id: "synthwave",
			name: "Synthwave",
			category: "Retro",
			tags: "80s grid sun outrun neon shader",
			desc: "Endless neon grid under a retro sun.",
			params: synthParams,
			create: shader(synthParams, synth),
			t0: 3,
		},
		{
			id: "starfield",
			name: "Warp Drive",
			category: "Space",
			tags: "stars hyperspace speed",
			desc: "Fly through a field of stars. Follows your cursor.",
			warm: 120,
			params: [
				C("color", "Stars", "#cfe4ff"),
				C("bg", "Background", "#03040c"),
				R("count", "Star count", 100, 2500, 10, 900),
				R("warp", "Warp speed", 0.05, 3, 0.01, 0.6),
				R("trail", "Trails", 0, 1, 0.01, 0.6),
				R("size", "Star size", 0.4, 3, 0.01, 1),
			],
			create: starfield,
		},
		{
			id: "constellation",
			name: "Constellation",
			category: "Abstract",
			tags: "particles network lines plexus interactive",
			desc: "Drifting points that link up — and reach for your cursor.",
			params: [
				C("dot", "Points", "#ffffff"),
				C("line", "Links", "#7aa8ff"),
				C("bg1", "Background top", "#0b1026"),
				C("bg2", "Background bottom", "#1b0b33"),
				R("count", "Point count", 20, 260, 1, 110),
				R("link", "Link distance", 40, 300, 1, 150),
				R("drift", "Drift", 0, 4, 0.01, 1),
				R("size", "Point size", 0.5, 5, 0.1, 1.8),
			],
			create: constellation,
		},
		{
			id: "matrix",
			name: "Digital Rain",
			category: "Retro",
			tags: "matrix code terminal hacker",
			desc: "Cascading glyphs on a terminal-black screen.",
			warm: 240,
			params: [
				C("color", "Glyphs", "#19ff7a"),
				C("head", "Leading glyph", "#e6fff0"),
				C("bg", "Background", "#000000"),
				R("size", "Glyph size", 8, 40, 1, 18),
				R("rate", "Fall rate", 4, 60, 1, 22),
				R("fade", "Fade", 0.02, 0.3, 0.005, 0.07),
			],
			create: matrix,
		},
		{
			id: "waves",
			name: "Tide",
			category: "Nature",
			tags: "ocean sea layers calm",
			desc: "Layered waves rolling at their own pace.",
			params: [
				C("c1", "Far waves", "#38bdf8"),
				C("c2", "Near waves", "#1e1b8b"),
				C("bg1", "Sky top", "#fde6c8"),
				C("bg2", "Sky bottom", "#ff9a8b"),
				R("layers", "Layers", 2, 12, 1, 6),
				R("amp", "Height", 0.1, 3, 0.01, 1),
				R("freq", "Frequency", 0.3, 3, 0.01, 1),
			],
			create: waves,
		},
		{
			id: "bokeh",
			name: "Bokeh",
			category: "Abstract",
			tags: "lights blur orbs soft",
			desc: "Out-of-focus city lights floating upward.",
			params: [
				C("c1", "Light A", "#ff8a3d"),
				C("c2", "Light B", "#ff3d8b"),
				C("bg1", "Background top", "#0d0718"),
				C("bg2", "Background bottom", "#1f0f2e"),
				R("count", "Lights", 6, 90, 1, 34),
				R("size", "Size", 0.3, 2.5, 0.01, 1),
				R("glow", "Brightness", 0.2, 2, 0.01, 1),
				R("drift", "Drift", 0, 4, 0.01, 1),
			],
			create: bokeh,
		},
		{
			id: "flow",
			name: "Flow Field",
			category: "Abstract",
			tags: "particles silk lines generative",
			desc: "Thousands of particles tracing an invisible current.",
			warm: 200,
			params: [
				C("c1", "Color A", "#22d3ee"),
				C("c2", "Color B", "#c026d3"),
				C("bg", "Background", "#05060f"),
				R("count", "Particles", 300, 6000, 50, 2400),
				R("flow", "Flow speed", 0.1, 3, 0.01, 1),
				R("scale", "Turbulence", 0.3, 4, 0.01, 1.2),
				R("fade", "Fade", 0.01, 0.3, 0.005, 0.04),
				R("width", "Line width", 0.5, 4, 0.1, 1.2),
			],
			create: flowfield,
		},
	];

	/* ---------- user media (image / video) ---------- */
	function drawFit(ctx, el, W, H, fit, zoom, ox, oy) {
		const iw = el.videoWidth || el.naturalWidth,
			ih = el.videoHeight || el.naturalHeight;
		if (!iw || !ih) return;
		const s =
			(fit === "contain"
				? Math.min(W / iw, H / ih)
				: Math.max(W / iw, H / ih)) * zoom;
		ctx.drawImage(
			el,
			(W - iw * s) / 2 + ox,
			(H - ih * s) / 2 + oy,
			iw * s,
			ih * s
		);
	}
	function loadMedia(url, isVideo) {
		return new Promise((res, rej) => {
			if (isVideo) {
				const v = document.createElement("video");
				v.muted = true;
				v.loop = true;
				v.playsInline = true;
				v.addEventListener("loadeddata", () => res(v), { once: true });
				v.addEventListener("error", rej, { once: true });
				v.src = url;
			} else {
				const i = new Image();
				i.onload = () => res(i);
				i.onerror = rej;
				i.src = url;
			}
		});
	}
	WE.mediaDef = function (item) {
		const url = URL.createObjectURL(item.blob);
		const isVideo = item.blob.type.startsWith("video");
		return {
			id: "media:" + item.id,
			mediaId: item.id,
			url,
			name: item.name,
			category: "My Media",
			tags: isVideo ? "video" : "image photo",
			desc: isVideo ? "Imported video, looped." : "Imported image.",
			params: [
				{
					key: "fit",
					label: "Fit",
					type: "select",
					default: "cover",
					options: [
						["cover", "Fill screen"],
						["contain", "Fit inside"],
					],
				},
				R("motion", "Slow zoom", 0, 1, 0.01, isVideo ? 0 : 0.35),
				R("parallax", "Cursor parallax", 0, 1, 0.01, 0.25),
			],
			create(canvas) {
				const ctx = canvas.getContext("2d");
				let el = null,
					dead = false;
				loadMedia(url, isVideo).then(
					(e) => {
						if (dead) return;
						el = e;
						if (isVideo) el.play().catch(() => {});
					},
					() => {}
				);
				return {
					frame(t, dt, env) {
						const P = env.params,
							W = canvas.width,
							H = canvas.height;
						ctx.fillStyle = "#000";
						ctx.fillRect(0, 0, W, H);
						if (!el) return;
						const z =
							1 +
							P.parallax * 0.05 +
							P.motion * 0.14 * (0.5 - 0.5 * Math.cos(t * 0.12));
						drawFit(
							ctx,
							el,
							W,
							H,
							P.fit,
							z,
							-(env.mouse.x - 0.5) * P.parallax * W * 0.045,
							-(env.mouse.y - 0.5) * P.parallax * H * 0.045
						);
					},
					setPaused(p) {
						if (el && isVideo) p ? el.pause() : el.play().catch(() => {});
					},
					destroy() {
						dead = true;
						if (el && isVideo) {
							el.pause();
							el.removeAttribute("src");
							el.load();
						}
					},
				};
			},
			async thumb() {
				const el = await loadMedia(url, isVideo);
				const c = document.createElement("canvas");
				c.width = 480;
				c.height = 270;
				drawFit(c.getContext("2d"), el, 480, 270, "cover", 1, 0, 0);
				return c.toDataURL("image/jpeg", 0.8);
			},
		};
	};
})();
