(function(){
  "use strict";

  // Hide loading screen when ready
  window.addEventListener('load', () => {
    const loader = document.getElementById('loading-screen');
    if(loader){
      setTimeout(() => {
        loader.classList.add('fade-out');
        setTimeout(() => loader.remove(), 400);
      }, 400);
    }
  });

  // =========================================================
  // Save data (cores + inventory + settings), localStorage-backed
  // =========================================================
  const SAVE_KEY = 'blockdrop_save_v1';
  function loadSave(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        return Object.assign({ cores:0, inventory:{}, musicOn:true, sfxOn:true, controlMode:'normal' }, parsed);
      }
    }catch(e){}
    return { cores:0, inventory:{}, musicOn:true, sfxOn:true, controlMode:'normal' };
  }
  let save = loadSave();
  function persist(){
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }catch(e){}
  }

  // =========================================================
  // Control Mode & Custom Animated Mouse Cursor
  // =========================================================
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX, ringY = mouseY;
  const cursorDot = document.getElementById('cursor-dot');
  const cursorRing = document.getElementById('cursor-ring');

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (cursorDot) {
      cursorDot.style.left = mouseX + 'px';
      cursorDot.style.top = mouseY + 'px';
    }
  });

  function updateCursorAnimation() {
    ringX += (mouseX - ringX) * 0.22;
    ringY += (mouseY - ringY) * 0.22;
    if (cursorRing) {
      cursorRing.style.left = ringX + 'px';
      cursorRing.style.top = ringY + 'px';
    }
    requestAnimationFrame(updateCursorAnimation);
  }
  requestAnimationFrame(updateCursorAnimation);

  function applyControlMode() {
    // Disable custom cursor on mobile or touch-primary devices automatically
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
    if (save.controlMode === 'keyboard' && !isTouchDevice) {
      document.body.classList.remove('custom-cursor');
      document.body.classList.add('keyboard-mode');
    } else if (!isTouchDevice) {
      document.body.classList.add('custom-cursor');
      document.body.classList.remove('keyboard-mode');
    } else {
      document.body.classList.remove('custom-cursor');
      document.body.classList.remove('keyboard-mode');
    }
  }

  // Menu keydown navigation for Keyboard-Only mode
  window.addEventListener('keydown', (e) => {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;

    if (activeView.id === 'view-game' && running && !paused && !gameOver) return;

    if (save.controlMode === 'keyboard' || activeView.id !== 'view-game') {
      const focusables = Array.from(activeView.querySelectorAll('button:not([disabled]), .mode-card[tabindex="0"]'));
      if (!focusables.length) return;

      let currentIndex = focusables.indexOf(document.activeElement);

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % focusables.length;
        focusables[nextIndex].focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + focusables.length) % focusables.length;
        focusables[prevIndex].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (document.activeElement && typeof document.activeElement.click === 'function') {
          document.activeElement.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const backBtn = activeView.querySelector('.ghost, #btnResultsMenu, #overlayQuitBtn');
        if (backBtn) backBtn.click();
      }
    }
  });

  // =========================================================
  // Abilities & modes
  // =========================================================
  const ABILITIES = {
    bomb:    { id:'bomb',    name:'Line Bomb',    icon:'💣', desc:'Instantly clears your fullest row.', price:150, key:'Q' },
    slowmo:  { id:'slowmo',  name:'Slow-Mo',      icon:'🐌', desc:'Halves gravity for 8 seconds.',      price:150, key:'E' },
    revive:  { id:'revive',  name:'Second Chance',icon:'💠', desc:'Auto-saves you once by clearing the bottom half if you top out.', price:300, key:null },
    surge:   { id:'surge',   name:'Score Surge',  icon:'✨', desc:'+50% score for your next run. Used automatically at start.',       price:250, key:null }
  };
  const ABILITY_ORDER = ['bomb','slowmo','revive','surge'];

  const MODES = {
    marathon:{ id:'marathon', name:'Marathon', icon:'♾', desc:'Classic endless play. Speed ramps up as you clear lines.', timer:'up', endless:true },
    sprint:  { id:'sprint',   name:'40 Lines',  icon:'🏁', desc:'Clear 40 lines as fast as you can.', timer:'up', targetLines:40 },
    blitz:   { id:'blitz',    name:'Blitz',     icon:'⏱', desc:'Score as much as possible before the 2 minute clock runs out.', timer:'down', timeLimit:120 },
    zen:     { id:'zen',      name:'Zen',       icon:'🌙', desc:'No game overs — the stack clears itself if it gets too high.', timer:null, zen:true }
  };
  const MODE_ORDER = ['marathon','sprint','blitz','zen'];

  // =========================================================
  // Board / pieces
  // =========================================================
  const COLS = 10, ROWS = 20;
  const boardCanvas = document.getElementById('board');
  const ctx = boardCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next');
  const nctx = nextCanvas.getContext('2d');

  const CELL_BASE = 30;
  function resizeCanvas(){
    boardCanvas.width = CELL_BASE * COLS;
    boardCanvas.height = CELL_BASE * ROWS;
  }
  let CELL = CELL_BASE;
  function computeCell(){ CELL = boardCanvas.width / COLS; }

  const COLORS = {
    I:'#5ee7ff', O:'#ffe15e', T:'#c98bff',
    S:'#7dff9a', Z:'#ff7d8f', J:'#7c9eff', L:'#ffb86b'
  };
  const SHAPES = {
    I:[[0,1],[1,1],[2,1],[3,1]],
    O:[[1,0],[2,0],[1,1],[2,1]],
    T:[[1,0],[0,1],[1,1],[2,1]],
    S:[[1,0],[2,0],[0,1],[1,1]],
    Z:[[0,0],[1,0],[1,1],[2,1]],
    J:[[0,0],[0,1],[1,1],[2,1]],
    L:[[2,0],[0,1],[1,1],[2,1]]
  };
  const KEYS = Object.keys(SHAPES);

  function rotateCells(cells){
    const cx=1.5, cy=1.5;
    return cells.map(([x,y])=>{
      const nx = Math.round(cx-(y-cy));
      const ny = Math.round(cy+(x-cx));
      return [nx,ny];
    });
  }
  function newPiece(){
    const k = KEYS[Math.floor(Math.random()*KEYS.length)];
    return { key:k, cells:SHAPES[k].map(c=>c.slice()), x:3, y:-1, color:COLORS[k] };
  }

  // =========================================================
  // Match state
  // =========================================================
  let grid, current, nextPiece, score, lines, level, combo, dropInterval, dropTimer;
  let running=false, paused=false, gameOver=false;
  let lastTime=0;
  let matchMode = MODES.marathon;
  let matchStart = 0;
  let matchMultiplier = 1;
  let activeLoadout = {};
  let slowmoUntil = 0;
  let clearAnim = null;

  function startMatch(mode){
    matchMode = mode;
    grid = Array.from({length:ROWS}, ()=>Array(COLS).fill(null));
    current = newPiece();
    nextPiece = newPiece();
    score=0; lines=0; level=1; combo=-1;
    dropInterval = 800;
    dropTimer = 0;
    gameOver=false;
    clearAnim = null;
    running = true; paused = false;
    matchStart = performance.now();

    activeLoadout = {};
    for(const id of ABILITY_ORDER){
      activeLoadout[id] = save.inventory[id] || 0;
    }
    matchMultiplier = 1;
    if(activeLoadout.surge > 0){
      matchMultiplier = 1.5;
      activeLoadout.surge -= 1;
      save.inventory.surge = Math.max(0, (save.inventory.surge||0) - 1);
    }
    persist();

    document.getElementById('comboStat').style.display = 'none';
    document.getElementById('hudMode').textContent = mode.name;
    updateStats();
    updateAbilityBar();
    drawNext();
    showView('view-game');
    hideOverlay();
    startMusic();
  }

  function updateStats(){
    document.getElementById('score').textContent = score;
    document.getElementById('lines').textContent = lines;
    document.getElementById('level').textContent = level;
  }

  function collides(cells, ox, oy){
    for(const [cx,cy] of cells){
      const x=cx+ox, y=cy+oy;
      if(x<0||x>=COLS||y>=ROWS) return true;
      if(y>=0 && grid[y][x]) return true;
    }
    return false;
  }

  function lockPiece(){
    let topOut = false;
    for(const [cx,cy] of current.cells){
      const x = current.x+cx, y = current.y+cy;
      if(y<0){ topOut = true; continue; }
      grid[y][x] = current.color;
    }
    if(topOut){
      handleTopOut();
      return;
    }
    if(startClearIfAny()) return;
    combo = -1;
    updateCombo();
    spawnNext();
  }

  function spawnNext(){
    current = nextPiece;
    nextPiece = newPiece();
    if(collides(current.cells, current.x, current.y)){
      handleTopOut();
      return;
    }
    drawNext();
  }

  function handleTopOut(){
    if(matchMode.zen){
      clearBottomHalf();
      playSfx('ability');
      triggerShake();
      spawnNext();
      return;
    }
    if(activeLoadout.revive > 0){
      activeLoadout.revive -= 1;
      clearBottomHalf();
      updateAbilityBar();
      playSfx('ability');
      triggerShake();
      spawnNext();
      return;
    }
    endMatch('gameover');
  }

  function clearBottomHalf(){
    const rowsToClear = Math.floor(ROWS/2);
    for(let y = ROWS-rowsToClear; y<ROWS; y++){
      grid[y] = Array(COLS).fill(null);
    }
  }

  function hardDrop(){
    if(clearAnim || !running || paused || gameOver) return;
    let dy=0;
    while(!collides(current.cells, current.x, current.y+dy+1)) dy++;
    current.y += dy;
    lockPiece();
    playSfx('drop');
  }
  function move(dx){
    if(!collides(current.cells, current.x+dx, current.y)){
      current.x += dx;
    }
  }
  function softDrop(){
    if(!collides(current.cells, current.x, current.y+1)){
      current.y += 1;
    } else {
      lockPiece();
    }
  }
  function rotate(){
    if(current.key==='O') return;
    const rotated = rotateCells(current.cells);
    const kicks = [0,-1,1,-2,2];
    for(const k of kicks){
      if(!collides(rotated, current.x+k, current.y)){
        current.cells = rotated;
        current.x += k;
        playSfx('rotate');
        return;
      }
    }
  }

  // =========================================================
  // Line-clear animation
  // =========================================================
  function startClearIfAny(){
    const rows = [];
    for(let y=0;y<ROWS;y++){
      if(grid[y].every(c=>c)) rows.push(y);
    }
    if(!rows.length) return false;

    const tetris = rows.length >= 4;
    const particles = [];
    for(const y of rows){
      for(let x=0;x<COLS;x++){
        const color = grid[y][x];
        if(!color) continue;
        for(let i=0;i<4;i++){
          particles.push({
            x:x*CELL_BASE+CELL_BASE/2, y:y*CELL_BASE+CELL_BASE/2,
            vx:(Math.random()-0.5)*5, vy:-Math.random()*3-0.5,
            life:1, color
          });
        }
      }
    }
    clearAnim = { rows, start:performance.now(), duration: tetris?460:300, tetris, particles, count:rows.length };
    if(tetris) triggerShake();
    playSfx('clear', rows.length);
    return true;
  }

  function updateClearAnim(dt){
    if(!clearAnim) return;
    for(const p of clearAnim.particles){
      p.x += p.vx; p.y += p.vy; p.vy += 0.18;
      p.life -= dt/500;
    }
    if(performance.now() - clearAnim.start >= clearAnim.duration){
      finishClearAnim();
    }
  }

  function finishClearAnim(){
    const rows = clearAnim.rows;
    const cleared = rows.length;
    for(const y of rows.slice().sort((a,b)=>b-a)){
      grid.splice(y,1);
      grid.unshift(Array(COLS).fill(null));
    }

    const base = [0,100,300,500,800][cleared] || 0;
    combo = combo < 0 ? 0 : combo+1;
    const comboBonus = combo>0 ? combo*50*level : 0;
    const points = Math.round((base*level + comboBonus) * matchMultiplier);
    score += points;
    lines += cleared;

    const coresGained = Math.max(1, Math.round(points/40));
    save.cores += coresGained;
    persist();
    refreshCoreBadges();

    const newLevel = 1 + Math.floor(lines/10);
    if(newLevel !== level){
      level = newLevel;
      dropInterval = Math.max(120, 800 - (level-1)*70);
      setMusicTempo(level);
    }
    updateStats();
    updateCombo();
    clearAnim = null;

    if(matchMode.targetLines && lines >= matchMode.targetLines){
      endMatch('success');
      return;
    }
    spawnNext();
  }

  function updateCombo(){
    const stat = document.getElementById('comboStat');
    if(combo>0){
      stat.style.display='flex';
      document.getElementById('combo').textContent = combo;
    } else {
      stat.style.display='none';
    }
  }

  function triggerShake(){
    boardCanvas.classList.add('shake');
    setTimeout(()=>boardCanvas.classList.remove('shake'), 320);
  }

  function mixColor(hex, targetHex, t){
    const c1=hexToRgb(hex), c2=hexToRgb(targetHex);
    const r=Math.round(c1.r+(c2.r-c1.r)*t);
    const g=Math.round(c1.g+(c2.g-c1.g)*t);
    const b=Math.round(c1.b+(c2.b-c1.b)*t);
    return `rgb(${r},${g},${b})`;
  }
  function hexToRgb(hex){
    hex = hex.replace('#','');
    return { r:parseInt(hex.substring(0,2),16), g:parseInt(hex.substring(2,4),16), b:parseInt(hex.substring(4,6),16) };
  }

  // =========================================================
  // Abilities usage
  // =========================================================
  function useAbility(id){
    if(!running || paused || gameOver || clearAnim) return;
    if(id==='bomb'){
      if((activeLoadout.bomb||0) <= 0) return;
      let bestY=-1, bestCount=0;
      for(let y=0;y<ROWS;y++){
        const c = grid[y].filter(v=>v).length;
        if(c>bestCount){ bestCount=c; bestY=y; }
      }
      if(bestY<0) return;
      grid.splice(bestY,1);
      grid.unshift(Array(COLS).fill(null));
      activeLoadout.bomb -= 1;
      playSfx('ability');
      triggerShake();
      flashAbilitySlot('bomb');
      updateAbilityBar();
    } else if(id==='slowmo'){
      if((activeLoadout.slowmo||0) <= 0) return;
      slowmoUntil = performance.now() + 8000;
      activeLoadout.slowmo -= 1;
      playSfx('ability');
      flashAbilitySlot('slowmo');
      updateAbilityBar();
    }
  }

  function flashAbilitySlot(id){
    const el = document.querySelector(`.ability-slot[data-id="${id}"]`);
    if(!el) return;
    el.classList.add('flash');
    setTimeout(()=>el.classList.remove('flash'), 300);
  }

  function updateAbilityBar(){
    const bar = document.getElementById('abilityBar');
    bar.innerHTML = '';
    const usable = ABILITY_ORDER.filter(id => ABILITIES[id].key);
    for(const id of usable){
      const count = activeLoadout[id]||0;
      const ab = ABILITIES[id];
      const slot = document.createElement('div');
      slot.className = 'ability-slot ' + (count>0 ? 'usable' : 'empty');
      slot.dataset.id = id;
      slot.innerHTML = `<span class="hotkey">${ab.key}</span><span>${ab.icon} ${ab.name}</span><span class="count">×${count}</span>`;
      slot.addEventListener('click', ()=>useAbility(id));
      bar.appendChild(slot);
    }
  }

  // =========================================================
  // Drawing
  // =========================================================
  function drawCell(c,x,y,color){
    const px=x*CELL, py=y*CELL;
    c.fillStyle = color;
    c.fillRect(px+1,py+1,CELL-2,CELL-2);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(px+1,py+1,CELL-2,4);
  }
  function drawGlowCell(c,x,y,color){
    const p = Math.min(1,(performance.now()-clearAnim.start)/clearAnim.duration);
    const pulse = 0.5+0.5*Math.sin(p*Math.PI*7);
    const px=x*CELL, py=y*CELL;
    c.save();
    c.shadowColor = clearAnim.tetris ? '#ffe15e' : '#ffffff';
    c.shadowBlur = 14+pulse*16;
    c.fillStyle = mixColor(color,'#ffffff', Math.min(1,p*1.4));
    c.fillRect(px+1,py+1,CELL-2,CELL-2);
    c.restore();
  }
  function drawClearOverlay(){
    const p = Math.min(1,(performance.now()-clearAnim.start)/clearAnim.duration);
    ctx.save();
    for(const y of clearAnim.rows){
      const py=y*CELL;
      ctx.fillStyle = `rgba(255,255,255,${(1-p)*0.45})`;
      ctx.fillRect(0,py,boardCanvas.width,CELL);
      const sweepX = p*boardCanvas.width*1.3 - boardCanvas.width*0.15;
      const grad = ctx.createLinearGradient(sweepX-36,0,sweepX+36,0);
      grad.addColorStop(0,'rgba(255,255,255,0)');
      grad.addColorStop(0.5,'rgba(255,255,255,0.95)');
      grad.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0,py,boardCanvas.width,CELL);
    }
    if(clearAnim.tetris){
      ctx.fillStyle = `rgba(255,225,94,${(1-p)*0.12})`;
      ctx.fillRect(0,0,boardCanvas.width,boardCanvas.height);
    }
    ctx.restore();
  }
  function drawClearParticles(){
    ctx.save();
    for(const pt of clearAnim.particles){
      if(pt.life<=0) continue;
      ctx.globalAlpha = Math.max(0,pt.life);
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(pt.x-2,pt.y-2,4,4);
    }
    ctx.restore();
  }

  function draw(){
    computeCell();
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0,0,boardCanvas.width,boardCanvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for(let x=0;x<=COLS;x++){ ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,ROWS*CELL); ctx.stroke(); }
    for(let y=0;y<=ROWS;y++){ ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(COLS*CELL,y*CELL); ctx.stroke(); }

    const clearingRows = clearAnim ? clearAnim.rows : null;
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        if(!grid[y][x]) continue;
        if(clearingRows && clearingRows.includes(y)) drawGlowCell(ctx,x,y,grid[y][x]);
        else drawCell(ctx,x,y,grid[y][x]);
      }
    }

    if(current && !gameOver && !clearAnim){
      let gy=0;
      while(!collides(current.cells, current.x, current.y+gy+1)) gy++;
      ctx.globalAlpha=0.25;
      for(const [cx,cy] of current.cells){
        const y=current.y+cy+gy;
        if(y>=0) drawCell(ctx,current.x+cx,y,current.color);
      }
      ctx.globalAlpha=1;
      for(const [cx,cy] of current.cells){
        const y=current.y+cy;
        if(y>=0) drawCell(ctx,current.x+cx,y,current.color);
      }
    }

    if(clearAnim){
      drawClearOverlay();
      drawClearParticles();
    }
  }

  function drawNext(){
    nctx.fillStyle = '#07080f';
    nctx.fillRect(0,0,nextCanvas.width,nextCanvas.height);
    const size=16;
    const offX=(nextCanvas.width-4*size)/2;
    const offY=(nextCanvas.height-4*size)/2;
    for(const [cx,cy] of nextPiece.cells){
      nctx.fillStyle = nextPiece.color;
      nctx.fillRect(offX+cx*size+1, offY+cy*size+1, size-2, size-2);
    }
  }

  // =========================================================
  // Timer / win conditions
  // =========================================================
  function updateTimerHud(){
    const el = document.getElementById('hudTimer');
    if(!matchMode.timer){ el.textContent=''; return; }
    const elapsedMs = performance.now() - matchStart;
    if(matchMode.timer==='down'){
      const remainMs = Math.max(0, matchMode.timeLimit*1000 - elapsedMs);
      el.textContent = fmtTime(remainMs);
      if(remainMs<=0 && running && !gameOver){
        endMatch('timeup');
      }
    } else {
      let label = fmtTime(elapsedMs);
      if(matchMode.targetLines) label += ` · ${lines}/${matchMode.targetLines}`;
      el.textContent = label;
    }
  }
  function fmtTime(ms){
    const total = Math.max(0, Math.floor(ms/1000));
    const m = Math.floor(total/60), s = total%60;
    return `${m}:${s.toString().padStart(2,'0')}`;
  }

  function endMatch(reason){
    running = false;
    gameOver = true;
    stopMusic();
    if(reason==='gameover') playSfx('gameover');
    showResults(reason);
  }

  function showResults(reason){
    const titleEl = document.getElementById('resultsTitle');
    const subEl = document.getElementById('resultsSub');
    const statsEl = document.getElementById('resultsStats');
    const coresEl = document.getElementById('resultsCores');

    const titles = { gameover:'Topped Out', success:'Cleared!', timeup:"Time's Up" };
    const subs = {
      gameover:'The stack reached the top.',
      success: matchMode.id==='sprint' ? 'You cleared 40 lines.' : 'Objective complete.',
      timeup:'Blitz time expired.'
    };
    titleEl.textContent = titles[reason] || 'Run Complete';
    subEl.textContent = subs[reason] || '';

    const elapsed = performance.now() - matchStart;
    let rows = [
      ['Score', score],
      ['Lines', lines],
      ['Level', level],
      ['Time', fmtTime(elapsed)]
    ];
    statsEl.innerHTML = rows.map(([k,v])=>`<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');

    coresEl.textContent = `◆ Cores earned this run are already banked`;

    showView('view-results');
  }

  // =========================================================
  // Main loop
  // =========================================================
  function loop(t){
    if(!lastTime) lastTime=t;
    const dt = t-lastTime;
    lastTime = t;

    if(document.getElementById('view-game').classList.contains('active')){
      if(clearAnim){
        updateClearAnim(dt);
      } else if(running && !paused && !gameOver){
        const effInterval = performance.now() < slowmoUntil ? dropInterval*2 : dropInterval;
        dropTimer += dt;
        if(dropTimer > effInterval){
          dropTimer = 0;
          if(!collides(current.cells, current.x, current.y+1)){
            current.y += 1;
          } else {
            lockPiece();
          }
        }
      }
      updateTimerHud();
      draw();
    }
    requestAnimationFrame(loop);
  }

  // =========================================================
  // View management
  // =========================================================
  function showView(id){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const target = document.getElementById(id);
    target.classList.add('active');

    setTimeout(() => {
      const focusTarget = target.querySelector('.menu-btn.primary, .mode-card, button');
      if (focusTarget) focusTarget.focus();
    }, 50);
  }

  function refreshCoreBadges(){
    document.getElementById('menuCores').textContent = save.cores;
    document.getElementById('shopCores').textContent = save.cores;
  }

  // ---------- Menu ----------
  document.getElementById('btnPlay').addEventListener('click', ()=>{
    renderModeGrid();
    showView('view-modes');
  });
  document.getElementById('btnShop').addEventListener('click', ()=>{
    renderShop();
    showView('view-shop');
  });
  document.getElementById('btnSettings').addEventListener('click', ()=>{
    renderSettings();
    showView('view-settings');
  });

  // ---------- Mode select ----------
  let pendingMode = null;
  function renderModeGrid(){
    const grid = document.getElementById('modeGrid');
    grid.innerHTML = '';
    for(const id of MODE_ORDER){
      const m = MODES[id];
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.tabIndex = 0;
      card.innerHTML = `<div class="mode-icon">${m.icon}</div><h4>${m.name}</h4><p>${m.desc}</p>`;
      card.addEventListener('click', ()=>{
        pendingMode = m;
        renderLoadout(m);
        showView('view-loadout');
      });
      grid.appendChild(card);
    }
  }
  document.getElementById('btnModesBack').addEventListener('click', ()=>showView('view-menu'));

  // ---------- Loadout ----------
  function renderLoadout(mode){
    document.getElementById('loadoutModeTitle').textContent = mode.icon + '  ' + mode.name;
    document.getElementById('loadoutModeDesc').textContent = mode.desc;
    const grid = document.getElementById('loadoutGrid');
    grid.innerHTML = '';
    const owned = ABILITY_ORDER.filter(id => (save.inventory[id]||0) > 0);
    if(!owned.length){
      grid.innerHTML = '<span class="loadout-empty">No abilities owned yet — visit the Shop to buy some.</span>';
    } else {
      for(const id of owned){
        const ab = ABILITIES[id];
        const chip = document.createElement('div');
        chip.className = 'loadout-chip';
        chip.innerHTML = `<span>${ab.icon} ${ab.name}</span><span class="count">×${save.inventory[id]}</span>`;
        grid.appendChild(chip);
      }
    }
  }
  document.getElementById('btnLoadoutBack').addEventListener('click', ()=>showView('view-modes'));
  document.getElementById('btnStartMatch').addEventListener('click', ()=>{
    if(pendingMode) startMatch(pendingMode);
  });

  // ---------- Shop ----------
  function renderShop(){
    refreshCoreBadges();
    const grid = document.getElementById('shopGrid');
    grid.innerHTML = '';
    for(const id of ABILITY_ORDER){
      const ab = ABILITIES[id];
      const owned = save.inventory[id] || 0;
      const card = document.createElement('div');
      card.className = 'shop-card';
      card.innerHTML = `
        <div class="icon">${ab.icon}</div>
        <h4>${ab.name}</h4>
        <p>${ab.desc}</p>
        <div class="owned">Owned: ${owned}</div>
        <div class="buy-row">
          <span class="price">◆ ${ab.price}</span>
          <button ${save.cores<ab.price?'disabled':''}>Buy</button>
        </div>`;
      card.querySelector('button').addEventListener('click', ()=>{
        if(save.cores < ab.price) return;
        save.cores -= ab.price;
        save.inventory[id] = (save.inventory[id]||0) + 1;
        persist();
        renderShop();
      });
      grid.appendChild(card);
    }
  }
  document.getElementById('btnShopBack').addEventListener('click', ()=>{ refreshCoreBadges(); showView('view-menu'); });

  // ---------- Settings ----------
  function renderSettings(){
    const cBtn = document.getElementById('toggleControl');
    const mBtn = document.getElementById('toggleMusic');
    const sBtn = document.getElementById('toggleSfx');
    
    cBtn.textContent = save.controlMode === 'keyboard' ? 'Keyboard Only' : 'Normal (Mouse)';
    cBtn.classList.toggle('off', save.controlMode === 'keyboard');
    
    mBtn.textContent = save.musicOn ? 'On' : 'Off';
    mBtn.classList.toggle('off', !save.musicOn);
    
    sBtn.textContent = save.sfxOn ? 'On' : 'Off';
    sBtn.classList.toggle('off', !save.sfxOn);
  }

  document.getElementById('toggleControl').addEventListener('click', ()=>{
    save.controlMode = save.controlMode === 'keyboard' ? 'normal' : 'keyboard';
    persist();
    applyControlMode();
    renderSettings();
  });

  document.getElementById('toggleMusic').addEventListener('click', ()=>{
    save.musicOn = !save.musicOn;
    persist();
    renderSettings();
    musicOn = save.musicOn;
    document.getElementById('muteBtn').textContent = musicOn ? '🔊 Music' : '🔇 Music';
    if(!musicOn) pauseMusic(); else if(running && !paused) resumeMusic();
  });

  document.getElementById('toggleSfx').addEventListener('click', ()=>{
    save.sfxOn = !save.sfxOn;
    persist();
    renderSettings();
  });

  document.getElementById('btnSettingsBack').addEventListener('click', ()=>showView('view-menu'));

  // ---------- Results ----------
  document.getElementById('btnRetry').addEventListener('click', ()=>{
    if(pendingMode) startMatch(pendingMode);
  });
  document.getElementById('btnResultsMenu').addEventListener('click', ()=>{
    refreshCoreBadges();
    showView('view-menu');
  });

  // =========================================================
  // In-game overlay (pause)
  // =========================================================
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlaySub = document.getElementById('overlaySub');
  const overlayBtn = document.getElementById('overlayBtn');
  const overlayQuitBtn = document.getElementById('overlayQuitBtn');

  function showOverlay(title, sub, btnText){
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayBtn.textContent = btnText;
    overlay.style.display = 'flex';
  }
  function hideOverlay(){ overlay.style.display = 'none'; }

  overlayBtn.addEventListener('click', ()=>{
    if(paused){
      paused = false;
      hideOverlay();
      resumeMusic();
    }
  });
  overlayQuitBtn.addEventListener('click', ()=>{
    running = false;
    paused = false;
    hideOverlay();
    stopMusic();
    refreshCoreBadges();
    showView('view-menu');
  });

  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  function togglePause(){
    if(!running || gameOver || clearAnim) return;
    paused = !paused;
    if(paused){
      showOverlay('Paused', 'Press Resume or hit P', 'Resume');
      pauseMusic();
    } else {
      hideOverlay();
      resumeMusic();
    }
  }

  // =========================================================
  // Input
  // =========================================================
  window.addEventListener('keydown', (e)=>{
    if(!document.getElementById('view-game').classList.contains('active')) return;
    if(!running || paused || gameOver || clearAnim){
      if(e.key.toLowerCase()==='p') togglePause();
      return;
    }
    switch(e.key){
      case 'ArrowLeft': move(-1); e.preventDefault(); break;
      case 'ArrowRight': move(1); e.preventDefault(); break;
      case 'ArrowUp': rotate(); e.preventDefault(); break;
      case 'ArrowDown': softDrop(); e.preventDefault(); break;
      case ' ': hardDrop(); e.preventDefault(); break;
      case 'p': case 'P': togglePause(); break;
      case 'q': case 'Q': useAbility('bomb'); break;
      case 'e': case 'E': useAbility('slowmo'); break;
    }
  });

  function bindHold(el, fn, repeatMs){
    let iv;
    const start=(e)=>{ 
      e.preventDefault(); 
      if(!running||paused||gameOver||clearAnim) return; 
      fn(); 
      iv=setInterval(fn, repeatMs); 
    };
    const stop=(e)=>{ e.preventDefault(); clearInterval(iv); };
    
    el.addEventListener('touchstart', start, {passive:false});
    el.addEventListener('touchend', stop, {passive:false});
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', stop);
    el.addEventListener('mouseleave', stop);
  }
  bindHold(document.getElementById('tLeft'), ()=>move(-1), 120);
  bindHold(document.getElementById('tRight'), ()=>move(1), 120);
  bindHold(document.getElementById('tDown'), ()=>softDrop(), 80);
  document.getElementById('tRotate').addEventListener('touchstart', (e)=>{ e.preventDefault(); if(running&&!paused&&!gameOver&&!clearAnim) rotate(); }, {passive:false});
  document.getElementById('tRotate').addEventListener('click', (e)=>{ e.preventDefault(); if(running&&!paused&&!gameOver&&!clearAnim) rotate(); });
  document.getElementById('tDrop').addEventListener('touchstart', (e)=>{ e.preventDefault(); if(running&&!paused&&!gameOver&&!clearAnim) hardDrop(); }, {passive:false});
  document.getElementById('tDrop').addEventListener('click', (e)=>{ e.preventDefault(); if(running&&!paused&&!gameOver&&!clearAnim) hardDrop(); });

  // =========================================================
  // Audio: synthesized background music + sfx
  // =========================================================
  let audioCtx=null, musicGain, sfxGain;
  let musicOn = save.musicOn;
  let musicTimer=null, musicStep=0, musicTempoMs=260;

  const MELODY = ['E5','B4','C5','D5','C5','B4','A4','A4','C5','E5','D5','C5','B4','C5','D5','E5','C5','A4','A4',null,
                   'D5','F5','A5','G5','F5','E5','C5','E5','D5','C5','B4','B4','C5','D5','E5','C5','A4','A4',null,null];
  const BASS = ['A2',null,'A2',null,'E2',null,'E2',null,'F2',null,'F2',null,'E2',null,'E2',null];
  const NOTE_FREQ = {
    'A2':110.00,'E2':82.41,'F2':87.31,
    'A4':440.00,'B4':493.88,'C5':523.25,'D5':587.33,'E5':659.25,'F5':698.46,'G5':783.99,'A5':880.00
  };

  function ensureAudio(){
    if(!audioCtx){
      audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      musicGain = audioCtx.createGain(); musicGain.gain.value=0.18; musicGain.connect(audioCtx.destination);
      sfxGain = audioCtx.createGain(); sfxGain.gain.value=0.25; sfxGain.connect(audioCtx.destination);
    }
    if(audioCtx.state==='suspended') audioCtx.resume();
  }
  function playTone(freq,dur,type,gainNode,vol){
    if(!audioCtx) return;
    const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
    osc.type=type; osc.frequency.value=freq; g.gain.value=0;
    osc.connect(g); g.connect(gainNode);
    const now=audioCtx.currentTime;
    g.gain.linearRampToValueAtTime(vol, now+0.01);
    g.gain.linearRampToValueAtTime(0, now+dur);
    osc.start(now); osc.stop(now+dur+0.02);
  }
  function musicTick(){
    if(!musicOn || !audioCtx) return;
    const mNote = MELODY[musicStep % MELODY.length];
    const bNote = BASS[musicStep % BASS.length];
    if(mNote) playTone(NOTE_FREQ[mNote], 0.22, 'square', musicGain, 0.5);
    if(bNote) playTone(NOTE_FREQ[bNote], 0.28, 'triangle', musicGain, 0.6);
    musicStep++;
  }
  function startMusic(){
    ensureAudio();
    if(musicTimer) clearInterval(musicTimer);
    musicStep=0;
    if(musicOn) musicTimer = setInterval(musicTick, musicTempoMs);
  }
  function pauseMusic(){ if(musicTimer){ clearInterval(musicTimer); musicTimer=null; } }
  function resumeMusic(){ ensureAudio(); if(!musicTimer && musicOn){ musicTimer=setInterval(musicTick, musicTempoMs); } }
  function stopMusic(){ if(musicTimer){ clearInterval(musicTimer); musicTimer=null; } musicStep=0; }
  function setMusicTempo(lvl){
    musicTempoMs = Math.max(120, 260-(lvl-1)*18);
    if(musicTimer){ clearInterval(musicTimer); musicTimer=setInterval(musicTick, musicTempoMs); }
  }

  document.getElementById('muteBtn').addEventListener('click', ()=>{
    musicOn = !musicOn;
    save.musicOn = musicOn;
    persist();
    document.getElementById('muteBtn').textContent = musicOn ? '🔊 Music' : '🔇 Music';
    if(!musicOn) pauseMusic(); else resumeMusic();
  });

  function playSfx(kind, arg){
    if(!audioCtx || !save.sfxOn) return;
    try{
      if(kind==='rotate') playTone(660,0.06,'square',sfxGain,0.3);
      else if(kind==='drop') playTone(220,0.08,'sawtooth',sfxGain,0.35);
      else if(kind==='ability') playTone(880,0.1,'triangle',sfxGain,0.4);
      else if(kind==='clear'){
        const n=arg||1;
        for(let i=0;i<n;i++) setTimeout(()=>playTone(880+i*120,0.12,'square',sfxGain,0.4), i*60);
      } else if(kind==='gameover'){
        [440,330,220,110].forEach((f,i)=>setTimeout(()=>playTone(f,0.3,'sawtooth',sfxGain,0.4), i*160));
      }
    }catch(e){}
  }

  // =========================================================
  // Init
  // =========================================================
  document.getElementById('muteBtn').textContent = musicOn ? '🔊 Music' : '🔇 Music';
  resizeCanvas();
  refreshCoreBadges();
  applyControlMode();
  window.addEventListener('resize', applyControlMode);
  requestAnimationFrame(loop);
})();