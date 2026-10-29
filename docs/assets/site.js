(function () {
  var root = document.documentElement
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var store = {
    get: function (k) { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: function (k, v) { try { localStorage.setItem(k, v) } catch (e) {} }
  }

  // theme: saved choice, else the system setting
  var saved = store.get('pullshelf-site-theme')
  function applyTheme(t) { root.setAttribute('data-theme', t) }
  applyTheme(saved || 'dark')
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      store.set('pullshelf-site-theme', next)
    })
  })

  // nav border once scrolled
  var nav = document.querySelector('.nav')
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 8) }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // copy buttons
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy')
      var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t }, 1400) }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {})
    })
  })

  // reveal helper used when motion is off or the libraries failed to load
  function showAll() { root.classList.add('rm-off') }
  if (reduced || !window.gsap || !window.ScrollTrigger) {
    showAll()
    return
  }

  var gsap = window.gsap
  gsap.registerPlugin(window.ScrollTrigger)

  if (window.Lenis) {
    var lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true })
    lenis.on('scroll', window.ScrollTrigger.update)
    gsap.ticker.add(function (t) { lenis.raf(t * 1000) })
    gsap.ticker.lagSmoothing(0)
  }

  // generic rise-in
  gsap.utils.toArray('[data-rise]').forEach(function (el) {
    gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } })
  })

  // hero: the shelf drops, then the panes run a looping script
  var hero = document.querySelector('[data-hero]')
  if (hero) {
    var shelf = hero.querySelector('.shelf')
    var lines = hero.querySelectorAll('.term .ln')
    var clips = hero.querySelectorAll('.clip')
    var tiles = hero.querySelectorAll('.tile')
    var note = hero.querySelector('[data-note]')
    var noteText = note ? note.getAttribute('data-note') : ''
    gsap.set(shelf, { yPercent: -104 })
    gsap.set([lines, clips, tiles], { autoAlpha: 0 })
    if (note) note.textContent = ''
    var tl = gsap.timeline({ delay: 0.5 })
    tl.to(shelf, { yPercent: 0, duration: 1.1, ease: 'back.out(1.25)' })
    tl.to(lines, { autoAlpha: 1, duration: 0.01, stagger: 0.42 }, '+=0.1')
    tl.fromTo(clips, { autoAlpha: 0, y: -14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: 0.35 }, '-=0.6')
    tl.fromTo(tiles, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.3 }, '-=0.5')
    var counter = { n: 0 }
    tl.to(counter, { n: noteText.length, duration: 1.6, ease: 'none', onUpdate: function () { if (note) note.textContent = noteText.slice(0, Math.floor(counter.n)) } }, '-=0.4')
    // scroll nudges the shelf like it is still attached to the top edge
    gsap.to(shelf, { y: -26, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } })
  }

  // four panes: pinned, each pane takes the stage in turn
  var scene = document.querySelector('[data-panes]')
  if (scene && window.matchMedia('(min-width: 861px)').matches) {
    var panes = scene.querySelectorAll('.pane')
    var caps = scene.querySelectorAll('.cap')
    var bars = scene.querySelectorAll('.steps i')
    var desk = scene.querySelector('.shelf')
    var weights = [[62, 12, 12, 14], [14, 60, 12, 14], [14, 12, 60, 14], [14, 12, 12, 62]]
    function focusPane(i) {
      weights[i].forEach(function (w, k) { gsap.to(desk, { ['--c' + (k + 1)]: w + 'fr', duration: 0.6, ease: 'power3.inOut', overwrite: 'auto' }) })
      panes.forEach(function (p, k) { p.classList.toggle('dim', k !== i) })
      caps.forEach(function (c, k) { c.classList.toggle('on', k === i) })
    }
    var steps = 4
    window.ScrollTrigger.create({
      trigger: scene, start: 'top top', end: '+=' + steps * 90 + '%', pin: true, scrub: true,
      onUpdate: function (self) {
        var p = Math.min(0.9999, self.progress)
        var i = Math.floor(p * steps)
        if (scene._i !== i) { scene._i = i; focusPane(i) }
        bars.forEach(function (b, k) { b.style.width = Math.max(0, Math.min(1, p * steps - k)) * 100 + '%' })
      }
    })
    focusPane(0)
  } else if (scene) {
    scene.querySelectorAll('.cap').forEach(function (c) { c.classList.add('on'); c.style.position = 'static'; c.style.opacity = 1; c.style.transform = 'none'; c.style.marginBottom = '24px' })
  }

  // gesture: scroll drives finger travel and the reveal 1:1
  var g = document.querySelector('[data-gesture]')
  if (g) {
    var fingers = g.querySelectorAll('.finger')
    var lip = g.querySelector('.lip')
    var st = { trigger: g, start: 'top 75%', end: 'bottom 30%', scrub: 0.5 }
    gsap.fromTo(fingers, { y: 0 }, { y: '170%', ease: 'none', scrollTrigger: st })
    gsap.fromTo(lip, { yPercent: -100 }, { yPercent: -8, ease: 'none', scrollTrigger: st })
  }
})()
