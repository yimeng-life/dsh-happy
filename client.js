window.__ModuleLoader__.load({
  id: 'dsh-happy',
  factory() {
    /*
     * dsh-happy — 对话区整屏动效背景（Client 半区）
     *
     * 形态：在对话画布内部垫一层 z-index:-1 的 canvas，把整块画布当背景。
     *   - 只有"在干活"时才播：任何工具在跑 / 回合进行中；
     *   - 空闲、切会话、窗口隐藏时立刻停掉 rAF，画布淡出；
     *   - 每个会话按 session id 分配不同主题，Alt+T 手动轮换；
     *   - 文字可读性由 .dsh-stage__veil 保证：按正文列宽罩一层纱。
     *
     * 状态信号全部来自宿主已有语义属性，不读类名：
     *   [data-tool][data-state=running|preparing]  [data-chat-running]  [data-streaming]
     */

    /* ================= 可调常量 ================= */

    const TUNE = {
      /** 停止后延迟多久真正淡出（防止工具间隙闪一下）。 */
      holdIdleMs: 420,
      /** 最多跟踪多少个工具行（只留尾部，长会话也不拖慢）。 */
      maxTracked: 48,
      /** 首次挂载只回看最近多少行。 */
      seedRows: 24,
      /** React 重挂载引发的反复摘挂保护。 */
      remountGuard: 10,
      remountWindowMs: 2000,
      /** 切会话后的静默期，避免把上一轮的残留行当成"正在工作"。 */
      switchQuietMs: 600,
      /** Alt+T 换主题。 */
      themeKey: 't',
      /** Alt+R 回到随机，并给这个回合换一个。 */
      randomKey: 'r',
      /**
       * 兜底判据：真的闲了这么久又重新开工，也当成新回合
       * （有些用户是点发送按钮，抓不到 Enter）。
       */
      newTurnGapMs: 6000,
    };

    const NS = 'dsh-stage';
    const HOST_CLASS = 'dsh-stage-host';
    const ROW_SELECTOR = '[data-tool][data-state]';
    const STORAGE = {
      theme: 'dsh.happy.theme',
      /** 0.4.0 以前的键名，只在启动时读一次，读到就搬到新键。 */
      legacyTheme: 'dsh.conversation-aurora.theme',
    };

    /* ================= 样式 ================= */

    const CSS = `
.dsh-stage-host{position:relative;isolation:isolate}

.dsh-stage{
  position:absolute;
  inset:0;
  z-index:-1;                    /* 在正文之下：文字永远压在背景上 */
  overflow:hidden;
  pointer-events:none;
  opacity:0;
  transition:opacity 700ms ease;
}
.dsh-stage[data-on]{opacity:1}
.dsh-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}

/* 中间的纸面：按正文列宽罩住文字区，两侧留亮 */
.dsh-stage__veil{
  position:absolute;
  inset:-1px;
  background:linear-gradient(90deg,
    rgba(255,255,255,0) 0,
    rgba(255,255,255,.22) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 110px),
    rgba(255,255,255,.84) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 10px),
    rgba(255,255,255,.84) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 10px),
    rgba(255,255,255,.22) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 110px),
    rgba(255,255,255,0) 100%);
}
body[data-ds-dark-theme] .dsh-stage__veil{
  background:linear-gradient(90deg,
    rgba(14,16,21,0) 0,
    rgba(14,16,21,.4) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 110px),
    rgba(14,16,21,.92) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 10px),
    rgba(14,16,21,.92) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 10px),
    rgba(14,16,21,.4) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 110px),
    rgba(14,16,21,0) 100%);
}

/* 「飞机大战」的敌机在画面中部，纱罩收一档 */
.dsh-stage[data-theme="shooter"] .dsh-stage__veil{
  background:linear-gradient(90deg,
    rgba(255,255,255,0) 0,
    rgba(255,255,255,.2) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 110px),
    rgba(255,255,255,.6) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 10px),
    rgba(255,255,255,.6) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 10px),
    rgba(255,255,255,.2) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 110px),
    rgba(255,255,255,0) 100%);
}
body[data-ds-dark-theme] .dsh-stage[data-theme="shooter"] .dsh-stage__veil{
  background:linear-gradient(90deg,
    rgba(14,16,21,0) 0,
    rgba(14,16,21,.3) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 110px),
    rgba(14,16,21,.7) calc(50% - var(--dsh-chat-content-width, 748px) / 2 - 10px),
    rgba(14,16,21,.7) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 10px),
    rgba(14,16,21,.3) calc(50% + var(--dsh-chat-content-width, 748px) / 2 + 110px),
    rgba(14,16,21,0) 100%);
}

@media (prefers-reduced-motion:reduce){
  .dsh-stage{transition:none !important}
}
`;

    /* ================= 工具函数 ================= */

    function readStore(key, fallback) {
      try {
        return window.localStorage.getItem(key) || fallback;
      } catch {
        return fallback;
      }
    }

    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* 隐私模式下只在本次会话生效 */
      }
    }

    function removeStore(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* 隐私模式：本来就没写进去 */
      }
    }

    /**
     * 固定主题：先读新键；新键为空时看一眼旧键（`dsh.conversation-aurora.theme`），
     * 有值就搬到新键并删掉旧键。老用户升级后选择不丢，新用户不会读到一个幽灵值。
     */
    function readPinnedTheme() {
      const current = readStore(STORAGE.theme, '');
      if (current) return current;
      const legacy = readStore(STORAGE.legacyTheme, '');
      if (!legacy) return '';
      writeStore(STORAGE.theme, legacy);
      removeStore(STORAGE.legacyTheme);
      return legacy;
    }

    /** 浅色用墨色 + multiply；深色用亮色 + lighter。 */
    function stagePalette() {
      const dark = document.body.hasAttribute('data-ds-dark-theme');
      return dark
        ? { a: '120,190,255', b: '170,140,255', c: '110,235,215', bg: 'rgba(12,14,19,0.14)', blend: 'lighter' }
        : { a: '38,78,205', b: '112,44,214', c: '10,132,120', bg: 'rgba(255,255,255,0.14)', blend: 'multiply' };
    }

    function addStyle() {
      const style = document.createElement('style');
      style.dataset.pluginCss = 'dsh-happy/stage.css';
      style.textContent = CSS;
      document.head.appendChild(style);
      return style;
    }

    /**
     * 找对话画布：优先用宿主稳定的语义属性，同时存在多个时取可见面积最大的；
     * 找不到就退回「从输入框往上找不透明背景」。
     */
    /**
     * 从消息区往上找一层"还包住输入区"的容器：更高、不更窄、且背景透明
     * （背景透明才不会被它自己的底色盖住画布）。找不到就原样返回。
     */
    function pickWiderHost(content) {
      let node = content;
      for (let depth = 0; depth < 4; depth += 1) {
        const parent = node.parentElement;
        if (!parent) return node;
        const inner = node.getBoundingClientRect();
        const outer = parent.getBoundingClientRect();
        const bg = window.getComputedStyle(parent).backgroundColor;
        const clear = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || bg === 'rgb(0 0 0 / 0)';
        if (clear && outer.height > inner.height + 40 && outer.width >= inner.width - 4) {
          node = parent;
        } else {
          return node;
        }
      }
      return node;
    }

    function findCanvas() {
      const all = document.querySelectorAll('[data-conversation-content]');
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < all.length; i += 1) {
        const rect = all[i].getBoundingClientRect();
        const area = rect.width * rect.height;
        if (rect.width > 120 && area > bestArea) {
          best = all[i];
          bestArea = area;
        }
      }
      if (best) return best;

      const anchor =
        document.querySelector('[contenteditable="true"][data-placeholder]') ||
        document.querySelector('[data-phase]');
      if (!anchor) return null;

      let node = anchor;
      for (let depth = 0; node && depth < 16; depth += 1) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(0 0 0 / 0)') return node;
        node = node.parentElement;
      }
      return null;
    }

    function createStage() {
      const el = document.createElement('div');
      el.className = NS;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<canvas></canvas><div class="' + NS + '__veil"></div>';
      return el;
    }

    /* ================= 主题库 ================= */

function themeWarp(g) {
      const spawn = (z) => ({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: z === undefined ? 0.35 + Math.random() * 0.65 : z,
        pz: 0,
      });
      let stars = [];
      const reset = () => {
        stars = [];
        for (let i = 0; i < 300; i += 1) stars.push(spawn());
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const cx = w / 2;
          const cy = h / 2;
          ctx.lineWidth = 1.2;
          ctx.lineCap = 'round';
          for (let i = 0; i < stars.length; i += 1) {
            const s = stars[i];
            s.pz = s.z;
            s.z -= dt * 0.0016;
            if (s.z <= 0.2) {
              const next = spawn(1);
              s.x = next.x;
              s.y = next.y;
              s.z = 1;
              s.pz = 1;
            }
            const k1 = 1 / (s.pz || 1);
            const k2 = 1 / s.z;
            const x1 = cx + s.x * k1 * w * 0.16;
            const y1 = cy + s.y * k1 * h * 0.16;
            const x2 = cx + s.x * k2 * w * 0.16;
            const y2 = cy + s.y * k2 * h * 0.16;
            if ((x1 < -240 && x2 < -240) || (x1 > w + 240 && x2 > w + 240)) continue;
            if ((y1 < -240 && y2 < -240) || (y1 > h + 240 && y2 > h + 240)) continue;
            ctx.strokeStyle = 'rgba(' + pal.a + ',' + Math.min(0.95, (1 - s.z) * 1.2) * 0.85 + ')';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        },
      };
    }

    /** 代码雨：竖列字符下落。 */
    function themeRain(g) {
      const glyphs = '01<>{}[]#$%&*+=ｱｲｳｴｵｶｷｸｹｺ';
      let cols = [];
      const reset = () => {
        const n = Math.max(10, Math.floor(g.w / 26));
        cols = [];
        for (let i = 0; i < n; i += 1) {
          cols.push({ x: 14 + i * 26, y: Math.random() * g.h, v: 90 + Math.random() * 190 });
        }
      };
      reset();
      const pick = () => glyphs[(Math.random() * glyphs.length) | 0];
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          // 拖尾：用 destination-out 擦一层（在 multiply/lighter 下也能正确淡出）
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = pal.blend;
          ctx.font = '14px ui-monospace, Consolas, monospace';
          for (let i = 0; i < cols.length; i += 1) {
            const c = cols[i];
            c.y += (c.v * dt) / 1000;
            if (c.y > h + 24) {
              c.y = -Math.random() * h * 0.35;
              c.v = 90 + Math.random() * 190;
            }
            ctx.fillStyle = 'rgba(' + pal.c + ',0.72)';
            ctx.fillText(pick(), c.x, c.y);
            ctx.fillStyle = 'rgba(' + pal.a + ',0.32)';
            ctx.fillText(pick(), c.x, c.y - 18);
            ctx.fillStyle = 'rgba(' + pal.a + ',0.16)';
            ctx.fillText(pick(), c.x, c.y - 36);
          }
        },
      };
    }

    /** 电路脉冲：随机直角走线 + 沿线跑动的光点。 */
    function themeCircuit(g) {
      let paths = [];
      const reset = () => {
        const step = 48;
        paths = [];
        for (let i = 0; i < 26; i += 1) {
          let x = Math.round((Math.random() * g.w) / step) * step;
          let y = Math.round((Math.random() * g.h) / step) * step;
          const pts = [[x, y]];
          for (let k = 0; k < 5; k += 1) {
            const horizontal = Math.random() < 0.5;
            const dir = Math.random() < 0.5 ? -1 : 1;
            if (horizontal) x += dir * step * 2;
            else y += dir * step * 2;
            pts.push([x, y]);
          }
          paths.push({ pts, p: Math.random(), speed: 0.00012 + Math.random() * 0.00022 });
        }
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(' + pal.a + ',0.16)';
          for (let i = 0; i < paths.length; i += 1) {
            const pts = paths[i].pts;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k < pts.length; k += 1) ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.stroke();
          }
          for (let i = 0; i < paths.length; i += 1) {
            const path = paths[i];
            path.p += path.speed * dt;
            if (path.p > 1) path.p -= 1;
            const seg = path.p * (path.pts.length - 1);
            const idx = Math.min(path.pts.length - 2, Math.floor(seg));
            const f = seg - idx;
            const x = path.pts[idx][0] + (path.pts[idx + 1][0] - path.pts[idx][0]) * f;
            const y = path.pts[idx][1] + (path.pts[idx + 1][1] - path.pts[idx][1]) * f;
            ctx.fillStyle = 'rgba(' + pal.c + ',0.85)';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    }

    /** 圆角矩形兜底（老引擎没有 roundRect）。 */
    function fillRoundRect(ctx, x, y, w, h, r) {
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        return;
      }
      ctx.fillRect(x, y, w, h);
    }

    /** 赛车：横向速度线 + 小车剪影。 */
    function themeRacer(g) {
      const spawn = () => ({
        x: Math.random() * g.w,
        y: g.h * (0.18 + Math.random() * 0.64),
        v: 320 + Math.random() * 460,
        s: 1.3 + Math.random() * 1.1,
      });
      let cars = [];
      const reset = () => {
        cars = [];
        for (let i = 0; i < 6; i += 1) cars.push(spawn());
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;
          for (let i = 0; i < cars.length; i += 1) {
            const c = cars[i];
            c.x += c.v * t;
            if (c.x > w + 180) {
              const next = spawn();
              c.y = next.y;
              c.v = next.v;
              c.s = next.s;
              c.x = -180;
            }
            const len = 110 * c.s;
            const grad = ctx.createLinearGradient(c.x - len, 0, c.x, 0);
            grad.addColorStop(0, 'rgba(' + pal.a + ',0)');
            grad.addColorStop(1, 'rgba(' + pal.a + ',0.55)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(c.x - len, c.y);
            ctx.lineTo(c.x - 4, c.y);
            ctx.stroke();

            const bw = 46 * c.s;
            const bh = 13 * c.s;
            ctx.fillStyle = 'rgba(' + pal.b + ',0.5)';
            fillRoundRect(ctx, c.x, c.y - bh / 2, bw, bh, 4 * c.s);
            ctx.fillStyle = 'rgba(' + pal.c + ',0.45)';
            fillRoundRect(ctx, c.x + bw * 0.3, c.y - bh / 2 - 7 * c.s, bw * 0.4, 7 * c.s, 3 * c.s);
            ctx.fillStyle = 'rgba(' + pal.a + ',0.7)';
            ctx.beginPath();
            ctx.arc(c.x + bw * 0.22, c.y + bh / 2, 3.2 * c.s, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(c.x + bw * 0.78, c.y + bh / 2, 3.2 * c.s, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    }

    /** 心形路径。 */
    function heartPath(ctx, x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y + s);
      ctx.bezierCurveTo(x + s * 1.4, y - s * 0.2, x + s * 0.4, y - s, x, y - s * 0.45);
      ctx.bezierCurveTo(x - s * 0.4, y - s, x - s * 1.4, y - s * 0.2, x, y + s);
    }

    /** 小猫散步：矢量剪影 + 尾巴摆动 + 身后留下的爪印。 */
    function themeCat(g) {
      let cats = [];
      let prints = [];
      const spawn = (fromLeft) => ({
        x: fromLeft ? -180 : Math.random() * g.w,
        y: g.h * (0.32 + Math.random() * 0.48),
        v: 64 + Math.random() * 44,
        s: 0.9 + Math.random() * 0.6,
        ph: Math.random() * Math.PI * 2,
        tone: Math.random() < 0.5 ? 'a' : 'b',
        step: 0,
      });
      const reset = () => {
        cats = [spawn(true), spawn(true)];
        cats[1].x = g.w * 0.45;
        prints = [];
      };
      reset();

      const drawCat = (ctx, cat) => {
        const col = 'rgba(' + (cat.tone === 'a' ? g.pal.a : g.pal.b) + ',0.85)';
        const a = Math.sin(cat.ph) * 9;
        const b = Math.sin(cat.ph + Math.PI) * 9;
        const sway = Math.sin(cat.ph * 0.6) * 12;
        ctx.save();
        ctx.translate(cat.x, cat.y);
        ctx.scale(cat.s, cat.s);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineCap = 'round';
        // 身体
        ctx.beginPath();
        ctx.ellipse(0, 0, 46, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        // 头
        ctx.beginPath();
        ctx.arc(48, -20, 22, 0, Math.PI * 2);
        ctx.fill();
        // 耳朵
        ctx.beginPath();
        ctx.moveTo(38, -36);
        ctx.lineTo(41, -58);
        ctx.lineTo(55, -42);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(60, -38);
        ctx.lineTo(69, -57);
        ctx.lineTo(74, -34);
        ctx.closePath();
        ctx.fill();
        // 尾巴
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(-44, -4);
        ctx.quadraticCurveTo(-78, -14 + sway, -86, -46 + sway);
        ctx.stroke();
        // 四条腿
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(-28, 14);
        ctx.lineTo(-28 + a, 38);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-8, 14);
        ctx.lineTo(-8 + b, 38);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(20, 14);
        ctx.lineTo(20 + b, 38);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(36, 14);
        ctx.lineTo(36 + a, 38);
        ctx.stroke();
        ctx.restore();
      };

      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;

          for (let i = 0; i < prints.length; i += 1) {
            const p = prints[i];
            p.a -= t * 0.22;
          }
          prints = prints.filter((p) => p.a > 0);

          for (let i = 0; i < cats.length; i += 1) {
            const c = cats[i];
            c.x += c.v * t;
            c.ph += t * 7.5;
            c.step += t;
            if (c.x > w + 200) Object.assign(c, spawn(true));
            if (c.step > 0.32) {
              c.step = 0;
              prints.push({ x: c.x - 30 * c.s, y: c.y + 40 * c.s, a: 0.4, s: c.s });
            }
          }

          ctx.fillStyle = 'rgba(' + pal.c + ',0.45)';
          for (let i = 0; i < prints.length; i += 1) {
            const p = prints[i];
            ctx.globalAlpha = p.a;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, 6 * p.s, 4.5 * p.s, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(p.x + 9 * p.s, p.y - 5 * p.s, 2.4 * p.s, 2 * p.s, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;

          for (let i = 0; i < cats.length; i += 1) drawCat(ctx, cats[i]);
        },
      };
    }

    /** 小女生：连衣裙剪影 + 马尾 + 牵着的气球，一路小跑。 */
    function themeGirl(g) {
      const kid = { x: 0, y: 0, v: 110, ph: 0 };
      let hearts = [];
      const reset = () => {
        kid.x = Math.random() * g.w * 0.7;
        kid.y = g.h * (0.52 + Math.random() * 0.22);
        kid.v = 96 + Math.random() * 60;
        kid.ph = 0;
        hearts = [];
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;
          kid.ph += t * 9;
          kid.x += kid.v * t;
          if (kid.x > w + 120) {
            kid.x = -120;
            kid.y = h * (0.5 + Math.random() * 0.24);
            kid.v = 96 + Math.random() * 60;
          }
          const bob = Math.abs(Math.sin(kid.ph)) * -5;
          const swing = Math.sin(kid.ph);

          if (Math.random() < dt / 300) {
            hearts.push({ x: kid.x + 26, y: kid.y + bob - 40, a: 0.5, r: 6 + Math.random() * 6, vy: -16 - Math.random() * 12 });
          }

          ctx.save();
          ctx.translate(kid.x, kid.y + bob);
          ctx.scale(1.9, 1.9);
          ctx.lineCap = 'round';

          // 气球（牵在右手）
          const bx = 26;
          const by = -58 + Math.sin(kid.ph * 0.8) * 4;
          ctx.strokeStyle = 'rgba(' + pal.a + ',0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(10, -26);
          ctx.quadraticCurveTo(bx - 4, by + 22, bx, by + 10);
          ctx.stroke();
          ctx.fillStyle = 'rgba(' + pal.c + ',0.65)';
          ctx.beginPath();
          ctx.ellipse(bx, by, 10, 12, 0, 0, Math.PI * 2);
          ctx.fill();

          // 腿
          ctx.strokeStyle = 'rgba(' + pal.b + ',0.7)';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(-3, 10);
          ctx.lineTo(-3 + swing * 6, 26);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(3, 10);
          ctx.lineTo(3 - swing * 6, 26);
          ctx.stroke();

          // 连衣裙
          ctx.fillStyle = 'rgba(' + pal.b + ',0.8)';
          ctx.beginPath();
          ctx.moveTo(-2, -16);
          ctx.lineTo(2, -16);
          ctx.lineTo(11, 12);
          ctx.lineTo(-11, 12);
          ctx.closePath();
          ctx.fill();

          // 手臂
          ctx.strokeStyle = 'rgba(' + pal.c + ',0.7)';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(-6, -8);
          ctx.lineTo(-12 - swing * 4, 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(6, -8);
          ctx.lineTo(10, -26);
          ctx.stroke();

          // 头
          ctx.fillStyle = 'rgba(' + pal.c + ',0.85)';
          ctx.beginPath();
          ctx.arc(0, -26, 9, 0, Math.PI * 2);
          ctx.fill();
          // 马尾
          ctx.fillStyle = 'rgba(' + pal.b + ',0.75)';
          ctx.beginPath();
          ctx.arc(-8, -30, 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(8, -30, 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          for (let i = hearts.length - 1; i >= 0; i -= 1) {
            const hp = hearts[i];
            hp.y += hp.vy * t;
            hp.a -= t * 0.3;
            if (hp.a <= 0) {
              hearts.splice(i, 1);
              continue;
            }
            ctx.fillStyle = 'rgba(' + pal.b + ',' + hp.a + ')';
            heartPath(ctx, hp.x, hp.y, hp.r);
            ctx.fill();
          }
        },
      };
    }

    /** 飘雪：慢速下落 + 左右摇摆。 */
    function themeSnow(g) {
      let flakes = [];
      const reset = () => {
        flakes = [];
        for (let i = 0; i < 140; i += 1) {
          flakes.push({
            x: Math.random() * g.w,
            y: Math.random() * g.h,
            r: 1 + Math.random() * 2.4,
            v: 18 + Math.random() * 40,
            ph: Math.random() * Math.PI * 2,
            a: 0.25 + Math.random() * 0.45,
          });
        }
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;
          for (let i = 0; i < flakes.length; i += 1) {
            const f = flakes[i];
            f.ph += t * 1.2;
            f.y += f.v * t;
            f.x += Math.sin(f.ph) * 0.5;
            if (f.y > h + 6) {
              f.y = -6;
              f.x = Math.random() * w;
            }
            ctx.fillStyle = 'rgba(' + pal.a + ',' + f.a + ')';
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    }

    /** 肥皂泡：径向渐变的薄膜 + 高光 + 轻微形变，比空心的圆更像泡泡。 */
    function themeBubbles(g) {
      let items = [];
      const reset = () => {
        items = [];
        for (let i = 0; i < 16; i += 1) {
          items.push({
            x: Math.random() * g.w,
            y: Math.random() * (g.h + 200) - 100,
            r: 14 + Math.random() * 34,
            v: 24 + Math.random() * 44,
            ph: Math.random() * Math.PI * 2,
            squash: 0.9 + Math.random() * 0.2,
            tint: Math.random() < 0.5 ? 'c' : 'a',
          });
        }
      };
      reset();
      return {
        resize: reset,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;
          for (let i = 0; i < items.length; i += 1) {
            const b = items[i];
            b.ph += t * 1.4;
            b.y -= b.v * t;
            b.x += Math.sin(b.ph) * 0.8;
            if (b.y < -b.r - 20) {
              b.y = h + b.r + Math.random() * 200;
              b.x = Math.random() * w;
            }
            const rx = b.r;
            const ry = b.r * b.squash;
            const c = pal[b.tint];
            const grad = ctx.createRadialGradient(b.x - rx * 0.35, b.y - ry * 0.4, rx * 0.12, b.x, b.y, rx);
            grad.addColorStop(0, 'rgba(' + c + ',0.02)');
            grad.addColorStop(0.66, 'rgba(' + c + ',0.07)');
            grad.addColorStop(0.9, 'rgba(' + c + ',0.32)');
            grad.addColorStop(1, 'rgba(' + c + ',0.05)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(' + c + ',0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(' + pal.a + ',0.45)';
            ctx.beginPath();
            ctx.ellipse(b.x - rx * 0.36, b.y - ry * 0.44, rx * 0.15, ry * 0.09, -0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    }

    /**
     * 华山论剑（远山·写意）：三层远山视差 + 冷月 + 云岚 + 偶尔一道剑气 + 落叶。
     * 没有人、没有招式名，只有山水与光——官网首页用的就是这一版。
     *
     * 性能约束（改代码时请守住）：
     *   1. 每帧不做整屏渐变填充，全画布只有一次 clearRect；
     *   2. 月与雾在 build 时烘成贴图，每帧零新建渐变对象；
     *   3. 山只存顶点数组，视差靠平移，不重建形状。
     */
    function themeSword(g) {
      const rand = (i) => {
        const x = Math.sin(i * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };
      const TAU = Math.PI * 2;

      let moonSprite = null;
      let mistSprite = null;
      let ranges = [];
      let mist = [];
      let leaves = [];
      let arcs = [];
      let moon = { x: 0, y: 0, r: 40 };

      /** 月：晕 + 盘一次烘成贴图。 */
      function bakeMoon() {
        const size = Math.ceil(moon.r * 6);
        moonSprite = document.createElement('canvas');
        moonSprite.width = size;
        moonSprite.height = size;
        const c = moonSprite.getContext('2d');
        if (!c) {
          moonSprite = null;
          return;
        }
        const cx = size / 2;
        const halo = c.createRadialGradient(cx, cx, moon.r * 0.6, cx, cx, moon.r * 2.8);
        halo.addColorStop(0, 'rgba(' + g.pal.a + ',0.13)');
        halo.addColorStop(1, 'rgba(' + g.pal.a + ',0)');
        c.fillStyle = halo;
        c.beginPath();
        c.arc(cx, cx, moon.r * 2.8, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(' + g.pal.a + ',0.17)';
        c.beginPath();
        c.arc(cx, cx, moon.r, 0, TAU);
        c.fill();
      }

      /** 云岚：一张横向柔光，反复平移。 */
      function bakeMist() {
        mistSprite = document.createElement('canvas');
        mistSprite.width = 256;
        mistSprite.height = 64;
        const c = mistSprite.getContext('2d');
        if (!c) {
          mistSprite = null;
          return;
        }
        const grad = c.createRadialGradient(128, 32, 2, 128, 32, 126);
        grad.addColorStop(0, 'rgba(' + g.pal.c + ',1)');
        grad.addColorStop(1, 'rgba(' + g.pal.c + ',0)');
        c.fillStyle = grad;
        c.save();
        c.translate(128, 32);
        c.scale(1, 0.26);
        c.beginPath();
        c.arc(0, 0, 126, 0, TAU);
        c.fill();
        c.restore();
      }

      function build() {
        const w = g.w;
        const h = g.h;

        moon = { x: w * 0.14, y: h * 0.19, r: Math.min(w, h) * 0.06 };
        bakeMoon();
        bakeMist();

        const layers = [
          { base: h * 0.91, amp: h * 0.32, alpha: 0.1, speed: 7, seed: 1.3, step: 26 },
          { base: h * 0.97, amp: h * 0.23, alpha: 0.17, speed: 15, seed: 4.7, step: 20 },
          { base: h * 1.05, amp: h * 0.16, alpha: 0.27, speed: 28, seed: 9.1, step: 16 },
        ];
        const span = w + 240;
        ranges = [];
        for (let li = 0; li < layers.length; li += 1) {
          const cfg = layers[li];
          const pts = [];
          for (let x = -120; x <= span; x += cfg.step) {
            const i = (x + 120) / cfg.step;
            const n = rand(i + cfg.seed) * 0.6 + rand(i * 0.37 + cfg.seed * 2) * 0.4;
            const spike = Math.pow(rand(i * 0.13 + cfg.seed * 3), 3);
            pts.push({ x, y: cfg.base - cfg.amp * (0.25 + n * 0.5 + spike * 0.5) });
          }
          ranges.push({ pts, alpha: cfg.alpha, speed: cfg.speed, offset: rand(li + 3) * 200, span });
        }

        mist = [];
        for (let i = 0; i < 3; i += 1) {
          mist.push({
            x: rand(i + 21) * w,
            y: h * (0.52 + rand(i + 33) * 0.28),
            r: 120 + rand(i + 7) * 170,
            a: 0.05 + rand(i + 9) * 0.05,
            v: 6 + rand(i + 11) * 9,
          });
        }

        leaves = [];
        for (let i = 0; i < 14; i += 1) {
          leaves.push({
            x: rand(i + 41) * w,
            y: rand(i + 51) * h,
            r: 3 + rand(i + 61) * 4,
            v: 12 + rand(i + 71) * 18,
            ph: rand(i + 81) * 6.28,
            rot: rand(i + 91) * 6.28,
          });
        }

        // 开场先给一道剑气，静帧也有戏
        arcs = [{ x: w * 0.64, y: h * 0.28, r: Math.min(w, h) * 0.3, dir: -1, life: 0.24 }];
      }

      build();

      return {
        resize: build,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const t = dt / 1000;

          // 冷月（贴图）
          if (moonSprite) {
            const size = moon.r * 6;
            ctx.drawImage(moonSprite, moon.x - size / 2, moon.y - size / 2, size, size);
          }

          // 云岚（贴图）
          if (mistSprite) {
            for (let i = 0; i < mist.length; i += 1) {
              const m = mist[i];
              m.x += m.v * t;
              if (m.x - m.r > w) m.x = -m.r;
              ctx.globalAlpha = m.a * 2.2;
              ctx.drawImage(mistSprite, m.x - m.r, m.y - m.r * 0.26, m.r * 2, m.r * 0.52);
            }
            ctx.globalAlpha = 1;
          }

          // 三层远山
          for (let i = 0; i < ranges.length; i += 1) {
            const range = ranges[i];
            range.offset = (range.offset + range.speed * t) % range.span;
            ctx.fillStyle = 'rgba(' + pal.a + ',' + range.alpha + ')';
            for (let pass = 0; pass < 2; pass += 1) {
              const dx = -range.offset + pass * range.span;
              const pts = range.pts;
              ctx.beginPath();
              ctx.moveTo(pts[0].x + dx, h + 4);
              for (let k = 0; k < pts.length; k += 1) ctx.lineTo(pts[k].x + dx, pts[k].y);
              ctx.lineTo(pts[pts.length - 1].x + dx, h + 4);
              ctx.closePath();
              ctx.fill();
            }
          }

          // 剑气：偶尔横扫一道弧
          if (Math.random() < dt / 1050) {
            arcs.push({
              x: w * (0.15 + Math.random() * 0.7),
              y: h * (0.18 + Math.random() * 0.5),
              r: 80 + Math.random() * 140,
              dir: Math.random() < 0.5 ? 1 : -1,
              life: 0,
            });
          }
          for (let i = arcs.length - 1; i >= 0; i -= 1) {
            const s = arcs[i];
            s.life += t;
            if (s.life > 0.8) {
              arcs.splice(i, 1);
              continue;
            }
            const k = s.life / 0.8;
            const alpha = Math.sin(k * Math.PI) * 0.65;
            const sweep = -1.2 + k * 2.4;
            ctx.strokeStyle = 'rgba(' + pal.b + ',' + alpha + ')';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, sweep * s.dir, (sweep + 0.55) * s.dir, s.dir < 0);
            ctx.stroke();
            const tip = (sweep + 0.55) * s.dir;
            ctx.fillStyle = 'rgba(' + pal.c + ',' + alpha + ')';
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(tip) * s.r, s.y + Math.sin(tip) * s.r, 2.6, 0, TAU);
            ctx.fill();
          }

          // 落叶
          for (let i = 0; i < leaves.length; i += 1) {
            const l = leaves[i];
            l.ph += t * 1.4;
            l.y += l.v * t;
            l.x += Math.sin(l.ph) * 0.6;
            if (l.y > h + 10) {
              l.y = -10;
              l.x = Math.random() * w;
            }
            ctx.save();
            ctx.translate(l.x, l.y);
            ctx.rotate(l.rot + l.ph * 0.4);
            ctx.fillStyle = 'rgba(' + pal.c + ',0.34)';
            ctx.beginPath();
            ctx.ellipse(0, 0, l.r, l.r * 0.5, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
        },
      };
    }

    /**
     * 飞机大战：我方战机从画面下方飞入，随后左右巡航、连续开火；
     * 敌机从上方成批压下来，被击中就炸成一团火星。
     *
     * 性能：全部是即时绘制的小图形（约 30 个），没有渐变对象、没有离屏画布。
     */
    function themeShooter(g) {
      const TAU = Math.PI * 2;
      const rand = (i) => {
        const x = Math.sin(i * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };

      let player = { x: 0, y: 0 };
      let bullets = [];
      let enemies = [];
      let parts = [];
      let t = 0;
      let fireT = 0;
      let spawnT = 0;
      let seed = 1;

      function build() {
        const w = g.w;
        const h = g.h;
        player = { x: w * 0.4, y: h * 1.02 };
        bullets = [];
        enemies = [];
        parts = [];
        t = 0;
        fireT = 0;
        spawnT = 0;
        seed = 1;
        // 开局先摆几架敌机和几发子弹，首帧就有戏
        for (let i = 0; i < 4; i += 1) {
          enemies.push({
            x: w * (0.15 + rand(i + 2) * 0.7),
            y: h * (0.05 + rand(i + 5) * 0.4),
            vy: 55 + rand(i + 9) * 55,
            sway: rand(i + 11) * TAU,
            amp: 10 + rand(i + 13) * 26,
          });
        }
        for (let i = 0; i < 3; i += 1) {
          bullets.push({ x: w * (0.3 + i * 0.2), y: h * (0.4 + i * 0.1) });
        }
      }

      build();

      /** 一架飞机：dir=1 机头朝上（我方），-1 朝下（敌方）。 */
      function drawJet(ctx, x, y, s, dir, fill) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s * dir);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.lineTo(4.5, -3);
        ctx.lineTo(16, 4);
        ctx.lineTo(16, 8);
        ctx.lineTo(4.5, 6.5);
        ctx.lineTo(3, 13);
        ctx.lineTo(-3, 13);
        ctx.lineTo(-4.5, 6.5);
        ctx.lineTo(-16, 8);
        ctx.lineTo(-16, 4);
        ctx.lineTo(-4.5, -3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      return {
        resize: build,
        step(dt) {
          const { ctx, w, h, pal } = g;
          ctx.clearRect(0, 0, w, h);
          const sec = dt / 1000;
          t += sec;

          // 我方：从下方飞入，然后在底部中线附近巡航
          const targetY = h * 0.72;
          player.y += (targetY - player.y) * Math.min(1, sec * 3.6);
          const cruise = w * (0.5 + Math.sin(t * 0.6) * 0.26);
          player.x += (cruise - player.x) * Math.min(1, sec * 1.8);

          // 开火
          fireT += dt;
          if (fireT > 240 && bullets.length < 14) {
            fireT = 0;
            bullets.push({ x: player.x, y: player.y - 14 });
          }

          // 敌机成批下来
          spawnT += dt;
          if (spawnT > 560 && enemies.length < 7) {
            spawnT = 0;
            seed += 1;
            enemies.push({
              x: w * (0.08 + rand(seed * 1.7) * 0.84),
              y: -30,
              vy: 55 + rand(seed * 2.3) * 55,
              sway: rand(seed * 3.1) * TAU,
              amp: 10 + rand(seed * 4.7) * 26,
            });
          }

          // 子弹
          for (let i = bullets.length - 1; i >= 0; i -= 1) {
            const b = bullets[i];
            b.y -= 760 * sec;
            if (b.y < -20) {
              bullets.splice(i, 1);
              continue;
            }
            ctx.strokeStyle = 'rgba(' + pal.c + ',0.85)';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x, b.y - 13);
            ctx.stroke();
          }

          // 敌机 + 判定
          for (let i = enemies.length - 1; i >= 0; i -= 1) {
            const e = enemies[i];
            e.y += e.vy * sec;
            e.sway += sec * 2.2;
            const ex = e.x + Math.sin(e.sway) * e.amp;

            drawJet(ctx, ex, e.y, 1.05, -1, 'rgba(' + pal.b + ',0.72)');

            let hit = false;
            for (let j = bullets.length - 1; j >= 0; j -= 1) {
              const b = bullets[j];
              if (Math.abs(b.x - ex) < 15 && Math.abs(b.y - e.y) < 16) {
                bullets.splice(j, 1);
                hit = true;
                break;
              }
            }
            if (hit) {
              for (let k = 0; k < 9; k += 1) {
                const a = (k / 9) * TAU + rand(seed + k) * 0.6;
                const sp = 60 + rand(seed * 2 + k) * 130;
                parts.push({ x: ex, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0 });
              }
              enemies.splice(i, 1);
              continue;
            }
            if (e.y > h + 40) enemies.splice(i, 1);
          }

          // 火星
          for (let i = parts.length - 1; i >= 0; i -= 1) {
            const p = parts[i];
            p.life += sec;
            if (p.life > 0.55) {
              parts.splice(i, 1);
              continue;
            }
            p.x += p.vx * sec;
            p.y += p.vy * sec;
            const k = 1 - p.life / 0.55;
            ctx.fillStyle = 'rgba(' + pal.c + ',' + (k * 0.9).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.2 + k * 2.2, 0, TAU);
            ctx.fill();
          }

          // 我方战机（最后画，压在最上面）
          drawJet(ctx, player.x, player.y, 1.4, 1, 'rgba(' + pal.a + ',0.82)');
          // 尾焰
          const flame = 6 + Math.sin(t * 22) * 3;
          ctx.fillStyle = 'rgba(' + pal.c + ',0.55)';
          ctx.beginPath();
          ctx.moveTo(player.x - 3, player.y + 13);
          ctx.lineTo(player.x + 3, player.y + 13);
          ctx.lineTo(player.x, player.y + 13 + flame);
          ctx.closePath();
          ctx.fill();
        },
      };
    }

    /** 主题注册表：加一种新背景，就是往这里加一行。 */
    const STAGE_THEMES = [
      { id: 'warp', name: '星空跃迁', create: themeWarp },
      { id: 'rain', name: '代码雨', create: themeRain },
      { id: 'circuit', name: '电路脉冲', create: themeCircuit },
      { id: 'sword', name: '华山论剑', create: themeSword },
      { id: 'cat', name: '小猫散步', create: themeCat },
      { id: 'kid', name: '小女生', create: themeGirl },
      { id: 'shooter', name: '飞机大战', create: themeShooter },
      { id: 'racer', name: '赛车', create: themeRacer },
      { id: 'snow', name: '飘雪', create: themeSnow },
      { id: 'bubbles', name: '肥皂泡', create: themeBubbles },
    ];


    /* ================= 安装 / 拆卸 ================= */

    function install() {
      if (typeof document === 'undefined' || typeof window === 'undefined') return function () {};

      const style = addStyle();
      const stage = createStage();
      const tracked = new Set();
      const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

      let host = null;
      let contentEl = null;
      let observer = null;
      let pending = 0;
      let disposed = false;
      let gaveUp = false;
      let booted = false;
      let busy = false;
      let idleTimer = 0;
      let remountCount = 0;
      let remountAt = 0;
      let sessionKey = null;
      let quietUntil = 0;
      let forcedTheme = readPinnedTheme();
      let activeTheme = '';
      let idleSince = 0;
      let pendingTurn = false;
      let stageRaf = 0;
      let stageTheme = null;

      const reduced = () => media !== null && media.matches;

      /* ---------- 挂载 ---------- */

      function ensureHost() {
        if (disposed || gaveUp) return;
        if (host && host.isConnected && host.contains(stage)) return;

        const content = findCanvas();
        if (!content) return;
        contentEl = content;
        const canvas = pickWiderHost(content);
        if (canvas === host && canvas.contains(stage)) return;

        const now = Date.now();
        if (now - remountAt > TUNE.remountWindowMs) {
          remountAt = now;
          remountCount = 0;
        }
        remountCount += 1;
        if (remountCount > TUNE.remountGuard) {
          gaveUp = true;
          return;
        }

        const previous = host;
        if (host && host !== canvas) host.classList.remove(HOST_CLASS);
        host = canvas;
        host.classList.add(HOST_CLASS);
        if (stage.parentNode !== host) host.insertBefore(stage, host.firstChild);
        if (previous !== canvas) {
          unwatchSize();
          watchSize();
          resetForSwitch(previous !== null);
        }
      }

      /**
       * 回合的起点。
       * 首选信号：用户在输入框里按 Enter 发送（pendingTurn）——这是唯一可靠的"新回合"。
       * 兜底：真的闲了足够久又重新开工（有些宿主是点按钮发送，抓不到 Enter）。
       * 注意不能拿"新出现的 [data-streaming] 元素"当判据：流式输出时宿主会反复重建它。
       */
      function turnIsNew(running) {
        if (!running || busy) return false;
        if (pendingTurn) return true;
        const now = Date.now();
        return idleSince === 0 || now - idleSince > TUNE.newTurnGapMs;
      }

      /**
       * 切会话：上一轮的工具行可能还挂着，历史里的失败行也会被当成新事件。
       * 清空跟踪表、静默一小段时间，等新会话渲染稳定；顺便取该对话的主题。
       */
      function resetForSwitch(quiet) {
        tracked.clear();
        busy = false;
        if (idleTimer) {
          window.clearTimeout(idleTimer);
          idleTimer = 0;
        }
        quietUntil = quiet ? Date.now() + TUNE.switchQuietMs : 0;
        sessionKey = contentEl ? contentEl.getAttribute('data-conversation-session') || '' : null;
        activeTheme = '';
        syncStage();
      }

      /* ---------- 工具行跟踪 ---------- */

      function track(node) {
        if (!node || node.nodeType !== 1) return;
        if (node.matches && node.matches(ROW_SELECTOR)) tracked.add(node);
        if (!node.querySelectorAll) return;
        const inner = node.querySelectorAll(ROW_SELECTOR);
        for (let i = 0; i < inner.length; i += 1) tracked.add(inner[i]);
      }

      function prune() {
        for (const el of tracked) {
          if (!el.isConnected) tracked.delete(el);
        }
        while (tracked.size > TUNE.maxTracked) {
          tracked.delete(tracked.values().next().value);
        }
      }

      function seed() {
        const scope = document.querySelector('[data-conversation-scroll]') || document;
        const all = scope.querySelectorAll(ROW_SELECTOR);
        const from = Math.max(0, all.length - TUNE.seedRows);
        for (let i = from; i < all.length; i += 1) tracked.add(all[i]);
      }

      /* ---------- 状态判定：只关心"在不在干活" ---------- */

      function detectBusy() {
        for (const el of tracked) {
          if (!el.isConnected) continue;
          const state = el.getAttribute('data-state');
          if (state === 'running' || state === 'preparing') return true;
        }
        return document.querySelector('[data-chat-running], [data-streaming]') !== null;
      }

      function setBusy(next) {
        if (disposed) return;
        if (next) {
          if (idleTimer) {
            window.clearTimeout(idleTimer);
            idleTimer = 0;
          }
          if (!busy) {
            busy = true;
            if (pendingTurn) {
              pendingTurn = false;
              activeTheme = forcedTheme || randomThemeId();
            }
            syncStage();
          }
          return;
        }
        if (!busy || idleTimer) return;
        idleTimer = window.setTimeout(() => {
          idleTimer = 0;
          busy = false;
          idleSince = Date.now();
          syncStage();
        }, TUNE.holdIdleMs);
      }

      /* ---------- 背景播放 ---------- */

      /**
       * 主题跟着「回合」走：一个回合一个主题，回合内怎么停顿都不变，
       * 下一个回合（你发新消息）重新随机。
       * 按 Alt+T 固定过主题时，所有回合都用它。
       */
      let lastAssigned = '';

      function themeIds() {
        const ids = [];
        for (let i = 0; i < STAGE_THEMES.length; i += 1) ids.push(STAGE_THEMES[i].id);
        return ids;
      }

      /** 随机挑一个，尽量不要和上一个回合重复。 */
      function randomThemeId() {
        const ids = themeIds();
        let id = ids[(Math.random() * ids.length) | 0];
        if (ids.length > 1 && id === lastAssigned) id = ids[(ids.indexOf(id) + 1) % ids.length];
        lastAssigned = id;
        return id;
      }

      /** 这个回合该用哪个主题（固定值优先）。 */
      function themeForTurn() {
        return forcedTheme || activeTheme || (activeTheme = randomThemeId());
      }

      function stopStage() {
        if (stageRaf) window.cancelAnimationFrame(stageRaf);
        stageRaf = 0;
        stageTheme = null;
      }

      function startStage() {
        stopStage();
        if (!host) return;
        const canvas = stage.querySelector('canvas');
        if (!canvas) return;

        const rect = host.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        // 像素预算：大窗口下不要盲目上 2x，否则每帧填充的像素翻四倍
        const budget = 2.2e6;
        const dpr = Math.min(2, window.devicePixelRatio || 1, Math.max(1, Math.sqrt(budget / (w * h))));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const pal = stagePalette();
        ctx.globalCompositeOperation = pal.blend;

        const id = themeForTurn();
        activeTheme = id;
        stage.dataset.theme = id;
        let factory = STAGE_THEMES[0];
        for (let i = 0; i < STAGE_THEMES.length; i += 1) {
          if (STAGE_THEMES[i].id === id) factory = STAGE_THEMES[i];
        }
        stageTheme = factory.create({ ctx, w, h, pal });

        // 预热少量帧：只为第一帧不空，别拖慢回合开始
        for (let i = 0; i < 20; i += 1) stageTheme.step(16);
        if (reduced()) return;

        let last = 0;
        const frame = (now) => {
          if (!stageRaf) return;
          stageRaf = window.requestAnimationFrame(frame);
          if (document.hidden || !stageTheme) {
            last = now;
            return;
          }
          const dt = last ? Math.min(64, now - last) : 16;
          last = now;
          stageTheme.step(dt);
        };
        stageRaf = window.requestAnimationFrame(frame);
      }

      /** 只有"在干活 + 窗口可见"才播；其它情况彻底停下。 */
      function syncStage() {
        const want = busy && !document.hidden && !disposed && Date.now() >= quietUntil;
        if (!want) {
          delete stage.dataset.on;
          stopStage();
          return;
        }
        stage.dataset.on = '1';
        if (!stageRaf) startStage();
      }

      /** Alt+T：手动切到下一个，并固定住。 */
      function cycleTheme() {
        const ids = themeIds();
        let at = ids.indexOf(forcedTheme);
        if (at < 0) at = ids.indexOf(activeTheme);
        if (at < 0) at = 0;
        forcedTheme = ids[(at + 1) % ids.length];
        writeStore(STORAGE.theme, forcedTheme);
        activeTheme = forcedTheme;
        restartIfPlaying();
      }

      /** Alt+R：回到随机，并给这个回合换一个新的。 */
      function randomTheme() {
        forcedTheme = '';
        removeStore(STORAGE.theme);
        removeStore(STORAGE.legacyTheme);
        activeTheme = randomThemeId();
        restartIfPlaying();
      }

      function restartIfPlaying() {
        if (stageRaf || busy) {
          stopStage();
          if (busy && !document.hidden) startStage();
        }
      }

      /* ---------- 扫描 ---------- */

      function scan() {
        pending = 0;
        if (disposed) return;
        try {
          ensureHost();
          if (!host) return;

          const key = contentEl ? contentEl.getAttribute('data-conversation-session') || '' : '';
          if (sessionKey === null) sessionKey = key;
          else if (key !== sessionKey) {
            resetForSwitch(true);
            return;
          }
          if (Date.now() < quietUntil) {
            syncStage();
            return;
          }

          prune();
          const running = detectBusy();
          if (turnIsNew(running)) {
            activeTheme = forcedTheme || randomThemeId();
            if (stageRaf) {
              stopStage();
              startStage();
            }
          }
          setBusy(running);
        } catch {
          /* 任何一步失败都只是不生效，不影响宿主 */
        }
      }

      function requestScan() {
        if (disposed || pending) return;
        pending = window.setTimeout(scan, 48);
      }

      /* ---------- 监听 ---------- */

      function onMutations(records) {
        for (let i = 0; i < records.length; i += 1) {
          const record = records[i];
          if (record.type === 'childList') {
            for (const node of record.addedNodes) track(node);
          } else if (record.type === 'attributes') {
            track(record.target);
          }
        }
        requestScan();
      }

      function observe() {
        if (!document.body || observer) return;
        observer = new MutationObserver(onMutations);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-state'],
        });
      }

      function onVisibility() {
        if (document.hidden) {
          stopStage();
        } else {
          syncStage();
          requestScan();
        }
      }

      function onResize() {
        if (stageRaf) {
          stopStage();
          startStage();
        }
      }

      /**
       * 画布尺寸只在开始播放时取一次；如果窗口没变、但对话区自身变高变矮
       * （消息增减、输入区展开），bitmap 会被拉伸。用一个 ResizeObserver 跟上。
       */
      let sizeObserver = null;
      let lastW = 0;
      let lastH = 0;

      function watchSize() {
        if (!host || typeof window.ResizeObserver !== 'function' || sizeObserver) return;
        sizeObserver = new ResizeObserver((entries) => {
          const box = entries[0] && entries[0].contentRect;
          if (!box) return;
          const w = Math.round(box.width);
          const h = Math.round(box.height);
          if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
          lastW = w;
          lastH = h;
          onResize();
        });
        sizeObserver.observe(host);
        lastW = Math.round(host.getBoundingClientRect().width);
        lastH = Math.round(host.getBoundingClientRect().height);
      }

      function unwatchSize() {
        if (sizeObserver) sizeObserver.disconnect();
        sizeObserver = null;
      }

      function onKeyDown(event) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const key = String(event.key || '').toLowerCase();
        if (key === TUNE.themeKey) {
          cycleTheme();
          return;
        }
        if (key === TUNE.randomKey) randomTheme();
      }

      /** 在输入框里按 Enter 发送 = 新回合开始。 */
      function onComposerEnter(event) {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.isComposing) return;
        const target = event.target;
        if (!target || !target.closest) return;
        const composer = target.isContentEditable || target.tagName === 'TEXTAREA'
          ? target
          : target.closest('[contenteditable="true"], textarea');
        if (!composer) return;
        pendingTurn = true;
        if (!busy) {
          // 还没开工就先记着，等真的开始干活时再换
          activeTheme = forcedTheme || randomThemeId();
        }
      }

      /* ---------- 启动 ---------- */

      function boot() {
        if (disposed || booted) return;
        booted = true;
        ensureHost();
        try {
          seed();
        } catch {
          /* 会话还没渲染出来时没有可跟踪的行 */
        }
        requestScan();
        observe();
        onVisibility();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('resize', onResize, { passive: true });
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keydown', onComposerEnter, true);
      }

      if (document.body) boot();
      else document.addEventListener('DOMContentLoaded', boot, { once: true });

      /* ---------- 拆卸：必须恢复原样 ---------- */

      return function dispose() {
        if (disposed) return;
        disposed = true;
        if (pending) window.clearTimeout(pending);
        if (idleTimer) window.clearTimeout(idleTimer);
        if (observer) observer.disconnect();
        unwatchSize();
        document.removeEventListener('DOMContentLoaded', boot);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keydown', onComposerEnter, true);
        stopStage();
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        if (host) host.classList.remove(HOST_CLASS);
        style.remove();
      };
    }

    /* ================= 插件入口 ================= */

    /**
     * Alt+T 换背景主题。
     * Alt+D 切浅色/深色：走宿主 theme 服务，不直接改 body，和「设置 → 外观」始终一致。
     */
    function bindThemeHotkey(ctx) {
      if (!ctx || typeof ctx.inject !== 'function') return;
      ctx.inject(['theme'], (scope) => {
        const onKey = (event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (String(event.key || '').toLowerCase() !== 'd') return;
          try {
            scope.theme.setTheme(scope.theme.preference === 'dark' ? 'light' : 'dark');
          } catch {
            /* 主题服务拒绝时保持原样 */
          }
        };
        if (typeof scope.effect === 'function') {
          scope.effect(() => {
            window.addEventListener('keydown', onKey, true);
            return () => window.removeEventListener('keydown', onKey, true);
          });
        } else {
          window.addEventListener('keydown', onKey, true);
        }
      });
    }

    function apply(ctx) {
      if (ctx && typeof ctx.effect === 'function') ctx.effect(install);
      else install();
      bindThemeHotkey(ctx);
    }

    return { inject: [], apply };
  },
});
