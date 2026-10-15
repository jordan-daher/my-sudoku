/* Sudoku v3: ad-free, offline, accessible, and backward compatible with v1 and v2 saves. */
(() => {
  'use strict';

  // Retain the original storage keys so existing players do not lose their games or best times.
  const CLASSIC_KEY = 'just-sudoku-game-v1';
  const DAILY_KEY = 'just-sudoku-daily-v2';
  const ACTIVE_KEY = 'just-sudoku-active-v2';
  const STATS_KEY = 'just-sudoku-stats-v1';
  const PREFS_KEY = 'just-sudoku-prefs-v1';
  const DAILY_ARCHIVE_KEY = 'just-sudoku-daily-archive-v3';
  const LEVELS = {
    Beginner: { clues: 52, description: 'Learn the basics' },
    Easy:     { clues: 45, description: 'A gentle challenge' },
    Medium:   { clues: 37, description: 'Practice deductions' },
    Hard:     { clues: 30, description: 'More careful logic' },
    Expert:   { clues: 28, description: 'Pairs and advanced patterns' },
    Master:   { clues: 26, description: 'Deep multi-step reasoning' },
    Extreme:  { clues: 24, description: 'Maximum challenge' }
  };
  const FULL = 0x1ff;
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), digitsEl = $('digits'), modalEl = $('modal');
  const defaults = { showMistakes: true, highlightPeers: true, autoRemoveNotes: true, theme: 'system', remainingCounts: true, inputMode: 'quick', mistakeLimit: 0, liveNotes: false, celebrate: true };
  const getStore = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const setStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const validDigit = n => Number.isInteger(n) && n >= 0 && n <= 9;
  const safeNumber = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
  const boxIndex = (r,c) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
  const popCount = n => { let c = 0; for (; n; n &= n-1) c++; return c; };
  let prefs = { ...defaults, ...(getStore(PREFS_KEY) || {}) };
  if (!['system','light','dark'].includes(prefs.theme)) prefs.theme = 'system';
  if(!['classic','quick','quick-pencil'].includes(prefs.inputMode)) prefs.inputMode='quick';
  if(![0,3].includes(Number(prefs.mistakeLimit))) prefs.mistakeLimit=0;
  let dailyArchive = getStore(DAILY_ARCHIVE_KEY) || {};
  if(!dailyArchive || typeof dailyArchive !== 'object' || Array.isArray(dailyArchive)) dailyArchive={};
  let active = getStore(ACTIVE_KEY) === 'daily' ? 'daily' : 'classic';
  let stats = normalizeStats(getStore(STATS_KEY));
  let state = null, notesMode = false, quickDigit = 0, feedback = 'Choose a number or square';
  let calendarMonth = today().slice(0,7);
  let busy = false;
  let celebration = new Set(), celebrationTimeout = null;

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
      played: safeNumber(old.played), solved: safeNumber(old.solved), failed:safeNumber(old.failed), totalMs: safeNumber(old.totalMs),
      best, cleanBest, perLevel: levels, dailySolved: safeNumber(old.dailySolved),
      currentStreak: safeNumber(old.currentStreak), bestStreak: safeNumber(old.bestStreak),
      lastSolvedDay: typeof old.lastSolvedDay === 'string' ? old.lastSolvedDay : '',
      history: Array.isArray(old.history) ? old.history.slice(0, 500).filter(x => x && typeof x === 'object') : [],
      dailyDates: old.dailyDates && typeof old.dailyDates==='object' ? old.dailyDates : {}
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
  // Human-solvable deductions. The same named strategies power hints and difficulty estimates.
  const UNITS = Array.from({length:27},(_,unit)=>Array.from({length:9},(_,j)=>
    unit<9?unit*9+j : unit<18?j*9+unit-9 : (Math.floor((unit-18)/3)*3+Math.floor(j/3))*9+((unit-18)%3)*3+j%3));
  const unitName = u => u<9?`row ${u+1}`:u<18?`column ${u-8}`:`box ${u-17}`;
  const cellName = i => `R${Math.floor(i/9)+1}C${i%9+1}`;
  const bitDigit=bit=>32-Math.clz32(bit);
  function legalCandidates(grid){
    const masks = Array(81).fill(0);
    for(let i=0;i<81;i++) if(!grid[i]){
      let used=0;for(let j=0;j<81;j++) if(grid[j]&&isPeer(i,j)) used|=1<<(grid[j]-1);
      masks[i]=FULL&~used;
    }
    return masks;
  }
  // Returns a single explainable placement, or an elimination which enables later placements.
  function findTechnique(grid, marks=null){
    const cand=marks||legalCandidates(grid);
    for(let i=0;i<81;i++) if(!grid[i]&&popCount(cand[i])===1){
      const d=bitDigit(cand[i]);return {kind:'place',technique:'Naked single',rank:1,index:i,digit:d,
        reason:`${cellName(i)} can only be ${d}: the other numbers already appear in its row, column or box.`};
    }
    for(let u=0;u<27;u++) for(let d=1;d<=9;d++){
      const bit=1<<(d-1);if(UNITS[u].some(i=>grid[i]===d))continue;
      const cells=UNITS[u].filter(i=>!grid[i]&&(cand[i]&bit));
      if(cells.length===1)return {kind:'place',technique:'Hidden single',rank:1,index:cells[0],digit:d,
        reason:`In ${unitName(u)}, ${d} has only one possible square: ${cellName(cells[0])}.`};
    }
    // Locked candidates: candidates for a number in one box are confined to a row or column.
    for(let b=18;b<27;b++) for(let d=1;d<=9;d++){
      const bit=1<<(d-1),cells=UNITS[b].filter(i=>!grid[i]&&(cand[i]&bit));
      if(cells.length<2)continue;
      for(const dimension of ['row','column']){
        const key=i=>dimension==='row'?Math.floor(i/9):i%9;
        if(!cells.every(i=>key(i)===key(cells[0])))continue;
        const u=dimension==='row'?key(cells[0]):key(cells[0])+9;
        const targets=UNITS[u].filter(i=>!grid[i]&&!UNITS[b].includes(i)&&(cand[i]&bit));
        if(targets.length)return {kind:'eliminate',technique:'Locked candidates',rank:2,index:targets[0],digit:d,targets,
          reason:`In ${unitName(b)}, every possible ${d} lies in ${unitName(u)}. Remove ${d} from the other squares of ${unitName(u)}.`};
      }
    }
    // Naked pairs: two squares in a unit share the exact same two candidates.
    for(let u=0;u<27;u++){
      const pairs=UNITS[u].filter(i=>!grid[i]&&popCount(cand[i])===2);
      for(let a=0;a<pairs.length;a++)for(let b=a+1;b<pairs.length;b++){
        const x=pairs[a],y=pairs[b],mask=cand[x];if(cand[y]!==mask)continue;
        const targets=UNITS[u].filter(i=>i!==x&&i!==y&&!grid[i]&&(cand[i]&mask));
        if(targets.length)return {kind:'eliminate',technique:'Naked pair',rank:3,index:targets[0],mask,targets,
          reason:`${cellName(x)} and ${cellName(y)} share the same two candidates in ${unitName(u)}. Those numbers cannot go anywhere else in that unit.`};
      }
    }
    // Hidden pairs: two digits appear in exactly the same two squares within a unit.
    for(let u=0;u<27;u++){
      const digits=[];
      for(let d=1;d<=9;d++){
        if(UNITS[u].some(i=>grid[i]===d))continue;
        const cells=UNITS[u].filter(i=>!grid[i]&&(cand[i]&(1<<(d-1))));
        if(cells.length===2)digits.push({d,cells});
      }
      for(let a=0;a<digits.length;a++)for(let b=a+1;b<digits.length;b++){
        const x=digits[a],y=digits[b];if(x.cells[0]!==y.cells[0]||x.cells[1]!==y.cells[1])continue;
        const mask=(1<<(x.d-1))|(1<<(y.d-1));
        const targets=x.cells.filter(i=>cand[i]&~mask);
        if(targets.length)return {kind:'restrict',technique:'Hidden pair',rank:3,index:targets[0],mask,targets,
          reason:`In ${unitName(u)}, ${x.d} and ${y.d} can only fit in ${cellName(x.cells[0])} and ${cellName(x.cells[1])}. Remove other candidates from those squares.`};
      }
    }
    // X-Wing: same candidate in exactly two columns of two rows (and transpose).
    for(let d=1;d<=9;d++)for(let axis=0;axis<2;axis++){
      const bit=1<<(d-1),lines=[];
      for(let primary=0;primary<9;primary++){
        const cross=[];
        for(let secondary=0;secondary<9;secondary++){
          const i=axis===0?primary*9+secondary:secondary*9+primary;
          if(!grid[i]&&(cand[i]&bit))cross.push(secondary);
        }
        if(cross.length===2)lines.push({primary,cross});
      }
      for(let a=0;a<lines.length;a++)for(let b=a+1;b<lines.length;b++){
        const x=lines[a],y=lines[b];if(x.cross[0]!==y.cross[0]||x.cross[1]!==y.cross[1])continue;
        const targets=[];
        for(const secondary of x.cross)for(let p=0;p<9;p++){
          if(p===x.primary||p===y.primary)continue;
          const i=axis===0?p*9+secondary:secondary*9+p;
          if(!grid[i]&&(cand[i]&bit))targets.push(i);
        }
        if(targets.length)return {kind:'eliminate',technique:'X-Wing',rank:4,index:targets[0],digit:d,targets,
          reason:`The four corners in ${axis===0?'rows':'columns'} ${x.primary+1} and ${y.primary+1} form an X-Wing for ${d}. Remove ${d} from the intersecting ${axis===0?'columns':'rows'} outside those corners.`};
      }
    }
    return null;
  }
  function applyTechnique(grid,candidates,move){
    if(move.kind==='place'){
      grid[move.index]=move.digit;
      for(let j=0;j<81;j++)if(isPeer(j,move.index))candidates[j]&=~(1<<(move.digit-1));
      candidates[move.index]=0;
    } else if(move.kind==='restrict'){
      for(const i of move.targets)candidates[i]&=move.mask;
    } else {
      const mask=move.mask||1<<(move.digit-1);
      for(const i of move.targets)candidates[i]&=~mask;
    }
  }
  function gradePuzzle(puzzle){
    const grid=puzzle.slice(),candidates=legalCandidates(grid);
    let maxRank=0, steps=0, stalled=false;
    for(let i=0;i<400;i++){
      if(grid.every(Boolean))break;
      const step=findTechnique(grid,candidates);
      if(!step){stalled=true;break;}
      maxRank=Math.max(maxRank,step.rank);steps++;
      applyTechnique(grid,candidates,step);
      if(candidates.some((m,i)=>!grid[i]&&m===0)){stalled=true;break;}
    }
    return {rank:stalled?5:maxRank,steps,solved:grid.every(Boolean)};
  }
  function nextSmartHint(){
    // Wrong entries must be resolved before deduction; don't teach logic using an inconsistent grid.
    const wrong=state.entries.findIndex((v,i)=>v&&!state.puzzle[i]&&v!==state.solution[i]);
    if(wrong!==-1)return {kind:'wrong',technique:'Correct a mistake',index:wrong,
      reason:`${cellName(wrong)} has a conflicting entry. Erase it and recheck the row, column and box.`};
    const grid=state.entries.slice(),cand=legalCandidates(grid);
    for(let k=0;k<150;k++){
      const step=findTechnique(grid,cand);
      if(!step)break;
      if(step.kind==='place')return step;
      applyTechnique(grid,cand,step);
      const placement=findTechnique(grid,cand);
      if(placement&&placement.kind==='place')return {...placement,technique:`${step.technique} → ${placement.technique}`,reason:`${step.reason} Then ${placement.reason}`};
      // An elimination is a useful hint itself even if no immediate placement results.
      return step;
    }
    const i=state.selected>=0&&!state.puzzle[state.selected]&&state.entries[state.selected]!==state.solution[state.selected]
      ?state.selected:state.entries.findIndex((v,index)=>v!==state.solution[index]);
    return {kind:'reveal',technique:'Advanced step',index:i,
      reason:'No supported single, pair, locked candidate or X-Wing deduction is immediately available. You can keep solving or reveal one square.'};
  }
  function generatePuzzle(difficulty, seedText=null) {
    const random = seedText ? seededRandom('daily-sudoku-v2-'+seedText) : Math.random;
    const target = LEVELS[difficulty].clues;
    const high = ['Expert','Master','Extreme'].includes(difficulty);
    let best=null, bestScore=Infinity;
    const attempts = seedText ? 4 : (difficulty==='Extreme' ? 9 : difficulty==='Master' ? 10 : 11);
    for (let attempt=0;attempt<attempts;attempt++) {
      const solution=makeSolution(random), puzzle=solution.slice();
      let left=81;
      for(const i of shuffle(Array.from({length:81},(_,k)=>k),random)) {
        if(left<=target)break;
        const previous=puzzle[i]; puzzle[i]=0;
        if(countSolutions(puzzle)===1)left--;
        else puzzle[i]=previous;
      }
      const grade=gradePuzzle(puzzle);
      const targetRank={Beginner:1,Easy:1,Medium:2,Hard:2,Expert:3,Master:5,Extreme:5}[difficulty];
      const rankGap=grade.rank-targetRank;
      // Discourage easy puzzles in advanced tiers, and prohibit logic-heavy beginner puzzles.
      const skillPenalty = rankGap<0 ? -rankGap*(high?13:5) : rankGap*(['Beginner','Easy'].includes(difficulty)?13:6);
      const score = Math.max(0,left-target)*4 + skillPenalty;
      if(score<bestScore) { best={solution,puzzle,clues:left,grade:grade.rank}; bestScore=score; }
      if(left<=target && grade.rank===targetRank)break;
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
      future:Array.isArray(raw.future)?raw.future.slice(-100).filter(h=>h&&Array.isArray(h.entries)&&h.entries.length===81&&Array.isArray(h.notes)&&h.notes.length===81):[],
      complete:!!raw.complete,failed:!!raw.failed,clues:raw.puzzle.filter(Boolean).length,grade:safeNumber(raw.grade)
    };
  }
  function currentKey() { return active==='daily' ? DAILY_KEY : CLASSIC_KEY; }
  function saveGame() {
    if(!state)return;
    const saved={...state,elapsedMs:elapsedNow(),startedAt:null,running:false,history:state.history.slice(-100),future:state.future.slice(-100)};
    if(active==='daily'){
      dailyArchive[state.date]=saved;
      const sorted=Object.keys(dailyArchive).sort().reverse();for(const date of sorted.slice(90))delete dailyArchive[date];
      setStore(DAILY_ARCHIVE_KEY,dailyArchive);
      if(state.date===today())setStore(DAILY_KEY,saved);
    } else setStore(CLASSIC_KEY,saved);
  }
  function elapsedNow() {return state ? state.elapsedMs + (state.running?Math.max(0,Date.now()-state.startedAt):0) : 0;}
  function pauseClock() {
    if(!state||!state.running)return;
    state.elapsedMs=elapsedNow(); state.startedAt=null;state.running=false;saveGame();
  }
  function resumeClock() {
    if(!state||(state.complete||state.failed)||!modalEl.hidden||state.running||document.hidden)return;
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
    const value=prefs.inputMode!=='classic'&&quickDigit?quickDigit:selected>=0?state.entries[selected]:0;
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
      if(prefs.inputMode!=='classic'&&quickDigit&&state.notes[i].includes(quickDigit))button.classList.add('marked-note');
      if(prefs.showMistakes&&state.entries[i]&&!fixed&&state.entries[i]!==state.solution[i])button.classList.add('wrong');
      if(celebration.has(i))button.classList.add('unit-done');
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
      button.disabled=!!state.complete||!!state.failed || (correct===9&&prefs.inputMode!=='quick-pencil'&&!notesMode);
      if(prefs.inputMode!=='classic'&&quickDigit===n){button.classList.add('digit-selected');button.setAttribute('aria-pressed','true');}
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
    $('mistakes').textContent=`Mistakes: ${state.mistakes}${prefs.mistakeLimit ? '/'+prefs.mistakeLimit : ''}`;
    $('input-guide').textContent=prefs.inputMode==='quick-pencil'?'Quick Pencil · Select a digit, then tap squares to add or remove notes':prefs.inputMode==='quick'?'Quick Entry · Select a digit, then tap squares to enter it':'Classic · Tap a square, then tap a digit';
    for(const b of document.querySelectorAll('[data-input-mode]')){const yes=b.dataset.inputMode===prefs.inputMode;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));}
    $('hints').textContent=state.hints;
    $('notes-button').classList.toggle('active',prefs.inputMode==='quick-pencil'||notesMode);
    $('notes-button').setAttribute('aria-pressed',String(notesMode));
    $('undo-button').disabled=state.complete||state.failed||!state.history.length;
    $('redo-button').disabled=state.complete||state.failed||!state.future.length;
    $('erase-button').disabled=state.complete||state.failed;
    $('hint-button').disabled=state.complete||state.failed;
    $('auto-notes-button').disabled=state.complete||state.failed;
    $('pause-button').disabled=state.complete||state.failed;
    $('status').textContent=feedback;
    renderBoard();renderDigits();updateTimer();
  }
  function makeState(difficulty,slot,date,puzzle,solution) {
    return { puzzle,solution,entries:puzzle.slice(),notes:Array.from({length:81},()=>[]),
      selected:-1,difficulty,slot,date:date||'',elapsedMs:0,startedAt:null,running:false,
      mistakes:0,hints:0,history:[],future:[],complete:false,failed:false,clues:puzzle.filter(Boolean).length,grade:gradePuzzle(puzzle).rank };
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
      state=makeState(difficulty,slot,date,result.puzzle,result.solution);state.grade=result.grade;
      setStore(ACTIVE_KEY,active);
      recordStart(difficulty);
      notesMode=false;quickDigit=0;feedback='Choose a number or square';
      saveGame();modalEl.hidden=true;render();resumeClock();
    } catch(error) {
      console.error('Sudoku puzzle generation failed',error);
      active=lastSlot;state=lastGame;
      modalEl.hidden=true;message('Could not create a puzzle. Please try again.');
      resumeClock();
    } finally { busy=false;$('close-modal').disabled=false; }
  }
  function restoreSlot(slot,date=today()) {
    const raw=slot==='daily'?(dailyArchive[date]||(getStore(DAILY_KEY)?.date===date?getStore(DAILY_KEY):null)):getStore(CLASSIC_KEY);
    return hydrateGame(raw,slot);
  }
  async function switchMode(slot,date=today()) {
    if(busy)return;
    if(slot===active && !(slot==='daily'&&state.date!==date))return;
    pauseClock();saveGame();
    const restored=restoreSlot(slot,date);
    if(restored){active=slot;setStore(ACTIVE_KEY,active);state=restored;notesMode=false;quickDigit=0;feedback=state.complete?'Challenge complete!':'Welcome back!';modalEl.hidden=true;render();resumeClock();}
      else await startGame(slot==='daily'?'Medium':'Easy',slot,slot==='daily'?date:'');
  }
  function historySnapshot() {
    state.future=[];
    state.history.push({entries:state.entries.slice(),notes:state.notes.map(a=>a.slice()),selected:state.selected});
    if(state.history.length>100)state.history.shift();
  }
  function removePeerNotes(index,digit) {
    if(!prefs.autoRemoveNotes)return;
    for(let i=0;i<81;i++) if(isPeer(i,index))state.notes[i]=state.notes[i].filter(n=>n!==digit);
  }
  function selectedEditable() {
    if(state.complete||state.failed)return false;
    if(state.selected<0){message('Tap a square first');return false;}
    if(state.puzzle[state.selected]){message('Given numbers cannot be changed');return false;}
    return true;
  }
  function isComplete() {return state.entries.every((v,i)=>v===state.solution[i]);}
  function flashCompletedUnits(i){
    if(!prefs.celebrate)return;
    const units=[UNITS[Math.floor(i/9)],UNITS[9+i%9],UNITS[18+boxIndex(Math.floor(i/9),i%9)]];
    const filled=units.filter(unit=>unit.every(j=>state.entries[j]===state.solution[j]));
    if(!filled.length)return;
    for(const unit of filled)for(const j of unit)celebration.add(j);
    clearTimeout(celebrationTimeout);
    celebrationTimeout=setTimeout(()=>{celebration.clear();if(state)renderBoard();},650);
  }
  function enterNumber(n) {
    if(!selectedEditable()||!Number.isInteger(n)||n<1||n>9)return;
    const i=state.selected;
    if(notesMode||prefs.inputMode==='quick-pencil'){
      if(state.entries[i]){message('Erase that number to add notes');return;}
      historySnapshot();
      const existing=state.notes[i];
      state.notes[i]=existing.includes(n)?existing.filter(x=>x!==n):[...existing,n].sort((a,b)=>a-b);
      message('Pencil notes updated');
    } else {
      if(state.entries[i]===n)return;
      historySnapshot();state.entries[i]=n;state.notes[i]=[];
      if(n!==state.solution[i]){state.mistakes++;message('Try another number');}
      else {removePeerNotes(i,n);flashCompletedUnits(i);message('Keep going!');}
    }
    if(prefs.liveNotes&&prefs.inputMode!=='quick-pencil'&&!notesMode)refreshLiveNotes();
    if(prefs.mistakeLimit&&state.mistakes>=prefs.mistakeLimit)failGame();
    else if(isComplete()) finishGame();
    else {render();saveGame();}
  }
  function eraseSelected(){
    if(!selectedEditable())return;
    const i=state.selected;
    if(state.entries[i]===0&&!state.notes[i].length)return;
    historySnapshot();state.entries[i]=0;state.notes[i]=[];
    if(prefs.liveNotes)refreshLiveNotes();
    message('Square cleared');render();saveGame();
  }
  function undo() {
    if(state.complete||!state.history.length)return;
    state.future.push({entries:state.entries.slice(),notes:state.notes.map(a=>a.slice()),selected:state.selected});
    if(state.future.length>100)state.future.shift();
    const previous=state.history.pop();
    state.entries=previous.entries;state.notes=previous.notes;state.selected=previous.selected;
    // Intentionally do not refund hints or mistakes when undo is used.
    message('Last move undone');render();saveGame();
  }
  function redo(){
    if(state.complete||state.failed||!state.future.length)return;
    state.history.push({entries:state.entries.slice(),notes:state.notes.map(a=>a.slice()),selected:state.selected});
    const next=state.future.pop();state.entries=next.entries;state.notes=next.notes;state.selected=next.selected;
    message('Move restored');render();saveGame();
  }
  function hint(){
    if(state.complete||state.failed)return;
    const step=nextSmartHint();
    if(step.index<0)return;
    state.selected=step.index;
    render();
    showModal('hint');
    $('modal-content').innerHTML=`<div class="hint-box"><div class="hint-category">${step.technique}</div><p>${step.reason}</p>
       <small>Highlighted: ${cellName(step.index)}. Read the explanation and try it yourself, or reveal the square.</small></div>
       <button class="primary" data-action="reveal-hint">Reveal ${cellName(step.index)} (+1 hint)</button>
       <button class="secondary wide" data-action="resume">I'll solve it myself</button>`;
  }
  function revealHint(){
    if(state.complete||state.failed)return;
    let i=state.selected;
    if(i<0||state.puzzle[i]||state.entries[i]===state.solution[i])i=state.entries.findIndex((v,index)=>v!==state.solution[index]);
    if(i<0)return;
    modalEl.hidden=true;
    historySnapshot();state.selected=i;state.entries[i]=state.solution[i];state.notes[i]=[];
    state.hints++;removePeerNotes(i,state.solution[i]);
    if(prefs.liveNotes)refreshLiveNotes();
    message('A square was revealed');
    if(isComplete())finishGame();else{render();saveGame();resumeClock();}
  }
  function refreshLiveNotes(){
    if(!prefs.liveNotes)return;
    const masks=legalCandidates(state.entries);
    for(let i=0;i<81;i++){
      state.notes[i]=!state.entries[i]?Array.from({length:9},(_,j)=>j+1).filter(n=>masks[i]&(1<<(n-1))):[];
    }
  }
  function setInputMode(mode){
    if(!['classic','quick','quick-pencil'].includes(mode))return;
    prefs.inputMode=mode;notesMode=false;quickDigit=0;
    setStore(PREFS_KEY,prefs);
    message(mode==='quick-pencil'?'Quick Pencil on · Choose a digit first':mode==='quick'?'Quick Entry on · Choose a digit first':'Classic controls on');render();
  }
  function failGame(){
    if(state.failed)return;
    pauseClock();state.failed=true;stats.failed++;
    stats.history.unshift({difficulty:state.difficulty,mode:active,date:today(),elapsedMs:state.elapsedMs,mistakes:state.mistakes,hints:state.hints,failed:true});
    stats.history=stats.history.slice(0,500);setStore(STATS_KEY,stats);
    message('Mistake limit reached');saveGame();render();showModal('failed');
  }
  function autoNotes() {
    if(state.complete||state.failed)return;
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
    if(active==='daily'){
      if(!stats.dailyDates[state.date]){stats.dailySolved++;stats.dailyDates[state.date]=true;}
    }
    const day=today();updateStreak(day);
    stats.history.unshift({difficulty:level,mode:active,date:day,elapsedMs:t,mistakes:state.mistakes,hints:state.hints});
    stats.history=stats.history.slice(0,500);
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
    const recent=stats.history.filter(h=>!h.failed).slice(0,7).map(h=>{
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
    </div><p class="stats-caption">Failed runs: <strong>${stats.failed}</strong> · Daily challenges solved: <strong>${stats.dailySolved}</strong> · A streak counts days on which you finish at least one puzzle.</p>
    <p class="stats-caption"><strong>By difficulty</strong> · Completed / best / average</p>
    <table class="records stats-table"><thead><tr><th>Level</th><th>Solved</th><th>Best</th><th>Avg.</th></tr></thead><tbody>${bestRows}</tbody></table>
    <p class="stats-caption"><strong>Recent completions</strong></p>
    ${recent?`<table class="records stats-table"><thead><tr><th>Level</th><th>Time</th><th>Hints</th><th>Errors</th></tr></thead><tbody>${recent}</tbody></table>`:'<p>No completed puzzles yet. Finish one to see your history.</p>'}
    ${achievementsMarkup()}
    <div class="helper-note">Records are stored privately on this device. Old personal bests are preserved from version 1. A clean solve means no hints or mistakes.</div>`;
  }
  function achievementsMarkup(){
    const monthlyCounts={};
    for(const day of Object.keys(stats.dailyDates))if(stats.dailyDates[day])monthlyCounts[day.slice(0,7)]=(monthlyCounts[day.slice(0,7)]||0)+1;
    const monthlyChampion=Object.values(monthlyCounts).some(n=>n>=20);
    const clean=Object.values(stats.perLevel).reduce((n,s)=>n+s.clean,0);
    const awards=[
      [stats.solved>=1,'First win','Complete a puzzle'],
      [stats.solved>=10,'Ten down','Solve 10 puzzles'],
      [stats.solved>=50,'Half century','Solve 50 puzzles'],
      [clean>=1,'Flawless','Solve without mistakes or hints'],
      [stats.dailySolved>=7,'Daily devotee','Finish 7 daily challenges'],
      [monthlyChampion,'Monthly champion','Finish 20 challenges in one month'],
      [stats.bestStreak>=7,'One week streak','Solve puzzles on 7 consecutive days'],
      [(stats.perLevel.Master.solved+stats.perLevel.Extreme.solved)>=1,'Puzzle master','Finish a Master or Extreme puzzle']
    ];
    return `<p class="stats-caption"><strong>Achievements</strong> · ${awards.filter(x=>x[0]).length}/${awards.length} earned</p>
      <div class="achievements">${awards.map(([earned,name,desc])=>`<div class="achievement ${earned?'unlocked':''}"><b>${earned?'✓':'○'} ${name}</b><small>${desc}</small></div>`).join('')}</div>`;
  }
  function calendarMarkup(){
    const [y,m]=calendarMonth.split('-').map(Number),first=new Date(y,m-1,1),days=new Date(y,m,0).getDate();
    const offset=(first.getDay()+6)%7,now=today();
    const monthWins=Object.keys(stats.dailyDates).filter(d=>d.startsWith(calendarMonth)&&stats.dailyDates[d]).length;
    let cells='';
    for(let i=0;i<offset;i++)cells+='<span class="calendar-blank"></span>';
    for(let d=1;d<=days;d++){
      const key=`${calendarMonth}-${String(d).padStart(2,'0')}`;
      const done=!!stats.dailyDates[key]||stats.history.some(h=>h.mode==='daily'&&h.date===key&&!h.failed);
      const future=key>now,selected=active==='daily'&&state.date===key;
      cells+=`<button class="calendar-date ${done?'done':''} ${key===now?'today':''} ${selected?'chosen':''}" data-day="${key}" ${future?'disabled':''} aria-label="${formatDate(key)}${done?', completed':''}">${d}${done?'<span class="date-check">✓</span>':''}</button>`;
    }
    const monthName=first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    return `<div class="calendar-title"><button class="secondary tiny" data-action="month-back" aria-label="Previous month">‹</button><strong>${monthName}</strong><button class="secondary tiny" data-action="month-next" ${calendarMonth>=now.slice(0,7)?'disabled':''} aria-label="Next month">›</button></div>
      <div class="calendar-grid">${['M','T','W','T','F','S','S'].map(x=>`<b>${x}</b>`).join('')}${cells}</div>
      <div class="month-award"><strong>${monthWins>=20?'★ Monthly champion unlocked':`${monthWins}/20 monthly challenge award`}</strong><span>${monthWins>=20?'Your 20-day challenge badge is earned for this month.':'Complete 20 daily challenges during this month to earn an achievement.'}</span></div>
      <p class="helper-note">Tap any past date to play that day's challenge. A check mark means you've completed it. Your daily puzzles are saved separately.</p>`;
  }
  function changeMonth(delta){
    const [y,m]=calendarMonth.split('-').map(Number),date=new Date(y,m-1+delta,1);
    calendarMonth=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    showModal('calendar');
  }
  function showModal(type,newBest=false){
    if(busy)return;
    pauseClock();const body=$('modal-content');
    if(type==='new'){
      $('dialog-title').textContent='New Game';
      body.innerHTML=`<p>Seven levels, graded by clue count and the solving techniques required. All puzzles have one unique solution; difficulty is an estimate.</p><div class="level-list">${Object.entries(LEVELS).map(([name,config])=>
        `<button type="button" class="level-btn" data-level="${name}"><strong>${name}</strong><span>${config.description} · ~${config.clues} clues</span></button>`).join('')}</div>`;
    } else if(type==='calendar'){
      $('dialog-title').textContent='Daily challenges';body.innerHTML=calendarMarkup();
    } else if(type==='stats'){
      $('dialog-title').textContent='Statistics';body.innerHTML=statsMarkup();
    } else if(type==='settings'){
      $('dialog-title').textContent='Settings';
      body.innerHTML=`<label class="setting"><span>Three-mistake limit</span><input data-pref="mistakeLimit" type="checkbox" ${prefs.mistakeLimit===3?'checked':''}></label>
      <label class="setting"><span>Celebrate completed rows and boxes</span><input data-pref="celebrate" type="checkbox" ${prefs.celebrate?'checked':''}></label>
      <label class="setting"><span>Live automatic notes</span><input data-pref="liveNotes" type="checkbox" ${prefs.liveNotes?'checked':''}></label>
      <label class="setting"><span>Highlight related squares</span><input data-pref="highlightPeers" type="checkbox" ${prefs.highlightPeers?'checked':''}></label>
      <label class="setting"><span>Show incorrect entries</span><input data-pref="showMistakes" type="checkbox" ${prefs.showMistakes?'checked':''}></label>
      <label class="setting"><span>Clear matching notes automatically</span><input data-pref="autoRemoveNotes" type="checkbox" ${prefs.autoRemoveNotes?'checked':''}></label>
      <label class="setting"><span>Show remaining digit counts</span><input data-pref="remainingCounts" type="checkbox" ${prefs.remainingCounts?'checked':''}></label>
      <label class="setting"><span>Appearance</span><select class="option-select" data-theme><option value="system" ${prefs.theme==='system'?'selected':''}>Match phone</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option></select></label>
      <p class="stats-caption"><strong>Backup and restore</strong></p>
      <div class="button-row"><button class="secondary" data-action="export">Export backup</button></div>
      <label class="file-upload">Restore from backup<input type="file" id="restore-file" accept=".json,application/json"></label>
      <div class="button-row"><button class="secondary danger" data-action="clear-stats">Reset statistics</button></div>
      <div class="helper-note"><strong>Quick controls:</strong> Quick Entry fills large numbers. Quick Pencil adds small candidate notes. In either mode, tap a digit first, then as many squares as you like. Classic keeps the original cell-first controls.</div>
      <div class="helper-note">Sudoku v3 · Everything works offline. Game saves and statistics are private to this device. Export a backup before clearing Safari website data or deleting the app.</div>`;
    } else if(type==='won'){
      $('dialog-title').textContent='Puzzle solved!';
      body.innerHTML=`<div class="completed-badge">✓</div><p class="win-title">Great work!</p>
      <p class="win-desc">${active==='daily'?'Daily Challenge · ':''}${state.difficulty} · ${formatTime(state.elapsedMs)}<br>${state.mistakes} mistakes · ${state.hints} hints${newBest?'<br><strong style="color:#409de7">New personal best!</strong>':''}</p>
      <button class="primary" data-action="again">${active==='daily'?'Play a regular game':'Play another puzzle'}</button>`;
    } else if(type==='hint'){
      $('dialog-title').textContent='Logic hint';body.innerHTML='<p>Find the next logical move.</p>';
    } else if(type==='failed'){
      $('dialog-title').textContent='Game over';
      body.innerHTML='<p>You reached the optional three-mistake limit. Switch it off in Settings for relaxed, unlimited play.</p><button class="primary" data-action="again">Start a new puzzle</button>';
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
    state.selected=i;
    if(prefs.inputMode!=='classic'&&quickDigit&&!state.puzzle[i]&&!state.complete&&!state.failed){enterNumber(quickDigit);return;}
    feedback=state.puzzle[i]?'Given number':prefs.inputMode==='classic'?'Choose a digit below':'Select a digit to fill this square';
    renderBoard();$('status').textContent=feedback;saveGame();
  }
  function exportBackup() {
    saveGame();
    const data={format:'just-sudoku-backup',version:3,created:new Date().toISOString(),
      classic:getStore(CLASSIC_KEY),daily:getStore(DAILY_KEY),dailyArchive,active,prefs,stats};
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
      if(backup.format!=='just-sudoku-backup'||![2,3].includes(backup.version)||
        !backup.stats||typeof backup.stats!=='object'||!backup.prefs||typeof backup.prefs!=='object')throw new Error('Not a valid Sudoku backup.');
      if(backup.classic&&!hydrateGame(backup.classic,'classic'))throw new Error('Classic game in backup is invalid.');
      if(backup.daily&&!hydrateGame(backup.daily,'daily'))throw new Error('Daily game in backup is invalid.');
      if(!window.confirm('Replace your local Sudoku progress and statistics with this backup?'))return;
      pauseClock();
      if(backup.classic)setStore(CLASSIC_KEY,backup.classic);else{try{localStorage.removeItem(CLASSIC_KEY);}catch{}}
      if(backup.daily)setStore(DAILY_KEY,backup.daily);else{try{localStorage.removeItem(DAILY_KEY);}catch{}}
      dailyArchive=backup.version===3&&backup.dailyArchive&&typeof backup.dailyArchive==='object'?backup.dailyArchive:{};
      if(backup.daily&&backup.daily.date)dailyArchive[backup.daily.date]=backup.daily;
      for(const [key,item] of Object.entries(dailyArchive))if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!hydrateGame(item,'daily'))delete dailyArchive[key];
      setStore(DAILY_ARCHIVE_KEY,dailyArchive);
      stats=normalizeStats(backup.stats);setStore(STATS_KEY,stats);
      prefs={...defaults,...backup.prefs};if(!['system','dark','light'].includes(prefs.theme))prefs.theme='system';
      setStore(PREFS_KEY,prefs);applyTheme();
      active=backup.active==='daily'?'daily':'classic';setStore(ACTIVE_KEY,active);
      state=restoreSlot(active)||restoreSlot('classic')||restoreSlot('daily');
      if(state){active=state.slot;setStore(ACTIVE_KEY,active);}
      notesMode=false;quickDigit=0;modalEl.hidden=true;
      if(state){feedback='Backup restored';render();resumeClock();}else await startGame('Beginner');
    } catch(err) {window.alert(`Could not restore backup: ${err.message}`);}
  }
  function clearStats() {
    if(!window.confirm('Delete all local statistics and personal bests? Your current Sudoku puzzle will stay.'))return;
    stats=normalizeStats(null);setStore(STATS_KEY,stats);showModal('stats');
  }

  boardEl.addEventListener('click',e=>{const el=e.target.closest('.cell');if(el)selectCell(Number(el.dataset.index));});
  digitsEl.addEventListener('click',e=>{
    const el=e.target.closest('.digit');if(!el||state.complete||state.failed)return;
    const n=Number(el.dataset.number);
    if(prefs.inputMode==='classic'){enterNumber(n);return;}
    quickDigit=n;
    message(prefs.inputMode==='quick-pencil'?`Pencil ${n} · Tap squares to mark`:`Number ${n} · Tap a square to fill`);render();
  });
  document.querySelectorAll('[data-input-mode]').forEach(b=>b.addEventListener('click',()=>setInputMode(b.dataset.inputMode)));
  $('notes-button').addEventListener('click',()=>{if(state.complete||state.failed)return;
    if(prefs.inputMode!=='classic'){setInputMode(prefs.inputMode==='quick-pencil'?'quick':'quick-pencil');return;}
    notesMode=!notesMode;message(notesMode?'Pencil notes on':'Pencil notes off');render();});
  $('hint-button').addEventListener('click',hint);
  $('erase-button').addEventListener('click',eraseSelected);
  $('undo-button').addEventListener('click',undo);
  $('redo-button').addEventListener('click',redo);
  $('auto-notes-button').addEventListener('click',autoNotes);
  $('new-button').addEventListener('click',()=>showModal('new'));
  $('daily-button').addEventListener('click',()=>{calendarMonth=today().slice(0,7);showModal('calendar');});
  $('pause-button').addEventListener('click',()=>showModal('pause'));
  $('stats-button').addEventListener('click',()=>showModal('stats'));
  $('settings-button').addEventListener('click',()=>showModal('settings'));
  $('close-modal').addEventListener('click',closeModal);
  modalEl.addEventListener('click',e=>{if(e.target===modalEl)closeModal();});
  $('modal-content').addEventListener('click',e=>{
    const level=e.target.closest('[data-level]');
    const chosenDay=e.target.closest('[data-day]')?.dataset.day;
    if(chosenDay&&chosenDay<=today()){closeModal();switchMode('daily',chosenDay);return;}
    if(level){
      const classic = active==='classic' ? state : hydrateGame(getStore(CLASSIC_KEY),'classic');
      if(classic&&!classic.complete&&!classic.failed&&classic.entries.some((v,i)=>!classic.puzzle[i]&&v!==0)&&
        !window.confirm('Replace your current regular puzzle? You can’t return to it.'))return;
      startGame(level.dataset.level,'classic');return;
    }
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='again'){if(active==='daily')switchMode('classic');else showModal('new');}
    if(action==='resume')closeModal();
    if(action==='reveal-hint')revealHint();
    if(action==='month-back')changeMonth(-1);
    if(action==='month-next'&&calendarMonth<today().slice(0,7))changeMonth(1);
    if(action==='export')exportBackup();
    if(action==='clear-stats')clearStats();
  });
  $('modal-content').addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-pref]')){
      const pref=el.dataset.pref;
      if(['highlightPeers','showMistakes','autoRemoveNotes','remainingCounts','liveNotes','mistakeLimit','celebrate'].includes(pref)) {
        if(pref==='mistakeLimit'){prefs.mistakeLimit=el.checked?3:0;setStore(PREFS_KEY,prefs);render();return;}
        prefs[pref]=el.checked;setStore(PREFS_KEY,prefs);if(pref==='liveNotes'&&el.checked){historySnapshot();refreshLiveNotes();saveGame();}render();
      }
    } else if(el.matches('[data-theme]')){
      prefs.theme=el.value;setStore(PREFS_KEY,prefs);applyTheme();
    } else if(el.matches('#restore-file')) restoreBackup(el.files[0]);
  });
  document.addEventListener('keydown',e=>{
    if(!modalEl.hidden){if(e.key==='Escape')closeModal();return;}
    if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}else if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}return;}
    if(/^[1-9]$/.test(e.key)){e.preventDefault();if(prefs.inputMode!=='classic'){quickDigit=Number(e.key);render();}else enterNumber(Number(e.key));}
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
  if(new URLSearchParams(location.search).has('test')) window.__SUDOKU_TEST__={countSolutions,generatePuzzle,gradePuzzle,validSolution,singlesRemaining,findTechnique,nextSmartHint,getState:()=>state,getStats:()=>stats,getPrefs:()=>prefs};
})();
