/* Sudoku v2. One dependency-free JavaScript file. Works on GitHub Pages and offline. */
(() => {
  'use strict';

  // Retain the original storage keys so existing players do not lose their games or best times.
  const CLASSIC_KEY = 'just-sudoku-game-v1';
  const DAILY_KEY = 'just-sudoku-daily-v2';
  const ACTIVE_KEY = 'just-sudoku-active-v2';
  const STATS_KEY = 'just-sudoku-stats-v1';
  const PREFS_KEY = 'just-sudoku-prefs-v1';
  const LEVELS = {
    Beginner: { clues: 52, description: 'Learn the basics' },
    Easy:     { clues: 45, description: 'A gentle challenge' },
    Medium:   { clues: 39, description: 'A little more thinking' },
    Hard:     { clues: 34, description: 'Fewer starting numbers' },
    Expert:   { clues: 30, description: 'Tougher deductions' },
    Master:   { clues: 27, description: 'For seasoned players' },
    Extreme:  { clues: 25, description: 'Our toughest challenge' }
  };
  const FULL = 0x1ff;
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), digitsEl = $('digits'), modalEl = $('modal');
  const defaults = { showMistakes: true, highlightPeers: true, autoRemoveNotes: true, theme: 'system', remainingCounts: true };
  const getStore = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const setStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const validDigit = n => Number.isInteger(n) && n >= 0 && n <= 9;
  const safeNumber = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
  const boxIndex = (r,c) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
  const popCount = n => { let c = 0; for (; n; n &= n-1) c++; return c; };
  let prefs = { ...defaults, ...(getStore(PREFS_KEY) || {}) };
  if (!['system','light','dark'].includes(prefs.theme)) prefs.theme = 'system';
  let active = getStore(ACTIVE_KEY) === 'daily' ? 'daily' : 'classic';
  let stats = normalizeStats(getStore(STATS_KEY));
  let state = null, notesMode = false, feedback = 'Select a square to begin';
  let busy = false;

  function normalizeStats(data) {
    const old = data && typeof data === 'object' ? data : {};
    const levels = {};
    for (const name of Object.keys(LEVELS)) {
      const previous = old.perLevel && old.perLevel[name] || {};
      levels[name] = {
        played: safeNumber(previous.played), solved: safeNumber(previous.solved),
        totalMs: safeNumber(previous.totalMs), clean: safeNumber(previous.clean)
      };
    }
    const best = {};
    for (const [name, time] of Object.entries(old.best || {})) {
      if (LEVELS[name] && Number.isFinite(time) && time >= 0) best[name] = time;
    }
    const cleanBest = {};
    for (const [name, time] of Object.entries(old.cleanBest || {})) {
      if (LEVELS[name] && Number.isFinite(time) && time >= 0) cleanBest[name] = time;
    }
    return {
      played: safeNumber(old.played), solved: safeNumber(old.solved), totalMs: safeNumber(old.totalMs),
      best, cleanBest, perLevel: levels, dailySolved: safeNumber(old.dailySolved),
      currentStreak: safeNumber(old.currentStreak), bestStreak: safeNumber(old.bestStreak),
      lastSolvedDay: typeof old.lastSolvedDay === 'string' ? old.lastSolvedDay : '',
      history: Array.isArray(old.history) ? old.history.slice(0, 100).filter(x => x && typeof x === 'object') : []
    };
  }
  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function dayNumber(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return -1;
    const [y,m,d] = day.split('-').map(Number);
    return Math.floor(Date.UTC(y,m-1,d)/86400000);
  }
  function formatTime(ms) {
    const sec = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  const formatDate = day => { const [year, month, d] = (day || today()).split('-').map(Number); return new Date(year,month-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
  function shuffle(array, random = Math.random) {
    const items = array.slice();
    for (let i = items.length-1; i > 0; i--) {
      const j = Math.floor(random() * (i+1));
      [items[i],items[j]] = [items[j],items[i]];
    }
    return items;
  }
  function seededRandom(seedText) {
    let seed = 2166136261;
    for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
  }
  function makeSolution(random) {
    const digits = shuffle([1,2,3,4,5,6,7,8,9], random);
    const rowOrder = shuffle([0,1,2],random).flatMap(b => shuffle([0,1,2],random).map(i=>b*3+i));
    const colOrder = shuffle([0,1,2],random).flatMap(b => shuffle([0,1,2],random).map(i=>b*3+i));
    const transpose = random() < .5;
    const solution = [];
    for (let r=0; r<9; r++) for (let c=0; c<9; c++) {
      const row = transpose ? colOrder[c] : rowOrder[r];
      const col = transpose ? rowOrder[r] : colOrder[c];
      solution.push(digits[(row*3+Math.floor(row/3)+col)%9]);
    }
    return solution;
  }
  function validSolution(grid) {
    if (!Array.isArray(grid) || grid.length !== 81 || grid.some(n=>!Number.isInteger(n)||n<1||n>9)) return false;
    for (let i=0; i<9; i++) {
      const row = new Set(), col = new Set(), box = new Set();
      for (let j=0; j<9; j++) {
        row.add(grid[i*9+j]); col.add(grid[j*9+i]);
        box.add(grid[(Math.floor(i/3)*3+Math.floor(j/3))*9+(i%3)*3+j%3]);
      }
      if (row.size!==9 || col.size!==9 || box.size!==9) return false;
    }
    return true;
  }
  // Exact solution counter with early termination at two, so every published puzzle is unique.
  function countSolutions(input) {
    const grid = input.slice();
    const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);
    for (let i=0; i<81; i++) {
      const v=grid[i]; if (!v) continue;
      const r=Math.floor(i/9),c=i%9,b=boxIndex(r,c),bit=1<<(v-1);
      if ((rows[r]|cols[c]|boxes[b])&bit) return 0;
      rows[r]|=bit; cols[c]|=bit; boxes[b]|=bit;
    }
    let found=0;
    function search() {
      let best=-1, choices=0, min=10;
      for (let i=0;i<81;i++) {
        if (grid[i]) continue;
        const r=Math.floor(i/9),c=i%9;
        const mask=FULL&~(rows[r]|cols[c]|boxes[boxIndex(r,c)]);
        const n=popCount(mask);
        if (!n) return;
        if (n<min) { min=n; best=i; choices=mask; if (n===1) break; }
      }
      if (best<0) { found++; return; }
      const r=Math.floor(best/9),c=best%9,b=boxIndex(r,c);
      while (choices && found<2) {
        const bit=choices&-choices; choices^=bit;
        grid[best]=32-Math.clz32(bit);
        rows[r]|=bit; cols[c]|=bit; boxes[b]|=bit;
        search();
        rows[r]^=bit; cols[c]^=bit; boxes[b]^=bit; grid[best]=0;
      }
    }
    search(); return found;
  }
  // Count squares that remain after repeatedly applying human-style naked/hidden singles.
  // Used as a secondary heuristic, alongside clue count. Not an official Sudoku difficulty rating.
  function singlesRemaining(puzzle) {
    const grid=puzzle.slice();
    for (let pass=0;pass<81;pass++) {
      let placed=false;
      const candidates=Array(81).fill(0);
      for (let i=0;i<81;i++) {
        if (grid[i]) continue;
        const r=Math.floor(i/9),c=i%9;
        let used=0;
        for (let j=0;j<9;j++) {
          const rv=grid[r*9+j],cv=grid[j*9+c];
          if(rv) used|=1<<(rv-1); if(cv) used|=1<<(cv-1);
        }
        const br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;
        for(let dr=0;dr<3;dr++)for(let dc=0;dc<3;dc++) {
          const v=grid[(br+dr)*9+bc+dc]; if(v) used|=1<<(v-1);
        }
        candidates[i]=FULL&~used;
        if(popCount(candidates[i])===1) {
          grid[i]=32-Math.clz32(candidates[i]); placed=true; break;
        }
      }
      if(placed)continue;
      // Hidden singles in row, column, and 3x3 box.
      for(let unit=0;unit<27&&!placed;unit++) {
        const cells=[];
        for(let j=0;j<9;j++) {
          if(unit<9) cells.push(unit*9+j);
          else if(unit<18) cells.push(j*9+(unit-9));
          else { const b=unit-18; cells.push((Math.floor(b/3)*3+Math.floor(j/3))*9+(b%3)*3+j%3); }
        }
        for(let d=1;d<=9&&!placed;d++) {
          const choices=cells.filter(i=>!grid[i]&&(candidates[i]&(1<<(d-1))));
          if(choices.length===1) {grid[choices[0]]=d;placed=true;}
        }
      }
      if(!placed)break;
    }
    return grid.filter(x=>!x).length;
  }
  function generatePuzzle(difficulty, seedText=null) {
    const random = seedText ? seededRandom('daily-sudoku-v2-'+seedText) : Math.random;
    const target = LEVELS[difficulty].clues;
    const high = ['Expert','Master','Extreme'].includes(difficulty);
    let best=null, bestScore=Infinity;
    const attempts = difficulty==='Extreme' ? 6 : difficulty==='Master' ? 5 : 4;
    for (let attempt=0;attempt<attempts;attempt++) {
      const solution=makeSolution(random), puzzle=solution.slice();
      let left=81;
      for(const i of shuffle(Array.from({length:81},(_,k)=>k),random)) {
        if(left<=target)break;
        const previous=puzzle[i]; puzzle[i]=0;
        if(countSolutions(puzzle)===1)left--;
        else puzzle[i]=previous;
      }
      const unresolved=singlesRemaining(puzzle);
      // Prefer singles-friendly introductory puzzles, and non-trivial harder puzzles.
      const skillPenalty = high ? (unresolved===0 ? 6 : 0) : (difficulty==='Beginner'||difficulty==='Easy' ? unresolved*3 : 0);
      const score = Math.max(0,left-target)*4 + skillPenalty + (high ? -Math.min(5,unresolved/5) : 0);
      if(score<bestScore) { best={solution,puzzle,clues:left}; bestScore=score; }
      if(left<=target && skillPenalty===0)break;
    }
    return best;
  }
  function hydrateGame(raw, slot) {
    if (!raw || typeof raw !== 'object' || !LEVELS[raw.difficulty]) return null;
    for (const key of ['puzzle','solution','entries','notes']) {
      if (!Array.isArray(raw[key]) || raw[key].length!==81) return null;
    }
    if (!validSolution(raw.solution) || raw.puzzle.some((v,i)=>!validDigit(v)||(v&&v!==raw.solution[i])) ||
      raw.entries.some((v,i)=>!validDigit(v)||(raw.puzzle[i]&&v!==raw.puzzle[i]))) return null;
    const notes=raw.notes.map(a=>Array.isArray(a)?[...new Set(a.filter(v=>Number.isInteger(v)&&v>=1&&v<=9))]:[]);
    const history=Array.isArray(raw.history)?raw.history.filter(h=>h&&Array.isArray(h.entries)&&h.entries.length===81&&
      h.entries.every(validDigit)&&Array.isArray(h.notes)&&h.notes.length===81).slice(-100).map(h=>({
        entries:h.entries.slice(),notes:h.notes.map(a=>Array.isArray(a)?a.filter(v=>Number.isInteger(v)&&v>=1&&v<=9):[]),
        selected:Number.isInteger(h.selected)&&h.selected>=-1&&h.selected<81?h.selected:-1
      })):[];
    return {
      puzzle:raw.puzzle.slice(),solution:raw.solution.slice(),entries:raw.entries.slice(),notes,
      selected:Number.isInteger(raw.selected)&&raw.selected>=-1&&raw.selected<81?raw.selected:-1,
      difficulty:raw.difficulty,slot, date:slot==='daily'?(raw.date||''):'',
      elapsedMs:safeNumber(raw.elapsedMs),startedAt:null,running:false,
      mistakes:safeNumber(raw.mistakes),hints:safeNumber(raw.hints),history,
      complete:!!raw.complete,clues:raw.puzzle.filter(Boolean).length
    };
  }
  function currentKey() { return active==='daily' ? DAILY_KEY : CLASSIC_KEY; }
  function saveGame() {
    if(!state)return;
    setStore(currentKey(),{...state,elapsedMs:elapsedNow(),startedAt:null,running:false,history:state.history.slice(-100)});
  }
  function elapsedNow() {return state ? state.elapsedMs + (state.running?Math.max(0,Date.now()-state.startedAt):0) : 0;}
  function pauseClock() {
    if(!state||!state.running)return;
    state.elapsedMs=elapsedNow(); state.startedAt=null;state.running=false;saveGame();
  }
  function resumeClock() {
    if(!state||state.complete||!modalEl.hidden||state.running||document.hidden)return;
    state.startedAt=Date.now();state.running=true;updateTimer();
  }
  function applyTheme() {
    const chosen=prefs.theme==='system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : prefs.theme;
    document.body.dataset.theme=chosen;
    $('theme-meta')?.setAttribute('content',chosen==='dark'?'#121a28':'#f6f8fc');
  }
  const isPeer=(a,b)=>a>=0&&b>=0&&(Math.floor(a/9)===Math.floor(b/9)||a%9===b%9||boxIndex(Math.floor(a/9),a%9)===boxIndex(Math.floor(b/9),b%9));
  function message(s) {feedback=s;$('status').textContent=s;}
  function renderBoard() {
    const selected=state.selected;
    const value=selected>=0?state.entries[selected]:0;
    const fragment=document.createDocumentFragment();
    for(let i=0;i<81;i++) {
      const button=document.createElement('button');
      const r=Math.floor(i/9),c=i%9, fixed=!!state.puzzle[i];
      button.type='button';button.className='cell';button.dataset.index=i;
      button.setAttribute('role','gridcell');
      if(fixed)button.classList.add('fixed');
      if(c===2||c===5)button.classList.add('right-box');
      if(r===2||r===5)button.classList.add('bottom-box');
      if(c===8)button.classList.add('last-col');
      if(r===8)button.classList.add('last-row');
      if(prefs.highlightPeers&&selected!==-1&&isPeer(i,selected))button.classList.add('peer');
      if(value&&state.entries[i]===value&&i!==selected)button.classList.add('same');
      if(prefs.showMistakes&&state.entries[i]&&!fixed&&state.entries[i]!==state.solution[i])button.classList.add('wrong');
      if(i===selected){button.classList.add('selected');button.setAttribute('aria-selected','true');}
      button.setAttribute('aria-label',`Row ${r+1}, column ${c+1}, ${state.entries[i]||'empty'}${fixed?', given':''}`);
      if(state.entries[i])button.textContent=String(state.entries[i]);
      else if(state.notes[i].length){
        const notes=document.createElement('span');notes.className='notes';
        for(let n=1;n<=9;n++){const mini=document.createElement('span');mini.textContent=state.notes[i].includes(n)?String(n):'';notes.appendChild(mini);}
        button.appendChild(notes);
      }
      fragment.appendChild(button);
    }
    boardEl.replaceChildren(fragment);
  }
  function renderDigits() {
    const fragment=document.createDocumentFragment();
    for(let n=1;n<=9;n++) {
      // Don't count incorrect entries as completed numbers.
      const correct=state.entries.filter((v,i)=>v===n&&state.solution[i]===n).length;
      const button=document.createElement('button');
      button.type='button';button.className='digit';button.dataset.number=n;
      button.setAttribute('aria-label',`Enter ${n}${prefs.remainingCounts?`, ${9-correct} left`:''}`);
      const digit=document.createElement('span');digit.textContent=n;button.appendChild(digit);
      if(prefs.remainingCounts){const small=document.createElement('small');small.textContent=9-correct;button.appendChild(small);}
      button.disabled=!!state.complete || (correct===9&&!notesMode);
      fragment.appendChild(button);
    }
    digitsEl.replaceChildren(fragment);
  }
  function updateTimer() {if(state)$('timer').textContent=formatTime(elapsedNow());}
  function render() {
    if(!state)return;
    $('difficulty-display').textContent=state.difficulty;
    $('daily-label').hidden=active!=='daily';
    $('daily-label').textContent=active==='daily'?` · ${formatDate(state.date)} challenge`:'';
    $('daily-button').classList.toggle('active',active==='daily');
    $('mistakes').textContent=`Mistakes: ${state.mistakes}`;
    $('hints').textContent=state.hints;
    $('notes-button').classList.toggle('active',notesMode);
    $('notes-button').setAttribute('aria-pressed',String(notesMode));
    $('undo-button').disabled=state.complete||!state.history.length;
    $('erase-button').disabled=state.complete;
    $('hint-button').disabled=state.complete;
    $('auto-notes-button').disabled=state.complete;
    $('pause-button').disabled=state.complete;
    $('status').textContent=feedback;
    renderBoard();renderDigits();updateTimer();
  }
  function makeState(difficulty,slot,date,puzzle,solution) {
    return { puzzle,solution,entries:puzzle.slice(),notes:Array.from({length:81},()=>[]),
      selected:-1,difficulty,slot,date:date||'',elapsedMs:0,startedAt:null,running:false,
      mistakes:0,hints:0,history:[],complete:false,clues:puzzle.filter(Boolean).length };
  }
  function recordStart(level) {
    stats.played++;
    stats.perLevel[level].played++;
    setStore(STATS_KEY,stats);
  }
  async function startGame(difficulty,slot='classic',date='') {
    if(busy||!LEVELS[difficulty])return;
    busy=true;pauseClock();
    const lastGame=state,lastSlot=active;
    modalEl.hidden=false;
    $('dialog-title').textContent='Preparing puzzle';
    $('modal-content').innerHTML='<p>Generating a fresh Sudoku with one unique solution…</p>';
    $('close-modal').disabled=true;
    await new Promise(resolve=>setTimeout(resolve,35)); // Give mobile Safari a chance to paint.
    try {
      const result=generatePuzzle(difficulty,slot==='daily'?date:null);
      if(lastGame){active=lastSlot;saveGame();}
      active=slot;
      state=makeState(difficulty,slot,date,result.puzzle,result.solution);
      setStore(ACTIVE_KEY,active);
      recordStart(difficulty);
      notesMode=false;feedback='Select a square to begin';
      saveGame();modalEl.hidden=true;render();resumeClock();
    } catch(error) {
      console.error('Sudoku puzzle generation failed',error);
      active=lastSlot;state=lastGame;
      modalEl.hidden=true;message('Could not create a puzzle. Please try again.');
      resumeClock();
    } finally { busy=false;$('close-modal').disabled=false; }
  }
  function restoreSlot(slot) {
    const raw=getStore(slot==='daily'?DAILY_KEY:CLASSIC_KEY);
    if(slot==='daily'&&(!raw||raw.date!==today()))return null;
    return hydrateGame(raw,slot);
  }
  async function switchMode(slot) {
    if(busy)return;
    if(slot===active && !(slot==='daily'&&state.date!==today()))return;
    pauseClock();saveGame();
    const restored=restoreSlot(slot);
    if(restored){active=slot;setStore(ACTIVE_KEY,active);state=restored;notesMode=false;feedback=state.complete?'Challenge complete!':'Welcome back!';modalEl.hidden=true;render();resumeClock();}
    else await startGame(slot==='daily'?'Medium':'Easy',slot,slot==='daily'?today():'');
  }
  function historySnapshot() {
    state.history.push({entries:state.entries.slice(),notes:state.notes.map(a=>a.slice()),selected:state.selected});
    if(state.history.length>100)state.history.shift();
  }
  function removePeerNotes(index,digit) {
    if(!prefs.autoRemoveNotes)return;
    for(let i=0;i<81;i++) if(isPeer(i,index))state.notes[i]=state.notes[i].filter(n=>n!==digit);
  }
  function selectedEditable() {
    if(state.complete)return false;
    if(state.selected<0){message('Tap a square first');return false;}
    if(state.puzzle[state.selected]){message('Given numbers cannot be changed');return false;}
    return true;
  }
  function isComplete() {return state.entries.every((v,i)=>v===state.solution[i]);}
  function enterNumber(n) {
    if(!selectedEditable()||!Number.isInteger(n)||n<1||n>9)return;
    const i=state.selected;
    if(notesMode){
      if(state.entries[i]){message('Erase that number to add notes');return;}
      historySnapshot();
      const existing=state.notes[i];
      state.notes[i]=existing.includes(n)?existing.filter(x=>x!==n):[...existing,n].sort((a,b)=>a-b);
      message('Pencil notes updated');
    } else {
      if(state.entries[i]===n)return;
      historySnapshot();state.entries[i]=n;state.notes[i]=[];
      if(n!==state.solution[i]){state.mistakes++;message('Try another number');}
      else {removePeerNotes(i,n);message('Keep going!');}
    }
    if(isComplete()) finishGame();
    else {render();saveGame();}
  }
  function eraseSelected(){
    if(!selectedEditable())return;
    const i=state.selected;
    if(state.entries[i]===0&&!state.notes[i].length)return;
    historySnapshot();state.entries[i]=0;state.notes[i]=[];
    message('Square cleared');render();saveGame();
  }
  function undo() {
    if(state.complete||!state.history.length)return;
    const previous=state.history.pop();
    state.entries=previous.entries;state.notes=previous.notes;state.selected=previous.selected;
    // Intentionally do not refund hints or mistakes when undo is used.
    message('Last move undone');render();saveGame();
  }
  function hint() {
    if(state.complete)return;
    let i=state.selected;
    if(i<0||state.entries[i]===state.solution[i])i=state.entries.findIndex((v,index)=>v!==state.solution[index]);
    if(i<0)return;
    historySnapshot();state.selected=i;state.entries[i]=state.solution[i];state.notes[i]=[];
    state.hints++;removePeerNotes(i,state.solution[i]);message('Hint filled one square');
    if(isComplete())finishGame();else{render();saveGame();}
  }
  function autoNotes() {
    if(state.complete)return;
    historySnapshot();
    const rowMask=Array(9).fill(0),colMask=Array(9).fill(0),boxMask=Array(9).fill(0);
    for(let i=0;i<81;i++) {
      const v=state.entries[i];if(!v)continue;
      const r=Math.floor(i/9),c=i%9,bit=1<<(v-1);
      rowMask[r]|=bit;colMask[c]|=bit;boxMask[boxIndex(r,c)]|=bit;
    }
    for(let i=0;i<81;i++){
      if(state.entries[i])continue;
      const r=Math.floor(i/9),c=i%9;
      const allowed=FULL&~(rowMask[r]|colMask[c]|boxMask[boxIndex(r,c)]);
      state.notes[i]=[];
      for(let n=1;n<=9;n++)if(allowed&(1<<(n-1)))state.notes[i].push(n);
    }
    message('Possible pencil marks filled');render();saveGame();
  }
  function updateStreak(date) {
    const gap=dayNumber(date)-dayNumber(stats.lastSolvedDay);
    if(gap===0)return;
    stats.currentStreak=gap===1?stats.currentStreak+1:1;
    stats.bestStreak=Math.max(stats.bestStreak,stats.currentStreak);
    stats.lastSolvedDay=date;
  }
  function finishGame(){
    if(state.complete)return;
    pauseClock();state.complete=true;state.running=false;
    const level=state.difficulty,t=state.elapsedMs;
    stats.solved++;stats.totalMs+=t;
    stats.perLevel[level].solved++;stats.perLevel[level].totalMs+=t;
    const oldBest=stats.best[level];
    const newBest=oldBest==null||t<oldBest;
    if(newBest)stats.best[level]=t;
    if(state.hints===0&&state.mistakes===0){
      stats.perLevel[level].clean++;
      if(stats.cleanBest[level]==null||t<stats.cleanBest[level])stats.cleanBest[level]=t;
    }
    if(active==='daily')stats.dailySolved++;
    const day=today();updateStreak(day);
    stats.history.unshift({difficulty:level,mode:active,date:day,elapsedMs:t,mistakes:state.mistakes,hints:state.hints});
    stats.history=stats.history.slice(0,100);
    setStore(STATS_KEY,stats);
    message('Puzzle completed!');saveGame();render();showModal('won',newBest);
  }
  function statsMarkup(){
    const percentage=stats.played?Math.round(stats.solved/stats.played*100):0;
    const streak=(dayNumber(today())-dayNumber(stats.lastSolvedDay)>1)?0:stats.currentStreak;
    const bestRows=Object.keys(LEVELS).map(name=>{
      const s=stats.perLevel[name];
      return `<tr><td>${name}</td><td>${s.solved}</td><td>${stats.best[name]===undefined?'—':formatTime(stats.best[name])}</td><td>${s.solved?formatTime(s.totalMs/s.solved):'—'}</td></tr>`;
    }).join('');
    const recent=stats.history.slice(0,7).map(h=>{
      const safeLevel=LEVELS[h.difficulty]?h.difficulty:'Sudoku';
      return `<tr><td>${safeLevel}${h.mode==='daily'?' ★':''}</td><td>${Number.isFinite(h.elapsedMs)?formatTime(h.elapsedMs):'—'}</td><td>${Number.isFinite(h.hints)?h.hints:0}</td><td>${Number.isFinite(h.mistakes)?h.mistakes:0}</td></tr>`;
    }).join('');
    return `<div class="stat-grid">
      <div class="stat-card"><div class="number">${stats.solved}</div><div class="label">Puzzles finished</div></div>
      <div class="stat-card"><div class="number">${stats.played}</div><div class="label">Games started</div></div>
      <div class="stat-card"><div class="number">${percentage}%</div><div class="label">Completion rate</div></div>
      <div class="stat-card"><div class="number">${stats.solved?formatTime(stats.totalMs/stats.solved):'—'}</div><div class="label">Average solve time</div></div>
      <div class="stat-card"><div class="number">${streak}</div><div class="label">Current daily streak</div></div>
      <div class="stat-card"><div class="number">${stats.bestStreak}</div><div class="label">Best daily streak</div></div>
    </div><p class="stats-caption">Daily challenges solved: <strong>${stats.dailySolved}</strong> · A streak counts days on which you finish at least one puzzle.</p>
    <p class="stats-caption"><strong>By difficulty</strong> · Completed / best / average</p>
    <table class="records stats-table"><thead><tr><th>Level</th><th>Solved</th><th>Best</th><th>Avg.</th></tr></thead><tbody>${bestRows}</tbody></table>
    <p class="stats-caption"><strong>Recent completions</strong></p>
    ${recent?`<table class="records stats-table"><thead><tr><th>Level</th><th>Time</th><th>Hints</th><th>Errors</th></tr></thead><tbody>${recent}</tbody></table>`:'<p>No completed puzzles yet. Finish one to see your history.</p>'}
    <div class="helper-note">Records are stored privately on this device. Old personal bests are preserved from version 1. A clean solve means no hints or mistakes.</div>`;
  }
  function showModal(type,newBest=false){
    if(busy)return;
    pauseClock();const body=$('modal-content');
    if(type==='new'){
      $('dialog-title').textContent='New Game';
      body.innerHTML=`<p>Choose one of seven difficulties. All puzzles have exactly one solution. Levels use clue counts and basic logical complexity, so difficulty is approximate.</p><div class="level-list">${Object.entries(LEVELS).map(([name,config])=>
        `<button type="button" class="level-btn" data-level="${name}"><strong>${name}</strong><span>${config.description} · ~${config.clues} clues</span></button>`).join('')}</div>`;
    } else if(type==='stats'){
      $('dialog-title').textContent='Statistics';body.innerHTML=statsMarkup();
    } else if(type==='settings'){
      $('dialog-title').textContent='Settings';
      body.innerHTML=`<label class="setting"><span>Highlight related squares</span><input data-pref="highlightPeers" type="checkbox" ${prefs.highlightPeers?'checked':''}></label>
      <label class="setting"><span>Show incorrect entries</span><input data-pref="showMistakes" type="checkbox" ${prefs.showMistakes?'checked':''}></label>
      <label class="setting"><span>Clear matching notes automatically</span><input data-pref="autoRemoveNotes" type="checkbox" ${prefs.autoRemoveNotes?'checked':''}></label>
      <label class="setting"><span>Show remaining digit counts</span><input data-pref="remainingCounts" type="checkbox" ${prefs.remainingCounts?'checked':''}></label>
      <label class="setting"><span>Appearance</span><select class="option-select" data-theme><option value="system" ${prefs.theme==='system'?'selected':''}>Match phone</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option></select></label>
      <p class="stats-caption"><strong>Backup and restore</strong></p>
      <div class="button-row"><button class="secondary" data-action="export">Export backup</button></div>
      <label class="file-upload">Restore from backup<input type="file" id="restore-file" accept=".json,application/json"></label>
      <div class="button-row"><button class="secondary danger" data-action="clear-stats">Reset statistics</button></div>
      <div class="helper-note">Everything works offline. Game saves and statistics are private to this device. Export a backup before clearing Safari website data or deleting the app.</div>`;
    } else if(type==='won'){
      $('dialog-title').textContent='Puzzle solved!';
      body.innerHTML=`<div class="completed-badge">✓</div><p class="win-title">Great work!</p>
      <p class="win-desc">${active==='daily'?'Daily Challenge · ':''}${state.difficulty} · ${formatTime(state.elapsedMs)}<br>${state.mistakes} mistakes · ${state.hints} hints${newBest?'<br><strong style="color:#409de7">New personal best!</strong>':''}</p>
      <button class="primary" data-action="again">${active==='daily'?'Play a regular game':'Play another puzzle'}</button>`;
    } else if(type==='pause'){
      $('dialog-title').textContent='Paused';
      body.innerHTML='<p>The timer is stopped. Your puzzle is saved automatically.</p><button class="primary" data-action="resume">Resume game</button>';
    }
    modalEl.hidden=false;
    $('close-modal').focus();
  }
  function closeModal(){if(busy)return;modalEl.hidden=true;resumeClock();updateTimer();}
  function selectCell(i){
    if(!Number.isInteger(i)||i<0||i>=81)return;
    state.selected=i;feedback=state.puzzle[i]?'Given number':'Choose a number below';
    renderBoard();$('status').textContent=feedback;saveGame();
  }
  function exportBackup() {
    saveGame();
    const data={format:'just-sudoku-backup',version:2,created:new Date().toISOString(),
      classic:getStore(CLASSIC_KEY),daily:getStore(DAILY_KEY),active,prefs,stats};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`sudoku-backup-${today()}.json`;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    message('Backup prepared — save it in Files');
  }
  async function restoreBackup(file) {
    if(!file)return;
    try {
      if(file.size>3_000_000)throw new Error('File is too large.');
      const backup=JSON.parse(await file.text());
      if(backup.format!=='just-sudoku-backup'||backup.version!==2||
        !backup.stats||typeof backup.stats!=='object'||!backup.prefs||typeof backup.prefs!=='object')throw new Error('Not a valid Sudoku backup.');
      if(backup.classic&&!hydrateGame(backup.classic,'classic'))throw new Error('Classic game in backup is invalid.');
      if(backup.daily&&!hydrateGame(backup.daily,'daily'))throw new Error('Daily game in backup is invalid.');
      if(!window.confirm('Replace your local Sudoku progress and statistics with this backup?'))return;
      pauseClock();
      if(backup.classic)setStore(CLASSIC_KEY,backup.classic);else{try{localStorage.removeItem(CLASSIC_KEY);}catch{}}
      if(backup.daily)setStore(DAILY_KEY,backup.daily);else{try{localStorage.removeItem(DAILY_KEY);}catch{}}
      stats=normalizeStats(backup.stats);setStore(STATS_KEY,stats);
      prefs={...defaults,...backup.prefs};if(!['system','dark','light'].includes(prefs.theme))prefs.theme='system';
      setStore(PREFS_KEY,prefs);applyTheme();
      active=backup.active==='daily'?'daily':'classic';setStore(ACTIVE_KEY,active);
      state=restoreSlot(active)||restoreSlot('classic')||restoreSlot('daily');
      if(state){active=state.slot;setStore(ACTIVE_KEY,active);}
      notesMode=false;modalEl.hidden=true;
      if(state){feedback='Backup restored';render();resumeClock();}else await startGame('Beginner');
    } catch(err) {window.alert(`Could not restore backup: ${err.message}`);}
  }
  function clearStats() {
    if(!window.confirm('Delete all local statistics and personal bests? Your current Sudoku puzzle will stay.'))return;
    stats=normalizeStats(null);setStore(STATS_KEY,stats);showModal('stats');
  }

  boardEl.addEventListener('click',e=>{const el=e.target.closest('.cell');if(el)selectCell(Number(el.dataset.index));});
  digitsEl.addEventListener('click',e=>{const el=e.target.closest('.digit');if(el)enterNumber(Number(el.dataset.number));});
  $('notes-button').addEventListener('click',()=>{if(state.complete)return;notesMode=!notesMode;message(notesMode?'Pencil notes on':'Pencil notes off');render();});
  $('hint-button').addEventListener('click',hint);
  $('erase-button').addEventListener('click',eraseSelected);
  $('undo-button').addEventListener('click',undo);
  $('auto-notes-button').addEventListener('click',autoNotes);
  $('new-button').addEventListener('click',()=>showModal('new'));
  $('daily-button').addEventListener('click',()=>switchMode(active==='daily'?'classic':'daily'));
  $('pause-button').addEventListener('click',()=>showModal('pause'));
  $('stats-button').addEventListener('click',()=>showModal('stats'));
  $('settings-button').addEventListener('click',()=>showModal('settings'));
  $('close-modal').addEventListener('click',closeModal);
  modalEl.addEventListener('click',e=>{if(e.target===modalEl)closeModal();});
  $('modal-content').addEventListener('click',e=>{
    const level=e.target.closest('[data-level]');
    if(level){
      const classic = active==='classic' ? state : hydrateGame(getStore(CLASSIC_KEY),'classic');
      if(classic&&!classic.complete&&classic.entries.some((v,i)=>!classic.puzzle[i]&&v!==0)&&
        !window.confirm('Replace your current regular puzzle? You can’t return to it.'))return;
      startGame(level.dataset.level,'classic');return;
    }
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='again'){if(active==='daily')switchMode('classic');else showModal('new');}
    if(action==='resume')closeModal();
    if(action==='export')exportBackup();
    if(action==='clear-stats')clearStats();
  });
  $('modal-content').addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-pref]')){
      const pref=el.dataset.pref;
      if(['highlightPeers','showMistakes','autoRemoveNotes','remainingCounts'].includes(pref)) {
        prefs[pref]=el.checked;setStore(PREFS_KEY,prefs);render();
      }
    } else if(el.matches('[data-theme]')){
      prefs.theme=el.value;setStore(PREFS_KEY,prefs);applyTheme();
    } else if(el.matches('#restore-file')) restoreBackup(el.files[0]);
  });
  document.addEventListener('keydown',e=>{
    if(!modalEl.hidden){if(e.key==='Escape')closeModal();return;}
    if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();undo();}return;}
    if(/^[1-9]$/.test(e.key)){e.preventDefault();enterNumber(Number(e.key));}
    else if(['Backspace','Delete','0'].includes(e.key)){e.preventDefault();eraseSelected();}
    else if(e.key.toLowerCase()==='n'){$('notes-button').click();}
    else if(e.key.startsWith('Arrow')){
      e.preventDefault();const i=state.selected<0?0:state.selected;
      const r=Math.floor(i/9),c=i%9;
      const target=e.key==='ArrowUp'?((r+8)%9)*9+c:e.key==='ArrowDown'?((r+1)%9)*9+c:
        e.key==='ArrowLeft'?r*9+(c+8)%9:r*9+(c+1)%9;
      selectCell(target);
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseClock();else resumeClock();});
  window.addEventListener('pagehide',pauseClock);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(prefs.theme==='system')applyTheme();});
  setInterval(updateTimer,500);
  applyTheme();
  state=restoreSlot(active);
  if(!state&&active==='daily'){active='classic';state=restoreSlot('classic');setStore(ACTIVE_KEY,active);}
  if(state){feedback=state.complete?'Puzzle completed!':'Welcome back!';render();resumeClock();}
  else startGame('Beginner','classic');

  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(reg=>{
        reg.update().catch(()=>{});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)reg.update().catch(()=>{});});
      }).catch(()=>{});
    });
    let hasController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(hasController)$('update-toast').hidden=false;
      hasController=true;
    });
    $('reload-button').addEventListener('click',()=>{pauseClock();window.location.reload();});
  }

  // Test-only read access: available when ?test=1, no mutation hooks in production.
  if(new URLSearchParams(location.search).has('test')) window.__SUDOKU_TEST__={countSolutions,generatePuzzle,validSolution,singlesRemaining,getState:()=>state,getStats:()=>stats};
})();
