/* ════════════════════════════════════════════════════════
   IMFSMA — animations.js
   Dynamic UI effects: particle canvas, ripple buttons,
   animated number counters, stagger observers.
   All client-side only — zero server impact.
   ════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════
   1. PARTICLE CANVAS BACKGROUND
   Floating, connected dots that pulse subtly
   ══════════════════════════════════════════ */
(function initParticles() {
    const canvas = document.createElement('canvas');
    canvas.id = 'particle-canvas';
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');

    const PARTICLE_COUNT = 55;
    const CONNECTION_DIST = 130;
    const IS_DAY = () => document.body.classList.contains('day-mode');

    let W, H, particles = [];

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function rnd(min, max) { return Math.random() * (max - min) + min; }

    function mkParticle() {
        return {
            x:  rnd(0, W),
            y:  rnd(0, H),
            vx: rnd(-0.18, 0.18),
            vy: rnd(-0.18, 0.18),
            r:  rnd(1.2, 2.4),
            alpha: rnd(0.3, 0.7),
            dAlpha: rnd(0.002, 0.005) * (Math.random() > 0.5 ? 1 : -1),
        };
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(mkParticle());

    function getColor(alpha) {
        if (IS_DAY()) {
            // Darker indigo + boosted alpha so particles stand out on a light background
            const dayAlpha = Math.min(alpha * 2.2, 0.9);
            return `rgba(29, 78, 216, ${dayAlpha})`;
        }
        return `rgba(59, 130, 246, ${alpha})`;
    }

    function frame() {
        ctx.clearRect(0, 0, W, H);

        particles.forEach(p => {
            // Move
            p.x += p.vx;
            p.y += p.vy;

            // Bounce edges
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;

            // Pulse alpha
            p.alpha += p.dAlpha;
            if (p.alpha < 0.2 || p.alpha > 0.75) p.dAlpha *= -1;

            // Draw dot
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = getColor(p.alpha);
            ctx.fill();
        });

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECTION_DIST) {
                    const lineAlpha = (1 - dist / CONNECTION_DIST) * 0.25;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = getColor(lineAlpha);
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(frame);
    }

    frame();
})();

/* ══════════════════════════════════════════
   2. RIPPLE EFFECT ON BUTTONS
   Shows a spreading circle on click
   ══════════════════════════════════════════ */
(function initRipple() {
    function addRipple(e) {
        const btn = e.currentTarget;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top  - size / 2;

        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
        btn.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }

    function attachRipples() {
        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
            if (!btn.dataset.ripple) {
                btn.dataset.ripple = '1';
                btn.addEventListener('click', addRipple);
            }
        });
    }

    // Initial attach
    attachRipples();

    // Re-attach after dynamic DOM updates (e.g., after analysis renders)
    const observer = new MutationObserver(attachRipples);
    observer.observe(document.body, { childList: true, subtree: true });
})();

/* ══════════════════════════════════════════
   3. ANIMATED NUMBER COUNTER
   Counts up to a target number smoothly
   ══════════════════════════════════════════ */
function animateCounter(el, targetStr, duration = 900) {
    if (!el) return;
    const isNumeric  = /^[₹]?[\d,]+(\.\d+)?%?$/.test(targetStr);
    if (!isNumeric) { el.textContent = targetStr; return; }

    // Strip formatting to get raw number
    const raw    = parseFloat(targetStr.replace(/[^0-9.-]/g, '')) || 0;
    const prefix = targetStr.startsWith('₹') ? '₹' : '';
    const suffix = targetStr.endsWith('%')   ? '%' : '';
    const decimals = (targetStr.split('.')[1] || '').replace('%','').length;

    const start    = performance.now();
    const startVal = 0;

    function tick(now) {
        const elapsed  = Math.min(now - start, duration);
        const progress = elapsed / duration;
        // Ease-out cubic
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = startVal + (raw - startVal) * ease;
        el.textContent = prefix + current.toLocaleString('en-IN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }) + suffix;
        el.classList.add('counter-flash');
        if (elapsed < duration) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// Expose so main.js can call it when metrics load
window.animateCounter = animateCounter;

/* ══════════════════════════════════════════
   4. INTERSECTION OBSERVER — STAGGER CARDS
   Cards & list items animate in as they
   scroll into the viewport
   ══════════════════════════════════════════ */
(function initIntersectionObserver() {
    const style = document.createElement('style');
    style.textContent = `
        .anim-hidden {
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .anim-visible {
            opacity: 1;
            transform: translateY(0);
        }
    `;
    document.head.appendChild(style);

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('anim-visible');
                io.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

    function observeCards() {
        document.querySelectorAll('.card, .metric-card, .summary-card-sm, .data-cell, .tech-pill').forEach((el, i) => {
            if (!el.dataset.observed) {
                el.dataset.observed = '1';
                el.classList.add('anim-hidden');
                // Stagger delay per index (max 400ms) 
                el.style.transitionDelay = Math.min(i * 35, 400) + 'ms';
                io.observe(el);
            }
        });
    }

    // Watch for DOM additions (page switches, dynamic renders)
    const mutObs = new MutationObserver(observeCards);
    mutObs.observe(document.body, { childList: true, subtree: true });

    observeCards();
})();


/* ══════════════════════════════════════════
   6. NAVBAR SCROLL SHADOW
   Add a stronger shadow to navbar on scroll
   ══════════════════════════════════════════ */
(function initNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 10) {
            navbar.style.boxShadow = '0 4px 30px rgba(0,0,0,0.5)';
            navbar.style.borderBottomColor = 'rgba(37, 99, 235, 0.2)';
        } else {
            navbar.style.boxShadow = '';
            navbar.style.borderBottomColor = '';
        }
    }, { passive: true });
})();

/* ══════════════════════════════════════════
   7. ANIMATED PAGE-LOAD COUNTER FOR STATS
   When history stats or portfolio summary
   cards update, animate the numbers
   ══════════════════════════════════════════ */
(function patchStatCounters() {
    // Watch for summary cards and history stat cards being updated
    const statWatch = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                // Stat value elements
                node.querySelectorAll && node.querySelectorAll('.value, .metric-value').forEach(el => {
                    const raw = el.textContent.trim();
                    if (raw && raw !== '—') {
                        el.dataset.target = raw;
                        animateCounter(el, raw, 800);
                    }
                });
            });
        });
    });

    statWatch.observe(document.body, { childList: true, subtree: true });
})();
