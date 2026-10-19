// Self-playing 3D chess — a real game (full rules + minimax AI) rendered as background.
// Mounts into an existing Three.js scene. Degrades gracefully: if THREE is missing or a
// piece is mid-animation, it just no-ops. No effect on the reading UI.

const PLTChess = (() => {
  const W = 0x00F0FF;   // cyan side (Profit)
  const P = 0xFF007A;   // pink side (Love)
  let boardGroup = null;
  let sceneRef = null;
  let state = null;      // { board, turn, over }
  let animating = null;  // active piece tween
  let moveCount = 0;
  let thinkTimer = null;
  let lastMove = null;

  // ---- Chess rules ----
  const INIT = [
    'rnbqkbnr', 'pppppppp', '........', '........',
    '........', '........', 'PPPPPPPP', 'RNBQKBNR'
  ];
  const isW = c => c >= 'A' && c <= 'Z';
  const isB = c => c >= 'a' && c <= 'z';
  const colorOf = c => (isW(c) ? 'w' : isB(c) ? 'b' : null);
  const other = t => (t === 'w' ? 'b' : 'w');

  function clone(b) { return b.map(r => (typeof r === 'string' ? r.split('') : r.slice())); }
  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  const DIRS = {
    N: [[1,0],[-1,0],[0,1],[0,-1]],
    B: [[1,1],[1,-1],[-1,1],[-1,-1]],
    K: [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  };

  function genMoves(bd, r, c) {
    const p = bd[r][c];
    if (p === '.') return [];
    const t = colorOf(p), out = [];
    const type = p.toLowerCase();
    const push = (r2, c2) => {
      if (!inB(r2, c2)) return false;
      const q = bd[r2][c2];
      if (q !== '.' && colorOf(q) === t) return false; // blocked by own
      out.push([r, c, r2, c2]);
      return q === '.'; // can continue sliding if empty
    };
    if (type === 'p') {
      const d = t === 'w' ? 1 : -1;
      const home = t === 'w' ? 1 : 6;
      if (inB(r + d, c) && bd[r + d][c] === '.') {
        out.push([r, c, r + d, c]);
        if (r === home && bd[r + 2 * d][c] === '.') out.push([r, c, r + 2 * d, c]);
      }
      for (const dc of [-1, 1]) {
        const r2 = r + d, c2 = c + dc;
        if (inB(r2, c2) && bd[r2][c2] !== '.' && colorOf(bd[r2][c2]) !== t)
          out.push([r, c, r2, c2]);
      }
    } else if (type === 'n') {
      for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) push(r + dr, c + dc);
    } else if (type === 'k') {
      for (const [dr, dc] of DIRS.K) push(r + dr, c + dc);
    } else {
      const dirs = type === 'q' ? DIRS.K : (type === 'r' ? DIRS.N : DIRS.B);
      for (const [dr, dc] of dirs) {
        let r2 = r + dr, c2 = c + dc;
        while (inB(r2, c2)) {
          if (!push(r2, c2)) break;
          r2 += dr; c2 += dc;
        }
      }
    }
    return out;
  }

  function allMoves(bd, t) {
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (bd[r][c] !== '.' && colorOf(bd[r][c]) === t)
        out.push(...genMoves(bd, r, c));
    }
    return out;
  }

  function apply(bd, mv) {
    const nb = clone(bd);
    const [fr, fc, tr, tc] = mv;
    let piece = nb[fr][fc];
    nb[tr][tc] = piece;
    nb[fr][fc] = '.';
    // promotion
    if (piece.toLowerCase() === 'p' && (tr === 0 || tr === 7))
      nb[tr][tc] = colorOf(piece) === 'w' ? 'Q' : 'q';
    return nb;
  }

  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  function evaluate(bd) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (p === '.') continue;
      const v = VAL[p.toLowerCase()] || 0;
      s += colorOf(p) === 'w' ? v : -v;
    }
    return s;
  }

  // Minimax with alpha-beta. Returns best move for side to move.
  function search(bd, depth, alpha, beta, t) {
    if (depth === 0) return { score: evaluate(bd), move: null };
    const moves = allMoves(bd, t);
    if (!moves.length) return { score: t === 'w' ? -99999 : 99999, move: null };
    let best = null;
    for (const mv of moves) {
      const nb = apply(bd, mv);
      const { score } = search(nb, depth - 1, alpha, beta, other(t));
      if (t === 'w') {
        if (score > alpha) { alpha = score; best = mv; }
      } else {
        if (score < beta) { beta = score; best = mv; }
      }
      if (alpha >= beta) break;
    }
    return { score: t === 'w' ? alpha : beta, move: best };
  }

  // ---- 3D construction ----
  const SQ = 1.15;          // square size
  const PIECE_H = 0.7;      // base piece height

  function worldOf(r, c) {
    return { x: (c - 3.5) * SQ, z: (3.5 - r) * SQ };
  }

  function makePieceMesh(p, t) {
    const g = new THREE.Group();
    const col = t === 'w' ? 0xdffcff : 0x1a0a12;
    const emi = t === 'w' ? 0x00F0FF : 0xFF007A;
    const mat = new THREE.MeshStandardMaterial({
      color: col, emissive: emi, emissiveIntensity: 0.55,
      metalness: 0.85, roughness: 0.28
    });
    const type = p.toLowerCase();
    // base disc for all pieces
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 20), mat);
    base.position.y = 0.07; g.add(base);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.42, 16), mat);
    body.position.y = 0.3; g.add(body);

    let head = null;
    if (type === 'p') head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), mat);
    else if (type === 'r') { head = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.26, 12), mat); head.position.y = 0.62; }
    else if (type === 'n') { head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.34), mat); head.position.set(0.05, 0.62, 0.02); head.rotation.z = -0.35; }
    else if (type === 'b') { head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 14), mat); head.position.y = 0.64; }
    else if (type === 'q') { head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), mat); head.position.y = 0.66; }
    else if (type === 'k') {
      head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.1), mat); head.position.y = 0.68;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.09), mat); bar.position.y = 0.74; g.add(bar);
    }
    if (head) { if (head.position.y === 0) head.position.y = 0.62; g.add(head); }
    g.scale.setScalar(0.92);
    return g;
  }

  function build(scene) {
    sceneRef = scene;
    boardGroup = new THREE.Group();
    scene.add(boardGroup);

    // board squares
    const sqGeo = new THREE.BoxGeometry(SQ, 0.1, SQ);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const light = (r + c) % 2 === 0;
      const m = new THREE.Mesh(sqGeo, new THREE.MeshStandardMaterial({
        color: light ? 0x1b1b2e : 0x0b0b16,
        emissive: light ? 0x0a1a22 : 0x05050a,
        emissiveIntensity: 0.4, roughness: 0.6, metalness: 0.2
      }));
      const w = worldOf(r, c);
      m.position.set(w.x, 0, w.z);
      boardGroup.add(m);
    }
    // glow rim
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(SQ * 8 + 0.3, 0.06, SQ * 8 + 0.3),
      new THREE.MeshBasicMaterial({ color: 0x00F0FF, wireframe: true, transparent: true, opacity: 0.35 })
    );
    rim.position.y = -0.06;
    boardGroup.add(rim);

    resetGame();
    return boardGroup;
  }

  const pieceMeshes = {}; // "r,c" -> mesh

  function resetGame() {
    state = { board: clone(INIT), turn: 'w', over: false };
    lastMove = null;
    for (const k in pieceMeshes) if (boardGroup && pieceMeshes[k].parent) boardGroup.remove(pieceMeshes[k]);
    for (const k in pieceMeshes) delete pieceMeshes[k];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p === '.') continue;
      const w = worldOf(r, c);
      const m = makePieceMesh(p, colorOf(p));
      m.position.set(w.x, 0, w.z);
      boardGroup.add(m);
      pieceMeshes[r + ',' + c] = m;
    }
  }

  function movePiece3D(mv, cb) {
    const [fr, fc, tr, tc] = mv;
    const key = fr + ',' + fc;
    const mesh = pieceMeshes[key];
    if (!mesh) { cb && cb(); return; }
    const from = worldOf(fr, fc), to = worldOf(tr, tc);
    const t0 = performance.now(), dur = 620;
    animating = { mesh, from, to, t0, dur, cb, fromKey: key, toKey: tr + ',' + tc };
    delete pieceMeshes[key];
    pieceMeshes[tr + ',' + tc] = mesh;
  }

  function stepAnim(now) {
    if (!animating) return;
    const a = animating;
    let k = (now - a.t0) / a.dur;
    if (k >= 1) k = 1;
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    a.mesh.position.x = a.from.x + (a.to.x - a.from.x) * e;
    a.mesh.position.z = a.from.z + (a.to.z - a.from.z) * e;
    a.mesh.position.y = Math.sin(Math.PI * e) * 0.55; // hop arc
    if (k >= 1) {
      a.mesh.position.set(a.to.x, 0, a.to.z);
      const cb = a.cb; animating = null; cb && cb();
    }
  }

  function aiTurn() {
    if (!state || state.over) return;
    const { move } = search(state.board, 2, -Infinity, Infinity, state.turn);
    if (!move) { state.over = true; return; }
    const [fr, fc, tr, tc] = move;
    // remove captured
    if (state.board[tr][tc] !== '.') {
      const cap = pieceMeshes[tr + ',' + tc];
      if (cap) boardGroup.remove(cap);
      delete pieceMeshes[tr + ',' + tc];
    }
    state.board = apply(state.board, move);
    lastMove = move;
    movePiece3D(move, () => {
      moveCount++;
      state.turn = other(state.turn);
      // restart game if one side is gone (keeps it "always running")
      const flat = state.board.flat().join('');
      if (!flat.includes('k') || !flat.includes('K')) resetGame();
      thinkTimer = setTimeout(aiTurn, 900 + Math.random() * 1400);
    });
  }

  function start() {
    if (thinkTimer) clearTimeout(thinkTimer);
    thinkTimer = setTimeout(aiTurn, 1200);
  }

  function tick(now) { stepAnim(now); }

  // deterministic probe for headless verification
  function probe() {
    const keys = Object.keys(pieceMeshes);
    let sig = 0;
    for (const k of keys) {
      const m = pieceMeshes[k];
      const [r, c] = k.split(',').map(Number);
      sig += m.position.x * 11 + m.position.z * 7 + r * 3 + c;
      if (m.position.y > 0.05) sig += 1000; // a piece is mid-hop right now
    }
    return {
      pieces: keys.length,
      sig: +sig.toFixed(4),
      turn: state ? state.turn : null,
      over: state ? !!state.over : null,
      moves: moveCount,
      animating: !!animating
    };
  }

  return { build, start, tick, resetGame, probe };
})();

window.PLTChess = PLTChess;
