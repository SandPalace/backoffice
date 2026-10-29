// Fluid: a GPU stable-fluids solver for the GSAP renderer (WebGL2).
//
// The method is Jos Stam's stable fluids as laid out in GPU Gems ch. 38 (Harris), with the curl /
// vorticity-confinement pass popularised by Pavel Dobryakov's WebGL-Fluid-Simulation (MIT).
// Written for frame-by-frame rendering: the page calls step(dt) exactly once per rendered frame
// with a fixed dt and drives every splat from timeline state, so a render is reproducible.
// Nothing here reads the wall clock.
//
//   const F = Fluid(canvas, {simRes: 192, dyeRes: 720});
//   F.splat(x, y, vx, vy, [r, g, b], radius)   // pixels on the 1080×1920 frame, px/s, linear RGB
//   F.step(dt, {curl, velDiss, dyeDiss, iters, wind: [x, y], noise: [amp, scale, speed],
//               buoy: [x, y], time})            // buoy: force per unit of dye brightness (px/s²)
//   F.render({top, bottom, exposure, grain, vignette, frame})  // colours as [r, g, b] 0..1
//   F.reset()
(function () {
  const VERT = `#version 300 es
  precision highp float;
  in vec2 aPos;
  uniform vec2 texel;
  out vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    vL = vUv - vec2(texel.x, 0.0); vR = vUv + vec2(texel.x, 0.0);
    vT = vUv + vec2(0.0, texel.y); vB = vUv - vec2(0.0, texel.y);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const HEAD = `#version 300 es
  precision highp float; precision highp sampler2D;
  in vec2 vUv, vL, vR, vT, vB;
  out vec4 o;
  `;

  const FRAG = {
    splat: `uniform sampler2D uTarget; uniform vec2 point, frame; uniform vec3 color; uniform float radius;
      void main() {
        vec2 p = (vUv - point) * frame;
        o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / (radius * radius)) * color, 1.0);
      }`,
    advect: `uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
      void main() {
        vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * simTexel;
        o = texture(uSource, coord) / (1.0 + dissipation * dt);
      }`,
    curl: `uniform sampler2D uVelocity;
      void main() {
        float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
        float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
        o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }`,
    vorticity: `uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
      void main() {
        float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
        float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
        vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        f /= length(f) + 1e-4;
        f *= curl * C; f.y *= -1.0;
        vec2 v = texture(uVelocity, vUv).xy + f * dt;
        o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
      }`,
    // External forces: a constant wind, curl-noise turbulence and dye buoyancy. Curl noise is
    // divergence-free, so it stirs the field without bunching the dye.
    force: `uniform sampler2D uVelocity, uDye; uniform vec2 wind, buoy, aspect; uniform vec3 noise;
      uniform float dt, time;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { return vn(p) * 0.65 + vn(p * 2.03 + 7.1) * 0.35; }
      void main() {
        vec2 v = texture(uVelocity, vUv).xy;
        vec2 p = vUv * aspect * noise.y + vec2(0.0, time * noise.z);
        float e = 0.01;
        float dx = fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0));
        float dy = fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e));
        vec2 c = vec2(dy, -dx) / (2.0 * e);
        vec3 d = texture(uDye, vUv).rgb;
        float lum = dot(d, vec3(0.3, 0.5, 0.2));
        v += dt * (wind + noise.x * c + buoy * min(lum, 2.0));
        o = vec4(v, 0.0, 1.0);
      }`,
    divergence: `uniform sampler2D uVelocity;
      void main() {
        float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
        float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
        vec2 C = texture(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
        o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }`,
    scale: `uniform sampler2D uTex; uniform float value;
      void main() { o = value * texture(uTex, vUv); }`,
    pressure: `uniform sampler2D uPressure, uDivergence;
      void main() {
        float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
        float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
        o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
      }`,
    gradient: `uniform sampler2D uPressure, uVelocity;
      void main() {
        float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
        float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
        o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
      }`,
    // Display: a vertical background gradient, the dye tone-mapped on top, a relief light taken
    // from the dye gradient, a vignette and a seeded film grain.
    display: `uniform sampler2D uDye; uniform vec3 top, bottom; uniform vec2 dyeTexel;
      uniform float exposure, grain, vignette, frame, relief;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 bg = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));
        vec3 d = texture(uDye, vUv).rgb;
        float l0 = length(texture(uDye, vUv - vec2(dyeTexel.x, 0.0)).rgb);
        float l1 = length(texture(uDye, vUv + vec2(dyeTexel.x, 0.0)).rgb);
        float l2 = length(texture(uDye, vUv - vec2(0.0, dyeTexel.y)).rgb);
        float l3 = length(texture(uDye, vUv + vec2(0.0, dyeTexel.y)).rgb);
        vec3 n = normalize(vec3(l0 - l1, l2 - l3, 0.35));
        float light = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))) * 1.15, 0.55, 1.25);
        vec3 c = 1.0 - exp(-d * exposure);
        c *= mix(1.0, light, relief);
        vec3 col = bg + c * (1.0 - bg * 0.35);
        vec2 q = vUv - 0.5; q.x *= 0.5625;
        col *= 1.0 - vignette * smoothstep(0.25, 0.75, length(q));
        col += (h(gl_FragCoord.xy + frame * 17.0) - 0.5) * grain;
        o = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
      }`,
  };

  function Fluid(canvas, opts = {}) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float unavailable");
    const W = canvas.width, H = canvas.height;
    const res = (r) => { const a = W / H; return a < 1 ? [r, Math.round(r / a)] : [Math.round(r * a), r]; };
    const [sw, sh] = res(opts.simRes ?? 192);
    const [dw, dh] = res(opts.dyeRes ?? 720);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const prog = {};
    for (const [k, src] of Object.entries(FRAG)) {
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, HEAD + src));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      prog[k] = { p, u };
    }

    function fbo(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb, w, h };
    }
    const double = (w, h) => {
      const d = { a: fbo(w, h), b: fbo(w, h), w, h };
      d.swap = () => { [d.a, d.b] = [d.b, d.a]; };
      return d;
    };
    const vel = double(sw, sh), dye = double(dw, dh), pres = double(sw, sh);
    const div = fbo(sw, sh), curlT = fbo(sw, sh);

    function run(name, target, uniforms, texel = [1 / sw, 1 / sh]) {
      const { p, u } = prog[name];
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      if (u.texel) gl.uniform2f(u.texel, texel[0], texel[1]);
      let unit = 0;
      for (const [k, v] of Object.entries(uniforms)) {
        if (!u[k]) continue;
        if (v && v.tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(u[k], unit++); }
        else if (typeof v === "number") gl.uniform1f(u[k], v);
        else if (v.length === 2) gl.uniform2f(u[k], v[0], v[1]);
        else gl.uniform3f(u[k], v[0], v[1], v[2]);
      }
      if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function clear(d) {
      for (const f of [d.a, d.b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    }

    const api = {
      sim: [sw, sh], dye: [dw, dh],
      reset() { clear(vel); clear(dye); clear(pres); },
      // x, y in frame pixels (y down); vx, vy in px/s; radius in px.
      splat(x, y, vx, vy, color, radius) {
        const point = [x / W, 1 - y / H];
        run("splat", vel.b, { uTarget: vel.a, point, frame: [W, H], color: [vx * sw / W, -vy * sh / H, 0], radius });
        vel.swap();
        if (color) {
          run("splat", dye.b, { uTarget: dye.a, point, frame: [W, H], color, radius }, [1 / dw, 1 / dh]);
          dye.swap();
        }
      },
      step(dt, o = {}) {
        const simTexel = [1 / sw, 1 / sh];
        const wind = o.wind ?? [0, 0], buoy = o.buoy ?? [0, 0], nz = o.noise ?? [0, 3, 0];
        run("force", vel.b, { uVelocity: vel.a, uDye: dye.a, wind: [wind[0] * sw / W, -wind[1] * sh / H],
          buoy: [buoy[0] * sw / W, -buoy[1] * sh / H], aspect: [W / H, 1], noise: [nz[0] * sh / H, nz[1], nz[2]],
          dt, time: o.time ?? 0 });
        vel.swap();
        run("curl", curlT, { uVelocity: vel.a });
        run("vorticity", vel.b, { uVelocity: vel.a, uCurl: curlT, curl: o.curl ?? 20, dt });
        vel.swap();
        run("divergence", div, { uVelocity: vel.a });
        run("scale", pres.b, { uTex: pres.a, value: o.pressureKeep ?? 0.8 });
        pres.swap();
        for (let i = 0; i < (o.iters ?? 24); i++) {
          run("pressure", pres.b, { uPressure: pres.a, uDivergence: div });
          pres.swap();
        }
        run("gradient", vel.b, { uPressure: pres.a, uVelocity: vel.a });
        vel.swap();
        run("advect", vel.b, { uVelocity: vel.a, uSource: vel.a, simTexel, dt, dissipation: o.velDiss ?? 0.2 });
        vel.swap();
        run("advect", dye.b, { uVelocity: vel.a, uSource: dye.a, simTexel, dt, dissipation: o.dyeDiss ?? 0.4 }, [1 / dw, 1 / dh]);
        dye.swap();
      },
      render(o = {}) {
        run("display", null, { uDye: dye.a, top: o.top ?? [0, 0, 0], bottom: o.bottom ?? [0, 0, 0],
          dyeTexel: [1 / dw, 1 / dh], exposure: o.exposure ?? 1.4, grain: o.grain ?? 0.025,
          vignette: o.vignette ?? 0.35, frame: o.frame ?? 0, relief: o.relief ?? 0.6 }, [1 / W, 1 / H]);
      },
    };
    api.reset();
    return api;
  }

  window.Fluid = Fluid;
})();
