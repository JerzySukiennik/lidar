// LiDAR Point Cloud 001: the shared world over Firebase Realtime Database (presence, host election, scans, creatures, rounds).

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
const CONFIG = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};
const ROOT = 'lidar001';
const seed31 = () => Math.floor(Math.random() * 2147483647);
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export class Net {
  constructor(realm, solo) {
    this.realm = realm;
    this.solo = solo;
    this.id = 'local' + Math.random().toString(36).slice(2, 8);
    this.name = '';
    this.offset = 0;
    this.online = false;
    this.isHost = true;
    this.joined = false;
    this.players = new Map();
    this.round = null;
    this.host = null;
    this.on = {};
    this.scanKeys = new Map();
    this.evKeys = new Map();
  }

  emit(k, a, b) { const f = this.on[k]; if (f) f(a, b); }
  now() { return Date.now() + this.offset; }

  async connect() {
    if (this.solo) return this.goOffline();
    try {
      const [appM, authM, db] = await timeout(Promise.all([
        import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`),
      ]), 9000);
      const app = appM.initializeApp(CONFIG, ROOT);
      const cred = await timeout(authM.signInAnonymously(authM.getAuth(app)), 9000);
      const D = db.getDatabase(app);
      this.db = db;
      this.id = cred.user.uid;
      this.ref = (p) => db.ref(D, `${ROOT}/${this.realm}/${p}`);
      db.onValue(db.ref(D, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; });
      const [rs, ps] = await timeout(Promise.all([db.get(this.ref('round')), db.get(this.ref('p'))]), 9000);
      const cur = rs.val();
      if (!cur || (!ps.exists() && this.now() - cur.t0 > 2 * 3600e3)) await this.freshRound(cur ? cur.n : 0);
      this.online = true;
      this.isHost = false;
      this.listen();
      return true;
    } catch (e) {
      console.warn('network unavailable, playing alone', e.message);
      return this.goOffline();
    }
  }

  goOffline() {
    this.online = false;
    this.isHost = true;
    this.round = { n: 1, seed: seed31(), t0: Date.now() };
    setTimeout(() => this.emit('round', this.round), 0);
    return false;
  }

  async freshRound(n) {
    const db = this.db;
    const res = await db.runTransaction(this.ref('round'), (c) => {
      if (c && c.n !== n) return undefined;
      return { n: n + 1, seed: seed31(), t0: this.now() };
    });
    if (res.committed) for (const k of ['sc', 'ev', 'm', 'win']) db.remove(this.ref(k));
  }

  listen() {
    const db = this.db;
    db.onValue(this.ref('round'), (s) => {
      const v = s.val();
      if (!v || typeof v.seed !== 'number' || (this.round && this.round.n === v.n)) return;
      this.round = v;
      this.scanKeys.clear();
      this.emit('round', v);
    });
    const P = this.ref('p');
    const put = (s) => { if (s.key !== this.id) { this.players.set(s.key, s.val()); this.emit('player', s.key, s.val()); } this.emit('count'); };
    db.onChildAdded(P, put);
    db.onChildChanged(P, put);
    db.onChildRemoved(P, (s) => { this.players.delete(s.key); this.emit('left', s.key); this.emit('count'); });
    db.onValue(this.ref('host'), (s) => {
      this.host = s.val();
      const mine = !!this.host && this.host.id === this.id;
      if (mine !== this.isHost) { this.isHost = mine; this.emit('host', mine); }
    });
    db.onValue(this.ref('m'), (s) => { const v = s.val(); if (v && !this.isHost) this.emit('monsters', v.a); });
    db.onValue(this.ref('win'), (s) => { const v = s.val(); if (v && this.round && v.n === this.round.n) this.emit('win', v); });
    const since = this.now() - 285000;
    db.onChildAdded(db.query(this.ref('sc'), db.orderByChild('t'), db.startAt(since)), (s) => {
      const v = s.val();
      this.scanKeys.set(s.key, [v.t, v.k]);
      if (v.p !== this.id) this.emit('scan', v);
    });
    db.onChildRemoved(this.ref('sc'), (s) => this.scanKeys.delete(s.key));
    db.onChildAdded(db.query(this.ref('ev'), db.orderByChild('t'), db.startAt(this.now() - 3000)), (s) => {
      const v = s.val();
      this.evKeys.set(s.key, v.t);
      if (v.p !== this.id) this.emit('event', v);
    });
    db.onChildRemoved(this.ref('ev'), (s) => this.evKeys.delete(s.key));
    setInterval(() => this.tick(), 1500);
    addEventListener('pagehide', () => { if (this.joined) db.remove(this.ref('p/' + this.id)); });
  }

  count() { return this.players.size + (this.joined ? 1 : 0); }

  join(name) {
    this.name = name;
    this.joined = true;
    if (!this.online) return;
    this.me = this.ref('p/' + this.id);
    this.db.onDisconnect(this.me).remove();
    this.tick();
  }

  tick() {
    if (!this.online || !this.joined) return;
    const db = this.db, h = this.host, now = this.now();
    if (document.hidden) { if (this.isHost) db.remove(this.ref('host')); return; }
    if (this.isHost) {
      db.set(this.ref('host'), { id: this.id, t: now });
      for (const [k, v] of this.scanKeys) if (now - v[0] > (v[1] === 0 ? 10000 : 290000)) { this.scanKeys.delete(k); db.remove(this.ref('sc/' + k)); }
      for (const [k, t] of this.evKeys) if (now - t > 12000) { this.evKeys.delete(k); db.remove(this.ref('ev/' + k)); }
    } else if (!h || now - h.t > 6000 || (!this.players.has(h.id) && now - h.t > 3200)) {
      db.runTransaction(this.ref('host'), (c) => {
        if (c && c.id !== this.id && this.now() - c.t < 6000 && this.players.has(c.id)) return undefined;
        return { id: this.id, t: this.now() };
      }).then((r) => { if (r.committed) db.onDisconnect(this.ref('host')).remove(); }).catch(() => {});
    }
  }

  sendPose(d, s) {
    if (this.online && this.joined) this.db.set(this.me, { n: this.name, d, s, t: this.now() });
  }

  sendMonsters(a) {
    if (this.online && this.isHost) this.db.set(this.ref('m'), { t: this.now(), a });
  }

  sendScan(k, f, d) {
    if (this.online && this.joined) this.db.push(this.ref('sc'), { p: this.id, t: this.now(), k, f, d });
  }

  sendEvent(k, data) {
    if (this.online && this.joined) this.db.push(this.ref('ev'), { p: this.id, t: this.now(), k, ...data });
  }

  claimWin() {
    if (!this.online) { this.emit('win', { p: this.id, name: this.name, n: this.round.n, t: this.now() }); return; }
    const n = this.round.n;
    this.db.runTransaction(this.ref('win'), (c) => (c && c.n === n ? undefined : { p: this.id, name: this.name, n, t: this.now() })).catch(() => {});
  }

  nextRound() {
    const n = this.round.n;
    if (!this.online) { this.round = { n: n + 1, seed: seed31(), t0: Date.now() }; this.emit('round', this.round); return; }
    this.freshRound(n).catch(() => {});
  }
}
