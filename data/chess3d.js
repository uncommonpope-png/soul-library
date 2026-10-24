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

  // ---- Chess rules: LEGAL chess. Pseudo-legal moves are filtered by king
  // safety, so a king is never left in check and never captured. Castling
  // and en passant are real; mate and stalemate are distinguished. ----
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

  // Is square (r,c) attacked by color by? Used for check + castling.
  function isAttacked(bd, r, c, by) {
    const pp = by === 'w' ? 'P' : 'p';
    const pr = by === 'w' ? r + 1 : r - 1; // white pawns attack from one row below
    for (const dc of [-1, 1]) {
      const cc = c + dc;
      if (inB(pr, cc) && bd[pr][cc] === pp) return true;
    }
    const np = by === 'w' ? 'N' : 'n';
    for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) {
      const r2 = r + dr, c2 = c + dc;
      if (inB(r2, c2) && bd[r2][c2] === np) return true;
    }
    const kp = by === 'w' ? 'K' : 'k';
    for (const [dr, dc] of DIRS.K) {
      const r2 = r + dr, c2 = c + dc;
      if (inB(r2, c2) && bd[r2][c2] === kp) return true;
    }
    const rook = by === 'w' ? 'R' : 'r';
    const bishop = by === 'w' ? 'B' : 'b';
    const queen = by === 'w' ? 'Q' : 'q';
    for (const [dr, dc] of DIRS.N) {
      let r2 = r + dr, c2 = c + dc;
      while (inB(r2, c2)) {
        const q = bd[r2][c2];
        if (q !== '.') { if (q === rook || q === queen) return true; break; }
        r2 += dr; c2 += dc;
      }
    }
    for (const [dr, dc] of DIRS.B) {
      let r2 = r + dr, c2 = c + dc;
      while (inB(r2, c2)) {
        const q = bd[r2][c2];
        if (q !== '.') { if (q === bishop || q === queen) return true; break; }
        r2 += dr; c2 += dc;
      }
    }
    return false;
  }

  function findKing(bd, t) {
    const kp = t === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (bd[r][c] === kp) return [r, c];
    return null;
  }

  function inCheck(bd, t) {
    const k = findKing(bd, t);
    return k ? isAttacked(bd, k[0], k[1], other(t)) : false;
  }

  function genMoves(bd, r, c, rights, ep) {
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
      // White advances toward row 0, black toward row 7. (The old code had
      // this backwards, which froze every pawn for the whole game.)
      const d = t === 'w' ? -1 : 1;
      const home = t === 'w' ? 6 : 1;
      if (inB(r + d, c) && bd[r + d][c] === '.') {
        out.push([r, c, r + d, c]);
        if (r === home && bd[r + 2 * d][c] === '.') out.push([r, c, r + 2 * d, c]);
      }
      for (const dc of [-1, 1]) {
        const r2 = r + d, c2 = c + dc;
        if (inB(r2, c2) && bd[r2][c2] !== '.' && colorOf(bd[r2][c2]) !== t)
          out.push([r, c, r2, c2]);
        // en passant: diagonal onto the empty ep square captures the pawn behind
        if (ep && r2 === ep[0] && c2 === ep[1]) out.push([r, c, r2, c2]);
      }
    } else if (type === 'n') {
      for (const [dr, dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) push(r + dr, c + dc);
    } else if (type === 'k') {
      for (const [dr, dc] of DIRS.K) push(r + dr, c + dc);
      // castling: king + rook unmoved, squares empty, king not in, through,
      // or into check. (King safety on the destination is re-checked by the
      // legal-move filter; the transit squares are checked here.)
      const row = t === 'w' ? 7 : 0;
      const rk = t === 'w' ? 'K' : 'k';
      const rook = t === 'w' ? 'R' : 'r';
      if (rights && r === row && c === 4 && bd[r][c] === rk && !inCheck(bd, t)) {
        const ks = t === 'w' ? rights.wk : rights.bk;
        const qs = t === 'w' ? rights.wq : rights.bq;
        if (ks && bd[row][5] === '.' && bd[row][6] === '.' && bd[row][7] === rook &&
            !isAttacked(bd, row, 5, other(t)) && !isAttacked(bd, row, 6, other(t)))
          out.push([r, c, row, 6]);
        if (qs && bd[row][3] === '.' && bd[row][2] === '.' && bd[row][1] === '.' && bd[row][0] === rook &&
            !isAttacked(bd, row, 3, other(t)) && !isAttacked(bd, row, 2, other(t)))
          out.push([r, c, row, 2]);
      }
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

  // Pseudo-legal moves (piece movement only, no king safety).
  function pseudoMoves(bd, t, rights, ep) {
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (bd[r][c] !== '.' && colorOf(bd[r][c]) === t)
        out.push(...genMoves(bd, r, c, rights, ep));
    }
    return out;
  }

  // LEGAL moves: pseudo-legal moves that do not leave the own king in check.
  // This is the rule the old engine lacked — without it kings could be left
  // en prise and captured, and games ended by king removal, not checkmate.
  function legalMoves(bd, t, rights, ep) {
    const out = [];
    for (const mv of pseudoMoves(bd, t, rights, ep)) {
      const res = applyMove(bd, mv, rights, ep);
      if (!inCheck(res.board, t)) out.push(mv);
    }
    return out;
  }

  // Apply a move, returning the new board plus updated castling rights and
  // en passant square. Handles castling rook moves, en passant captures,
  // promotion (auto-queen), and rights loss on king/rook moves or captures.
  function applyMove(bd, mv, rights, ep) {
    const nb = clone(bd);
    const [fr, fc, tr, tc] = mv;
    const piece = nb[fr][fc];
    const t = colorOf(piece);
    const nr = { wk: rights.wk, wq: rights.wq, bk: rights.bk, bq: rights.bq };
    if (piece.toLowerCase() === 'k' && Math.abs(tc - fc) === 2) {
      if (tc === 6) { nb[fr][5] = nb[fr][7]; nb[fr][7] = '.'; }
      else { nb[fr][3] = nb[fr][0]; nb[fr][0] = '.'; }
    }
    if (piece.toLowerCase() === 'p' && fc !== tc && nb[tr][tc] === '.') {
      nb[fr][tc] = '.'; // en passant victim sits behind the target square
    }
    nb[tr][tc] = piece;
    nb[fr][fc] = '.';
    if (piece.toLowerCase() === 'p' && (tr === 0 || tr === 7))
      nb[tr][tc] = t === 'w' ? 'Q' : 'q';
    if (piece === 'K') { nr.wk = false; nr.wq = false; }
    if (piece === 'k') { nr.bk = false; nr.bq = false; }
    if (piece === 'R' && fr === 7 && fc === 0) nr.wq = false;
    if (piece === 'R' && fr === 7 && fc === 7) nr.wk = false;
    if (piece === 'r' && fr === 0 && fc === 0) nr.bq = false;
    if (piece === 'r' && fr === 0 && fc === 7) nr.bk = false;
    const captured = bd[tr][tc];
    if (captured === 'R' && tr === 7 && tc === 0) nr.wq = false;
    if (captured === 'R' && tr === 7 && tc === 7) nr.wk = false;
    if (captured === 'r' && tr === 0 && tc === 0) nr.bq = false;
    if (captured === 'r' && tr === 0 && tc === 7) nr.bk = false;
    let nep = null;
    if (piece.toLowerCase() === 'p' && Math.abs(tr - fr) === 2) nep = [(fr + tr) / 2, fc];
    return { board: nb, rights: nr, ep: nep };
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

  // Minimax with alpha-beta over LEGAL moves. No legal moves with the king
  // in check is checkmate; no legal moves without check is stalemate (draw).
  function search(bd, depth, alpha, beta, t, rights, ep) {
    if (depth === 0) return { score: evaluate(bd), move: null };
    const moves = legalMoves(bd, t, rights, ep);
    if (!moves.length) {
      if (!inCheck(bd, t)) return { score: 0, move: null }; // stalemate
      return { score: t === 'w' ? -99999 : 99999, move: null }; // checkmate
    }
    let best = null;
    for (const mv of moves) {
      const res = applyMove(bd, mv, rights, ep);
      const { score } = search(res.board, depth - 1, alpha, beta, other(t), res.rights, res.ep);
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

  // Each piece gets its own silhouette so a glance reads the board: pawn ball+collar,
  // rook crenellated tower, knight arched head, bishop mitre with cut, queen crown, king cross.
  function makePieceMesh(p, t) {
    const g = new THREE.Group();
    const type = p.toLowerCase();
    const light = t === 'w';
    const mat = new THREE.MeshStandardMaterial({
      color: light ? 0xf2feff : 0x2a0d1c,
      emissive: light ? 0x00F0FF : 0xFF007A,
      emissiveIntensity: light ? 0.48 : 0.40,
      metalness: 0.9, roughness: 0.22
    });
    const dark = new THREE.MeshStandardMaterial({
      color: light ? 0x9ff6ff : 0x52102e,
      emissive: light ? 0x00F0FF : 0xFF007A,
      emissiveIntensity: 0.72,
      metalness: 0.85, roughness: 0.3
    });
    const put = (m, y) => { m.position.y = y; g.add(m); return m; };

    put(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.10, 24), dark), 0.05);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 0.12, 20), mat), 0.15);

    if (type === 'p') {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.30, 16), mat), 0.36);
      put(new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.045, 10, 20), dark), 0.53);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), mat), 0.69);
    } else if (type === 'r') {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.30, 0.50, 18), mat), 0.46);
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.26, 0.12, 18), dark), 0.76);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), mat);
        b.position.set(Math.cos(a) * 0.21, 0.89, Math.sin(a) * 0.21);
        g.add(b);
      }
    } else if (type === 'n') {
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.54, 0.28), mat);
      neck.position.set(0.03, 0.49, 0.02); neck.rotation.z = -0.36; g.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.25, 0.36), mat);
      head.position.set(-0.11, 0.78, 0.10); head.rotation.z = -0.22; g.add(head);
      const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.20), dark);
      muzzle.position.set(-0.18, 0.71, 0.25); g.add(muzzle);
      for (const dz of [-0.07, 0.07]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.15, 8), dark);
        ear.position.set(-0.02, 0.94, dz); g.add(ear);
      }
    } else if (type === 'b') {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.44, 16), mat), 0.43);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.20, 16, 12), mat), 0.70);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.40), dark);
      slit.position.set(0, 0.72, 0); slit.rotation.z = 0.6; g.add(slit);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), dark), 0.92);
    } else if (type === 'q') {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.52, 18), mat), 0.47);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 14), mat), 0.82);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), dark);
        s.position.set(Math.cos(a) * 0.19, 0.99, Math.sin(a) * 0.19);
        g.add(s);
      }
      put(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), dark), 1.04);
    } else {
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.58, 18), mat), 0.50);
      put(new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 14), mat), 0.90);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.30, 0.075), dark);
      cross.position.y = 1.14; g.add(cross);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.075, 0.075), dark);
      bar.position.y = 1.17; g.add(bar);
    }
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
    state = { board: clone(INIT), turn: 'w', over: false, result: null,
      rights: { wk: true, wq: true, bk: true, bq: true }, ep: null };
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
    const { move } = search(state.board, 2, -Infinity, Infinity, state.turn, state.rights, state.ep);
    if (!move) {
      // No legal moves: checkmate if in check, stalemate otherwise. The game
      // ends here — a king is never captured, so no king-loss reset exists.
      state.over = true;
      state.result = inCheck(state.board, state.turn) ? 'checkmate' : 'stalemate';
      const overState = state;
      thinkTimer = setTimeout(() => {
        if (state !== overState) return;
        resetGame();
        start();
      }, 4000);
      return;
    }
    const [fr, fc, tr, tc] = move;
    const piece = state.board[fr][fc];
    // captured mesh: normal capture sits on the target square; an en passant
    // victim sits behind it, on the mover's rank.
    let capKey = null;
    if (state.board[tr][tc] !== '.') capKey = tr + ',' + tc;
    else if (piece.toLowerCase() === 'p' && fc !== tc) capKey = fr + ',' + tc;
    if (capKey) {
      const cap = pieceMeshes[capKey];
      if (cap) boardGroup.remove(cap);
      delete pieceMeshes[capKey];
    }
    const res = applyMove(state.board, move, state.rights, state.ep);
    state.board = res.board; state.rights = res.rights; state.ep = res.ep;
    // castling rook mesh: reposition synchronously while the king animates.
    if (piece.toLowerCase() === 'k' && Math.abs(tc - fc) === 2) {
      const row = fr;
      const rookFrom = tc === 6 ? 7 : 0, rookTo = tc === 6 ? 5 : 3;
      const rm = pieceMeshes[row + ',' + rookFrom];
      if (rm) {
        const w = worldOf(row, rookTo);
        rm.position.set(w.x, 0, w.z);
        delete pieceMeshes[row + ',' + rookFrom];
        pieceMeshes[row + ',' + rookTo] = rm;
      }
    }
    lastMove = move;
    movePiece3D(move, () => {
      moveCount++;
      state.turn = other(state.turn);
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
      animating: !!animating,
      inCheck: state ? inCheck(state.board, state.turn) : null,
      legalMoves: state && !state.over ? legalMoves(state.board, state.turn, state.rights, state.ep).length : 0,
      result: state ? (state.result || null) : null
    };
  }

  return { build, start, tick, resetGame, probe };
})();

window.PLTChess = PLTChess;
